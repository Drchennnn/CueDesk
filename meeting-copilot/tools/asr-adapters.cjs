'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const REALTIME_PROVIDERS = Object.freeze({
  dashscope: Object.freeze({
    id: 'dashscope',
    labelZh: '阿里云百炼（DashScope WebSocket）',
    defaultBaseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    defaultModel: 'paraformer-realtime-v2',
    needsResourceId: false,
    supportsAuthModes: false
  }),
  doubao: Object.freeze({
    id: 'doubao',
    labelZh: '火山豆包流式 ASR v3（SAUC 二进制协议）',
    defaultBaseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    defaultModel: 'bigmodel',
    defaultResourceId: 'volc.seedasr.sauc.duration',
    needsResourceId: true,
    supportsAuthModes: true
  })
});

const DOUBAO_PROTO = Object.freeze({
  VERSION: 0x1,
  HEADER_SIZE: 0x1,
  MSG_FULL_CLIENT_REQUEST: 0x1,
  MSG_AUDIO_ONLY_REQUEST: 0x2,
  MSG_FULL_SERVER_RESPONSE: 0x9,
  MSG_SERVER_ERROR_RESPONSE: 0xf,
  FLAG_NO_SEQ: 0x0,
  FLAG_POS_SEQ: 0x1,
  FLAG_NEG_NO_SEQ: 0x2,
  FLAG_NEG_WITH_SEQ: 0x3,
  SER_NONE: 0x0,
  SER_JSON: 0x1,
  COMP_NONE: 0x0,
  COMP_GZIP: 0x1
});

const FINISH_TIMEOUT_MS = 5000;
const HANDSHAKE_TIMEOUT_MS = 10000;
const PCM_CHUNK_BYTES = 6400; // 200ms @ 16kHz 16-bit mono PCM

function isLocalWsUrl(url) {
  return /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(String(url || '').trim());
}

function inferRealtimeProvider(cfg = {}) {
  const explicit = String(cfg?.provider || '').trim().toLowerCase();
  if (explicit === 'doubao' || explicit === 'volcengine' || explicit === 'seedasr') return 'doubao';
  if (explicit === 'dashscope' || explicit === 'aliyun' || explicit === 'bailian') return 'dashscope';
  const url = String(cfg?.baseUrl || '').trim().toLowerCase();
  const resId = String(cfg?.resourceId || '').trim().toLowerCase();
  if (
    url.includes('openspeech.bytedance.com') ||
    url.includes('bytepluses.com') ||
    url.includes('/api/v3/sauc') ||
    resId.startsWith('volc.')
  ) {
    return 'doubao';
  }
  return 'dashscope';
}

function sanitizeDiagnosticText(text, secrets = []) {
  let out = String(text || '');
  const list = Array.isArray(secrets) ? secrets : [secrets];
  for (const s of list) {
    const clean = String(s || '').trim();
    if (clean.length >= 6) {
      out = out.split(clean).join('[REDACTED]');
    }
  }
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/(X-Api-(?:Key|Access-Key|App-Key)\s*[:=]\s*)([^\s,;'"}\]]+)/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, 'sk-[REDACTED]');
  return out.slice(0, 600);
}

function f32ToPcm16(pcm) {
  const len = pcm?.length || 0;
  const buf = Buffer.allocUnsafe(len * 2);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? (s * 32768) | 0 : (s * 32767) | 0, i * 2);
  }
  return buf;
}

function languageHintsDashScope(language) {
  if (language === 'chinese') return ['zh'];
  if (language === 'english') return ['en'];
  return undefined;
}

function makeStructuredError({
  stage = 'connect',
  code = 'UNKNOWN_ERROR',
  messageZh = '实时语音识别连接失败',
  hintZh = '请检查接口地址、鉴权字段与网络环境后重试。',
  rawCode = '',
  requestId = '',
  connected = false,
  retryable = false,
  cause = ''
}) {
  const err = new Error(messageZh);
  err.mcAsr = {
    stage,
    code,
    messageZh,
    hintZh,
    rawCode: String(rawCode || ''),
    requestId: String(requestId || ''),
    connected: Boolean(connected),
    retryable: Boolean(retryable),
    cause: String(cause || '')
  };
  return err;
}

function validateRealtimeConfig(cfg = {}) {
  const provider = inferRealtimeProvider(cfg);
  const baseUrl = String(cfg?.baseUrl || '').trim();
  const model = String(cfg?.model || '').trim();
  const apiKey = String(cfg?.apiKey || '').trim();
  const resourceId = String(cfg?.resourceId || '').trim();
  const authMode = String(cfg?.authMode || 'api-key').trim() === 'app-access' ? 'app-access' : 'api-key';
  const appKey = String(cfg?.appKey || '').trim();

  if (!baseUrl) {
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_ENDPOINT',
      messageZh: '未填写实时 ASR WebSocket 地址',
      hintZh: provider === 'doubao'
        ? '请填写豆包流式 ASR 地址，例如 wss://openspeech.bytedance.com/api/v3/sauc/bigmodel'
        : '请填写阿里云百炼 WebSocket 地址，例如 wss://dashscope.aliyuncs.com/api-ws/v1/inference'
    };
  }
  if (!/^wss?:\/\//i.test(baseUrl)) {
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_ENDPOINT',
      messageZh: `实时 ASR 地址协议无效（需以 ws:// 或 wss:// 开头）`,
      hintZh: '请检查地址是否误填为 https://，流式实时识别需使用 wss:// 地址。'
    };
  }
  if (provider === 'doubao') {
    if (!resourceId) {
      return {
        ok: false,
        stage: 'config',
        code: 'MISSING_RESOURCE_ID',
        messageZh: '缺少豆包 Resource ID（X-Api-Resource-Id）',
        hintZh: '请填写控制台开通的资源 ID：豆包 2.0 小时版为 volc.seedasr.sauc.duration，1.0 小时版为 volc.bigasr.sauc.duration。'
      };
    }
    if (authMode === 'app-access' && !appKey) {
      return {
        ok: false,
        stage: 'config',
        code: 'MISSING_APP_KEY',
        messageZh: '旧版鉴权缺少 App ID（X-Api-App-Key）',
        hintZh: '当前选择了「App ID + Access Token」鉴权，请补全 App ID，或切换为新版「API Key（X-Api-Key）」。'
      };
    }
    if (!apiKey && !isLocalWsUrl(baseUrl)) {
      return {
        ok: false,
        stage: 'config',
        code: 'INVALID_KEY',
        messageZh: authMode === 'app-access' ? '未填写 Access Token（X-Api-Access-Key）' : '未填写豆包 API Key（X-Api-Key）',
        hintZh: '请粘贴控制台颁发的有效密钥后重试。'
      };
    }
    return { ok: true, provider, normalized: { provider, baseUrl, model: model || 'bigmodel', resourceId, authMode, appKey, apiKey } };
  }

  // DashScope (and local FunASR/MOSS sidecar over ws://127.0.0.1)
  if (!model) {
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_MODEL',
      messageZh: '未填写实时 ASR 模型名',
      hintZh: '例如 paraformer-realtime-v2 或 fun-asr-realtime。'
    };
  }
  if (!apiKey && !isLocalWsUrl(baseUrl)) {
    return {
      ok: false,
      stage: 'config',
      code: 'INVALID_KEY',
      messageZh: '未填写实时 ASR API Key',
      hintZh: '请填写百炼控制台 API Key（sk-...）后再测试或开启识别。'
    };
  }
  return { ok: true, provider, normalized: { provider, baseUrl, model, apiKey } };
}

function classifyRealtimeError(err, ctx = {}) {
  const provider = ctx.provider || inferRealtimeProvider(ctx);
  const secrets = [ctx.apiKey, ctx.appKey].filter(Boolean);
  const connected = Boolean(ctx.connected || err?.mcAsr?.connected);

  if (err?.mcAsr) {
    const info = err.mcAsr;
    return {
      ok: false,
      provider,
      connected: Boolean(info.connected || connected),
      stage: info.stage || (connected ? 'transcribe' : 'connect'),
      code: info.code || 'PROVIDER_ERROR',
      messageZh: sanitizeDiagnosticText(info.messageZh, secrets),
      hintZh: sanitizeDiagnosticText(info.hintZh, secrets),
      rawCode: sanitizeDiagnosticText(info.rawCode || '', secrets),
      requestId: sanitizeDiagnosticText(info.requestId || ctx.requestId || '', secrets),
      retryable: Boolean(info.retryable)
    };
  }

  const rawText = sanitizeDiagnosticText(
    [err?.message, err?.cause?.message, ctx.rawMessage].filter(Boolean).join(' | '),
    secrets
  );
  const lower = rawText.toLowerCase();
  const statusCode = Number(err?.statusCode || ctx.statusCode || 0);
  const rawCode = sanitizeDiagnosticText(
    err?.rawCode || ctx.rawCode || (statusCode ? `HTTP ${statusCode}` : ''),
    secrets
  );
  const requestId = sanitizeDiagnosticText(err?.requestId || ctx.requestId || '', secrets);

  if (err?.name === 'TimeoutError' || /timed?\s*out|timeout|aborted/i.test(lower)) {
    return {
      ok: false,
      provider,
      connected,
      stage: connected ? 'transcribe' : 'connect',
      code: 'TIMEOUT',
      messageZh: connected ? '已连接，但等待转写结果超时' : '连接实时语音服务超时',
      hintZh: connected
        ? '握手已成功，但服务端未在超时时间内返回最终文本；请检查音频格式、Resource ID 或稍后重试。'
        : '请检查网络连通性、WebSocket 地址是否正确，或确认系统代理未拦截 wss 连接。',
      rawCode: rawCode || 'TIMEOUT',
      requestId,
      retryable: true
    };
  }

  if (
    statusCode === 401 ||
    /45000010|invalid[\s_-]?api[\s_-]?key|unauthorized|authentication|auth\s*fail|signature|invalid\s*token|access[\s_-]?key/i.test(lower) ||
    /^45000010$/i.test(rawCode)
  ) {
    return {
      ok: false,
      provider,
      connected,
      stage: 'auth',
      code: 'AUTH_FAILED',
      messageZh: provider === 'doubao'
        ? '豆包鉴权失败：密钥无效或鉴权模式不匹配'
        : '实时 ASR 鉴权失败：API Key 无效或已过期',
      hintZh: provider === 'doubao'
        ? '请确认控制台密钥类型：新版单 Key 请选「API Key（X-Api-Key）」；旧版请选「App ID + Access Token」并核对两个字段。'
        : '请检查百炼 API Key 是否完整、无多余空格，且属于对应地域控制台。',
      rawCode: rawCode || 'AUTH_FAILED',
      requestId,
      retryable: false
    };
  }

  if (
    statusCode === 403 ||
    /45000030|40000005|resource.*not|not\s*granted|permission|accessdenied|forbidden|quota|arrearage|insufficient|unsubscribed|not\s*activated|model.*not.*found/i.test(lower) ||
    /^(?:45000030|40000005|AccessDenied|Arrearage)$/i.test(rawCode)
  ) {
    return {
      ok: false,
      provider,
      connected,
      stage: 'auth',
      code: 'RESOURCE_UNAUTHORIZED',
      messageZh: provider === 'doubao'
        ? '豆包资源未开通或无权访问（Resource ID 权限不足）'
        : '服务商拒绝访问：模型未开通、无权限或余额不足',
      hintZh: provider === 'doubao'
        ? '请核对 X-Api-Resource-Id 是否已在火山控制台开通（2.0 小时版：volc.seedasr.sauc.duration；1.0 小时版：volc.bigasr.sauc.duration），并检查用量余额。'
        : '请确认已在百炼控制台开通该实时语音模型，且账户余额充足。',
      rawCode: rawCode || 'RESOURCE_UNAUTHORIZED',
      requestId,
      retryable: false
    };
  }

  if (
    /45000001|45000002|45000151|audio|codec|sample[\s_-]?rate|format|invalid\s*param|invalidparameter|illegal\s*packet|decode|pcm/i.test(lower) ||
    /^(?:45000001|45000002|45000151|InvalidParameter)$/i.test(rawCode)
  ) {
    return {
      ok: false,
      provider,
      connected,
      stage: 'audio',
      code: 'AUDIO_FORMAT_ERROR',
      messageZh: connected ? '已连接，试转写失败：音频参数或帧格式不被服务端接受' : '请求参数或音频格式不被服务端接受',
      hintZh: '流式协议固定发送 16kHz / 16bit / 单声道 PCM；请核对端点路径（如 /api/v3/sauc/bigmodel）与模型名是否匹配。',
      rawCode: rawCode || 'AUDIO_FORMAT_ERROR',
      requestId,
      retryable: false
    };
  }

  if (/enotfound|econnrefused|econnreset|ehostunreach|enetunreach|tls|cert|socket|network|unexpected server response: 5\d\d/i.test(lower) || statusCode >= 500) {
    return {
      ok: false,
      provider,
      connected,
      stage: connected ? 'transcribe' : 'connect',
      code: 'NETWORK_ERROR',
      messageZh: connected ? '实时识别中途断线（网络异常）' : '无法连接到实时语音服务器（网络或地址异常）',
      hintZh: '请检查网络连接、WebSocket 地址拼写及代理设置后重试。',
      rawCode: rawCode || 'NETWORK_ERROR',
      requestId,
      retryable: true
    };
  }

  return {
    ok: false,
    provider,
    connected,
    stage: connected ? 'transcribe' : 'handshake',
    code: rawCode ? 'PROVIDER_ERROR' : 'UNKNOWN_ERROR',
    messageZh: connected
      ? `已连接，但服务端返回错误：${rawText || '未知错误'}`
      : `实时 ASR 连接失败：${rawText || '服务端拒绝连接'}`,
    hintZh: '请展开查看原始错误码与请求 ID，核对协议类型（百炼 vs 豆包 v3）、地址与鉴权参数。',
    rawCode: rawCode || 'UNKNOWN',
    requestId,
    retryable: false
  };
}

// =============================================================================
// Doubao SAUC v3 Binary Framing (Volcengine BigModel Streaming ASR)
// =============================================================================

function buildDoubaoHeader(msgType, flags, serialization, compression) {
  const b0 = ((DOUBAO_PROTO.VERSION & 0x0f) << 4) | (DOUBAO_PROTO.HEADER_SIZE & 0x0f);
  const b1 = ((msgType & 0x0f) << 4) | (flags & 0x0f);
  const b2 = ((serialization & 0x0f) << 4) | (compression & 0x0f);
  return Buffer.from([b0, b1, b2, 0x00]);
}

function encodeDoubaoFullClientRequest(payloadObj, seq = 1, { compress = true } = {}) {
  const raw = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const body = compress ? zlib.gzipSync(raw) : raw;
  const header = buildDoubaoHeader(
    DOUBAO_PROTO.MSG_FULL_CLIENT_REQUEST,
    DOUBAO_PROTO.FLAG_POS_SEQ,
    DOUBAO_PROTO.SER_JSON,
    compress ? DOUBAO_PROTO.COMP_GZIP : DOUBAO_PROTO.COMP_NONE
  );
  const meta = Buffer.allocUnsafe(8);
  meta.writeInt32BE(seq, 0);
  meta.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, meta, body]);
}

function encodeDoubaoAudioPacket(pcm16Buf, seq, { isLast = false, compress = true } = {}) {
  const raw = Buffer.isBuffer(pcm16Buf) ? pcm16Buf : Buffer.from(pcm16Buf || []);
  const body = compress ? zlib.gzipSync(raw) : raw;
  const flags = isLast ? DOUBAO_PROTO.FLAG_NEG_WITH_SEQ : DOUBAO_PROTO.FLAG_POS_SEQ;
  const header = buildDoubaoHeader(
    DOUBAO_PROTO.MSG_AUDIO_ONLY_REQUEST,
    flags,
    DOUBAO_PROTO.SER_NONE,
    compress ? DOUBAO_PROTO.COMP_GZIP : DOUBAO_PROTO.COMP_NONE
  );
  const meta = Buffer.allocUnsafe(8);
  meta.writeInt32BE(isLast ? -Math.abs(seq) : Math.abs(seq), 0);
  meta.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, meta, body]);
}

function decodeDoubaoServerPacket(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 4) {
    throw makeStructuredError({
      stage: 'transcribe',
      code: 'AUDIO_FORMAT_ERROR',
      messageZh: '收到不完整的豆包二进制响应帧',
      hintZh: '请确认服务端地址为豆包 v3 SAUC 流式接口。',
      rawCode: 'SHORT_FRAME'
    });
  }
  const headerSize = (buf[0] & 0x0f) * 4;
  const msgType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;
  const serialization = (buf[2] >> 4) & 0x0f;
  const compression = buf[2] & 0x0f;
  let offset = headerSize;

  if (msgType === DOUBAO_PROTO.MSG_SERVER_ERROR_RESPONSE) {
    if (buf.length < offset + 8) {
      return { kind: 'error', errorCode: 0, message: 'server error frame truncated', isLast: true };
    }
    const errorCode = buf.readUInt32BE(offset);
    offset += 4;
    const msgSize = buf.readUInt32BE(offset);
    offset += 4;
    let payload = buf.subarray(offset, offset + msgSize);
    if (compression === DOUBAO_PROTO.COMP_GZIP && payload.length > 0) {
      try { payload = zlib.gunzipSync(payload); } catch {}
    }
    const text = payload.toString('utf8');
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return {
      kind: 'error',
      errorCode,
      message: parsed?.error || parsed?.message || text || `Doubao error ${errorCode}`,
      payload: parsed,
      isLast: true
    };
  }

  if (msgType === DOUBAO_PROTO.MSG_FULL_SERVER_RESPONSE) {
    let seq = null;
    if ((flags & 0x01) !== 0 && buf.length >= offset + 4) {
      seq = buf.readInt32BE(offset);
      offset += 4;
    }
    const isLast = (flags & 0x02) !== 0 || (seq !== null && seq < 0);
    if (buf.length < offset + 4) {
      return { kind: 'response', seq, isLast, payload: null };
    }
    const payloadSize = buf.readUInt32BE(offset);
    offset += 4;
    let payloadBuf = buf.subarray(offset, offset + payloadSize);
    if (compression === DOUBAO_PROTO.COMP_GZIP && payloadBuf.length > 0) {
      payloadBuf = zlib.gunzipSync(payloadBuf);
    }
    let payload = null;
    if (serialization === DOUBAO_PROTO.SER_JSON && payloadBuf.length > 0) {
      payload = JSON.parse(payloadBuf.toString('utf8'));
    } else if (payloadBuf.length > 0) {
      const txt = payloadBuf.toString('utf8');
      try { payload = JSON.parse(txt); } catch { payload = { text: txt }; }
    }
    return { kind: 'response', seq, isLast, payload };
  }

  return { kind: 'unknown', msgType, flags, isLast: false, payload: null };
}

function buildDoubaoHeaders(cfg, connectId) {
  const headers = {
    'X-Api-Resource-Id': cfg.resourceId,
    'X-Api-Connect-Id': connectId
  };
  if (cfg.authMode === 'app-access') {
    headers['X-Api-App-Key'] = cfg.appKey;
    headers['X-Api-Access-Key'] = cfg.apiKey;
  } else {
    headers['X-Api-Key'] = cfg.apiKey;
  }
  return headers;
}

function buildDoubaoInitPayload(cfg, language) {
  const audio = {
    format: 'pcm',
    codec: 'raw',
    rate: 16000,
    bits: 16,
    channel: 1
  };
  // BigModel 1.0/2.0 streaming natively supports zh/en mixed speech; only attach
  // audio.language for nostream endpoints when explicitly requesting English-only.
  if (language === 'english' && /nostream/i.test(String(cfg?.baseUrl || ''))) {
    audio.language = 'en-US';
  }
  return {
    user: { uid: 'meetingcopilot' },
    audio,
    request: {
      model_name: cfg.model || 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      show_utterances: true,
      result_type: 'single'
    }
  };
}

function attachUnexpectedResponseHandler(ws, onFail) {
  ws.on('unexpected-response', (_req, res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8').slice(0, 400);
      const statusCode = res.statusCode || 0;
      const apiStatus = res.headers?.['x-api-status-code'] || '';
      const apiMsg = res.headers?.['x-api-message'] || '';
      const logId = res.headers?.['x-tt-logid'] || res.headers?.['x-dashscope-request-id'] || res.headers?.['x-request-id'] || '';
      const err = new Error(
        [apiMsg, body, `HTTP ${statusCode}`].filter(Boolean).join(' · ')
      );
      err.statusCode = statusCode;
      err.rawCode = apiStatus ? String(apiStatus) : `HTTP ${statusCode}`;
      err.requestId = String(logId || '');
      onFail(err);
    });
  });
}

class DoubaoRtSession {
  constructor(cfg, cb, language, WebSocketImpl) {
    this.cfg = cfg;
    this.cb = cb;
    this.language = language || 'auto';
    this.connectId = crypto.randomUUID();
    this.requestId = this.connectId;
    this.seq = 1;
    this.started = false;
    this.closing = false;
    this.aborted = false;
    this.closed = false;
    this.pendingBytes = [];
    this.pendingByteLen = 0;
    this.finishResolve = null;
    this.emittedDefiniteKeys = new Set();
    this.lastDefiniteEndMs = -1;
    this.lastPartialText = '';
    this.hasEmittedAnySentence = false;

    const headers = buildDoubaoHeaders(cfg, this.connectId);
    this.ws = new WebSocketImpl(cfg.baseUrl, {
      headers,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS
    });

    attachUnexpectedResponseHandler(this.ws, (err) => {
      if (!err.requestId) err.requestId = this.requestId;
      this.fail(err);
    });

    this.ws.on('upgrade', (res) => {
      const logId = res?.headers?.['x-tt-logid'];
      if (logId) this.requestId = String(logId);
    });

    this.ws.on('open', () => {
      if (this.aborted || this.closed) return;
      try {
        const initFrame = encodeDoubaoFullClientRequest(buildDoubaoInitPayload(cfg, this.language), this.seq);
        this.seq += 1;
        this.ws.send(initFrame);
      } catch (e) {
        this.fail(e);
      }
    });

    this.ws.on('message', (data) => {
      if (this.aborted || this.closed) return;
      let pkt;
      try {
        pkt = decodeDoubaoServerPacket(data);
      } catch (e) {
        this.fail(e);
        return;
      }

      if (pkt.kind === 'error') {
        const err = new Error(pkt.message || `Doubao server error ${pkt.errorCode}`);
        err.rawCode = String(pkt.errorCode || '');
        err.requestId = this.requestId;
        this.fail(err);
        return;
      }

      if (pkt.kind !== 'response') return;

      if (!this.started) {
        this.started = true;
        this.cb.onReady?.({ requestId: this.requestId });
        this.flushPendingAudio(false);
      }

      this.handleResultPayload(pkt.payload, pkt.isLast);

      if (pkt.isLast) {
        this.closed = true;
        this.settleFinish();
        try { this.ws.close(); } catch {}
      }
    });

    this.ws.on('error', (e) => {
      if (!e.requestId) e.requestId = this.requestId;
      this.fail(e);
    });

    this.ws.on('close', (code, reason) => {
      if (this.aborted || this.closed) return;
      if (this.closing) {
        this.flushTailOnClose();
        this.closed = true;
        this.settleFinish();
        return;
      }
      const msg = reason ? reason.toString('utf8') : '';
      if (!this.started) {
        const err = new Error(msg || `WebSocket closed before handshake ack (code ${code})`);
        err.rawCode = `WS_${code}`;
        err.requestId = this.requestId;
        this.fail(err);
      } else {
        this.closed = true;
        this.settleFinish();
      }
    });
  }

  handleResultPayload(payload, isLast) {
    if (!payload || typeof payload !== 'object') {
      if (isLast) this.flushTailOnClose();
      return;
    }
    const result = payload.result || payload;
    const utterances = Array.isArray(result?.utterances) ? result.utterances : null;

    if (utterances && utterances.length > 0) {
      const partialParts = [];
      for (const u of utterances) {
        const text = String(u?.text || '').trim();
        if (!text) continue;
        const beginMs = Number.isFinite(Number(u?.start_time)) ? Number(u.start_time) : 0;
        const endMs = Number.isFinite(Number(u?.end_time)) ? Number(u.end_time) : beginMs;
        const key = `${beginMs}:${endMs}`;
        if (u?.definite === true) {
          if (!this.emittedDefiniteKeys.has(key) && (endMs > this.lastDefiniteEndMs || beginMs >= this.lastDefiniteEndMs)) {
            this.emittedDefiniteKeys.add(key);
            if (endMs > this.lastDefiniteEndMs) this.lastDefiniteEndMs = endMs;
            this.hasEmittedAnySentence = true;
            this.lastPartialText = '';
            this.cb.onSentence?.({ text, beginMs, endMs });
          }
        } else {
          partialParts.push({ text, beginMs, endMs });
        }
      }
      if (partialParts.length > 0) {
        const joined = partialParts.map(p => p.text).join('');
        this.lastPartialText = joined;
        if (isLast) {
          const first = partialParts[0];
          const last = partialParts[partialParts.length - 1];
          this.hasEmittedAnySentence = true;
          this.lastPartialText = '';
          this.cb.onSentence?.({ text: joined, beginMs: first.beginMs, endMs: last.endMs });
        } else {
          this.cb.onPartial?.(joined);
        }
      }
      return;
    }

    const fullText = String(result?.text || '').trim();
    if (fullText) {
      if (isLast && !this.hasEmittedAnySentence) {
        this.hasEmittedAnySentence = true;
        this.lastPartialText = '';
        this.cb.onSentence?.({ text: fullText, beginMs: 0, endMs: 0 });
      } else if (!isLast) {
        this.lastPartialText = fullText;
        this.cb.onPartial?.(fullText);
      }
    } else if (isLast) {
      this.flushTailOnClose();
    }
  }

  flushTailOnClose() {
    if (this.aborted) return;
    const tail = String(this.lastPartialText || '').trim();
    if (tail && !this.hasEmittedAnySentence) {
      this.hasEmittedAnySentence = true;
      this.lastPartialText = '';
      this.cb.onSentence?.({ text: tail, beginMs: 0, endMs: 0 });
    }
  }

  fail(err) {
    if (this.aborted || this.closed) return;
    this.closed = true;
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
    const info = classifyRealtimeError(err, {
      provider: 'doubao',
      apiKey: this.cfg.apiKey,
      appKey: this.cfg.appKey,
      connected: this.started,
      requestId: this.requestId
    });
    const detail = info.rawCode ? `[${info.rawCode}] ${info.messageZh}` : info.messageZh;
    this.cb.onError?.(detail, info);
  }

  settleFinish() {
    const r = this.finishResolve;
    this.finishResolve = null;
    r?.();
  }

  flushPendingAudio(forceSmall = false) {
    if (this.aborted || this.closed || !this.started || this.ws.readyState !== 1) return;
    if (this.pendingByteLen === 0) return;
    let combined = this.pendingBytes.length === 1 ? this.pendingBytes[0] : Buffer.concat(this.pendingBytes, this.pendingByteLen);
    this.pendingBytes = [];
    this.pendingByteLen = 0;

    let offset = 0;
    while (combined.length - offset >= PCM_CHUNK_BYTES) {
      const slice = combined.subarray(offset, offset + PCM_CHUNK_BYTES);
      this.ws.send(encodeDoubaoAudioPacket(slice, this.seq, { isLast: false }));
      this.seq += 1;
      offset += PCM_CHUNK_BYTES;
    }
    const rem = combined.subarray(offset);
    if (rem.length > 0) {
      if (forceSmall) {
        this.ws.send(encodeDoubaoAudioPacket(rem, this.seq, { isLast: false }));
        this.seq += 1;
      } else {
        this.pendingBytes.push(Buffer.from(rem));
        this.pendingByteLen = rem.length;
      }
    }
  }

  push(pcm) {
    if (this.aborted || this.closed || this.closing || !pcm || pcm.length === 0) return;
    const buf = f32ToPcm16(pcm);
    this.pendingBytes.push(buf);
    this.pendingByteLen += buf.length;
    if (this.started && this.ws.readyState === 1 && this.pendingByteLen >= PCM_CHUNK_BYTES) {
      this.flushPendingAudio(false);
    }
  }

  cancel() {
    if (this.aborted) return;
    this.aborted = true;
    this.closed = true;
    this.pendingBytes = [];
    this.pendingByteLen = 0;
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
  }

  async close() {
    if (this.aborted || this.closed || this.closing) return;
    this.closing = true;
    if (this.ws.readyState !== 1 || !this.started) {
      this.closed = true;
      try { this.ws.terminate(); } catch {}
      return;
    }
    const tail = this.pendingByteLen > 0
      ? Buffer.concat(this.pendingBytes, this.pendingByteLen)
      : Buffer.alloc(0);
    this.pendingBytes = [];
    this.pendingByteLen = 0;

    // Send full chunks first if tail > PCM_CHUNK_BYTES, then send final chunk with NEG_WITH_SEQ
    let offset = 0;
    while (tail.length - offset > PCM_CHUNK_BYTES) {
      const slice = tail.subarray(offset, offset + PCM_CHUNK_BYTES);
      this.ws.send(encodeDoubaoAudioPacket(slice, this.seq, { isLast: false }));
      this.seq += 1;
      offset += PCM_CHUNK_BYTES;
    }
    const lastSlice = tail.subarray(offset);
    const finished = new Promise((res) => { this.finishResolve = res; });
    try {
      this.ws.send(encodeDoubaoAudioPacket(lastSlice, this.seq, { isLast: true }));
      this.seq += 1;
    } catch {
      this.closed = true;
      this.settleFinish();
      return;
    }
    const timeout = new Promise((res) => setTimeout(res, FINISH_TIMEOUT_MS).unref?.());
    await Promise.race([finished, timeout]);
    this.closed = true;
    try { this.ws.terminate(); } catch {}
  }
}

class DoubaoRealtimeEngine {
  constructor(cfg, WebSocketImpl) {
    this.cfg = cfg;
    this.WebSocketImpl = WebSocketImpl;
    this.provider = 'doubao';
    this.ep = 'cloud-rt';
    this.streaming = true;
    this.loadMs = 0;
    this.warmMs = 0;
    this.lidAvailable = false;
  }

  static async load(cfg, { WebSocket } = {}) {
    const check = validateRealtimeConfig({ ...cfg, provider: 'doubao' });
    if (!check.ok) throw makeStructuredError(check);
    const WS = WebSocket || require('ws');
    return new DoubaoRealtimeEngine(check.normalized, WS);
  }

  async warmup() {
    return 0;
  }

  openSession(cb, opts = {}) {
    return new DoubaoRtSession(this.cfg, cb, opts.language, this.WebSocketImpl);
  }
}

// =============================================================================
// Aliyun DashScope WebSocket Realtime Adapter (also covers local FunASR/MOSS)
// =============================================================================

class DashScopeRtSession {
  constructor(cfg, cb, language, WebSocketImpl) {
    this.cfg = cfg;
    this.cb = cb;
    this.taskId = crypto.randomUUID();
    this.requestId = this.taskId;
    this.started = false;
    this.closing = false;
    this.aborted = false;
    this.closed = false;
    this.pending = [];
    this.finishResolve = null;

    this.ws = new WebSocketImpl(cfg.baseUrl, {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS
    });

    attachUnexpectedResponseHandler(this.ws, (err) => {
      if (!err.requestId) err.requestId = this.requestId;
      this.fail(err);
    });

    this.ws.on('open', () => {
      if (this.aborted || this.closed) return;
      const hints = languageHintsDashScope(language);
      const runTask = {
        header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: cfg.model,
          parameters: {
            format: 'pcm',
            sample_rate: 16000,
            ...(hints ? { language_hints: hints } : {})
          },
          input: {}
        }
      };
      this.ws.send(JSON.stringify(runTask));
    });

    this.ws.on('message', (data, isBinary) => {
      if (this.aborted || this.closed || isBinary) return;
      let ev;
      try {
        ev = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      const kind = ev?.header?.event;
      if (!kind) return;
      if (ev?.header?.task_id) this.requestId = String(ev.header.task_id);
      if (kind === 'task-started') {
        this.started = true;
        this.cb.onReady?.({ requestId: this.requestId });
        for (const b of this.pending) {
          if (this.ws.readyState === 1) this.ws.send(b);
        }
        this.pending = [];
      } else if (kind === 'result-generated') {
        const s = ev.payload?.output?.sentence;
        if (!s || s.heartbeat) return;
        const text = String(s.text ?? '').trim();
        if (!text) return;
        if (s.sentence_end) {
          this.cb.onSentence?.({ text, beginMs: s.begin_time ?? 0, endMs: s.end_time ?? 0 });
        } else {
          this.cb.onPartial?.(text);
        }
      } else if (kind === 'task-finished') {
        this.closed = true;
        this.settleFinish();
        try { this.ws.close(); } catch {}
      } else if (kind === 'task-failed') {
        const err = new Error(ev.header?.error_message || 'task failed');
        err.rawCode = String(ev.header?.error_code || 'TASK_FAILED');
        err.requestId = this.requestId;
        this.fail(err);
      }
    });

    this.ws.on('error', (e) => {
      if (!e.requestId) e.requestId = this.requestId;
      this.fail(e);
    });

    this.ws.on('close', (code, reason) => {
      if (this.aborted || this.closed) return;
      if (this.closing) {
        this.closed = true;
        this.settleFinish();
        return;
      }
      if (!this.started) {
        const msg = reason ? reason.toString('utf8') : `WebSocket closed (code ${code})`;
        const err = new Error(msg);
        err.rawCode = `WS_${code}`;
        err.requestId = this.requestId;
        this.fail(err);
      } else {
        this.closed = true;
        this.settleFinish();
      }
    });
  }

  fail(err) {
    if (this.aborted || this.closed) return;
    this.closed = true;
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
    const info = classifyRealtimeError(err, {
      provider: 'dashscope',
      apiKey: this.cfg.apiKey,
      connected: this.started,
      requestId: this.requestId
    });
    const detail = info.rawCode ? `[${info.rawCode}] ${info.messageZh}` : info.messageZh;
    this.cb.onError?.(detail, info);
  }

  settleFinish() {
    const r = this.finishResolve;
    this.finishResolve = null;
    r?.();
  }

  push(pcm) {
    if (this.aborted || this.closed || this.closing || !pcm || pcm.length === 0) return;
    const buf = f32ToPcm16(pcm);
    if (this.started && this.ws.readyState === 1) this.ws.send(buf);
    else this.pending.push(buf);
  }

  cancel() {
    if (this.aborted) return;
    this.aborted = true;
    this.closed = true;
    this.pending = [];
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
  }

  async close() {
    if (this.aborted || this.closed || this.closing) return;
    this.closing = true;
    if (this.ws.readyState !== 1 || !this.started) {
      this.closed = true;
      try { this.ws.terminate(); } catch {}
      return;
    }
    const finishTask = {
      header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' },
      payload: { input: {} }
    };
    const finished = new Promise((res) => { this.finishResolve = res; });
    try {
      this.ws.send(JSON.stringify(finishTask));
    } catch {
      this.closed = true;
      this.settleFinish();
      return;
    }
    const timeout = new Promise((res) => setTimeout(res, FINISH_TIMEOUT_MS).unref?.());
    await Promise.race([finished, timeout]);
    this.closed = true;
    try { this.ws.terminate(); } catch {}
  }
}

class DashScopeRealtimeEngine {
  constructor(cfg, WebSocketImpl) {
    this.cfg = cfg;
    this.WebSocketImpl = WebSocketImpl;
    this.provider = 'dashscope';
    this.ep = 'cloud-rt';
    this.streaming = true;
    this.loadMs = 0;
    this.warmMs = 0;
    this.lidAvailable = false;
  }

  static async load(cfg, { WebSocket } = {}) {
    const check = validateRealtimeConfig({ ...cfg, provider: 'dashscope' });
    if (!check.ok) throw makeStructuredError(check);
    const WS = WebSocket || require('ws');
    return new DashScopeRealtimeEngine(check.normalized, WS);
  }

  async warmup() {
    return 0;
  }

  openSession(cb, opts = {}) {
    return new DashScopeRtSession(this.cfg, cb, opts.language, this.WebSocketImpl);
  }
}

async function createRealtimeEngine(cfg, opts = {}) {
  const provider = inferRealtimeProvider(cfg);
  if (provider === 'doubao') {
    return DoubaoRealtimeEngine.load(cfg, opts);
  }
  return DashScopeRealtimeEngine.load(cfg, opts);
}

// =============================================================================
// Unified Connection Handshake Test & Live Audio "Test Transcribe" (试转写)
// =============================================================================

async function testRealtimeConnection(cfg, opts = {}) {
  const started = Date.now();
  const provider = inferRealtimeProvider(cfg);
  const check = validateRealtimeConfig({ ...cfg, provider });
  if (!check.ok) {
    return {
      ok: false,
      mode: 'handshake',
      provider,
      connected: false,
      stage: check.stage,
      code: check.code,
      latencyMs: Date.now() - started,
      transcript: '',
      messageZh: check.messageZh,
      hintZh: check.hintZh,
      rawCode: check.code,
      requestId: '',
      retryable: false
    };
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 12000;
  let connected = false;
  let reqId = '';
  let engine;
  try {
    engine = await createRealtimeEngine(check.normalized, opts);
  } catch (e) {
    return { ...classifyRealtimeError(e, { ...check.normalized, connected }), mode: 'handshake', latencyMs: Date.now() - started, transcript: '' };
  }

  let session = null;
  let timer = null;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        err ? reject(err) : resolve();
      };
      timer = setTimeout(() => {
        const te = new Error('realtime handshake timed out');
        te.name = 'TimeoutError';
        done(te);
      }, timeoutMs);
      timer.unref?.();

      session = engine.openSession(
        {
          onReady: (meta) => {
            connected = true;
            if (meta?.requestId) reqId = meta.requestId;
            done();
          },
          onPartial: () => {},
          onSentence: () => {},
          onError: (msg, info) => {
            const err = new Error(msg);
            if (info) err.mcAsr = info;
            done(err);
          }
        },
        { language: opts.language || 'auto' }
      );
    });

    return {
      ok: true,
      mode: 'handshake',
      provider,
      connected: true,
      stage: 'done',
      code: 'OK',
      latencyMs: Date.now() - started,
      transcript: '',
      messageZh: `连接成功（${REALTIME_PROVIDERS[provider]?.labelZh || provider} 握手就绪）`,
      hintZh: '建议再点击「试转写」发送一段内置样本音频，端到端确认音频分包与识别文本正常。',
      rawCode: '',
      requestId: reqId,
      retryable: false
    };
  } catch (e) {
    return {
      ...classifyRealtimeError(e, { ...check.normalized, connected, requestId: reqId }),
      mode: 'handshake',
      latencyMs: Date.now() - started,
      transcript: ''
    };
  } finally {
    clearTimeout(timer);
    if (session) {
      await Promise.race([
        session.close().catch(() => {}),
        new Promise((r) => setTimeout(r, 2000).unref?.())
      ]);
      session.cancel?.();
    }
  }
}

async function testRealtimeTranscribe(cfg, pcmFloat32, opts = {}) {
  const started = Date.now();
  const provider = inferRealtimeProvider(cfg);
  const check = validateRealtimeConfig({ ...cfg, provider });
  if (!check.ok) {
    return {
      ok: false,
      mode: 'transcribe',
      provider,
      connected: false,
      stage: check.stage,
      code: check.code,
      latencyMs: Date.now() - started,
      transcript: '',
      partials: [],
      messageZh: check.messageZh,
      hintZh: check.hintZh,
      rawCode: check.code,
      requestId: '',
      retryable: false
    };
  }
  if (!pcmFloat32 || pcmFloat32.length === 0) {
    return {
      ok: false,
      mode: 'transcribe',
      provider,
      connected: false,
      stage: 'audio',
      code: 'AUDIO_FORMAT_ERROR',
      latencyMs: Date.now() - started,
      transcript: '',
      partials: [],
      messageZh: '缺少测试样本音频数据',
      hintZh: '请检查内置测试音频 test-audio/asr-test-zh.wav 是否完整。',
      rawCode: 'EMPTY_TEST_AUDIO',
      requestId: '',
      retryable: false
    };
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 18000;
  const paceMs = Number.isFinite(Number(opts.paceMs)) ? Math.max(0, Number(opts.paceMs)) : 30;
  let connected = false;
  let reqId = '';
  const sentences = [];
  const partials = [];
  let runtimeErr = null;
  let engine;

  try {
    engine = await createRealtimeEngine(check.normalized, opts);
  } catch (e) {
    return { ...classifyRealtimeError(e, { ...check.normalized, connected }), mode: 'transcribe', latencyMs: Date.now() - started, transcript: '', partials };
  }

  let session = null;
  let timer = null;
  let timedOut = false;

  try {
    let resolveReady;
    let rejectReady;
    const readyPromise = new Promise((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });

    timer = setTimeout(() => {
      timedOut = true;
      const te = new Error(connected ? 'waiting for transcript timed out' : 'realtime handshake timed out');
      te.name = 'TimeoutError';
      runtimeErr = te;
      rejectReady?.(te);
      session?.cancel?.();
    }, timeoutMs);
    timer.unref?.();

    session = engine.openSession(
      {
        onReady: (meta) => {
          connected = true;
          if (meta?.requestId) reqId = meta.requestId;
          resolveReady?.();
        },
        onPartial: (text) => {
          if (text) partials.push(text);
        },
        onSentence: (s) => {
          if (s?.text) sentences.push(String(s.text).trim());
        },
        onError: (msg, info) => {
          const err = new Error(msg);
          if (info) err.mcAsr = info;
          runtimeErr = err;
          rejectReady?.(err);
        }
      },
      { language: opts.language || 'chinese' }
    );

    await readyPromise;

    // Stream 16kHz Float32 PCM in 200ms (3200 samples) frames
    const SAMPLES_PER_CHUNK = 3200;
    for (let off = 0; off < pcmFloat32.length; off += SAMPLES_PER_CHUNK) {
      if (runtimeErr || timedOut) break;
      session.push(pcmFloat32.subarray(off, Math.min(off + SAMPLES_PER_CHUNK, pcmFloat32.length)));
      if (paceMs > 0) {
        await new Promise((r) => setTimeout(r, paceMs));
      }
    }

    if (!runtimeErr && !timedOut) {
      await session.close();
    }

    if (runtimeErr) throw runtimeErr;

    const transcript = sentences.join(' ').trim();
    if (!transcript) {
      return {
        ok: false,
        mode: 'transcribe',
        provider,
        connected: true,
        stage: 'transcribe',
        code: 'NO_TRANSCRIPT',
        latencyMs: Date.now() - started,
        transcript: '',
        partials,
        messageZh: '已连接，试转写失败：服务端未返回最终识别文本',
        hintZh: partials.length > 0
          ? `仅收到临时片段（${partials[partials.length - 1]}）但未定稿，请检查模型配置或稍后重试。`
          : '握手正常但未能识别测试样本，请确认 Resource ID / 模型支持中文或英文 16kHz PCM 语音。',
        rawCode: 'EMPTY_TRANSCRIPT',
        requestId: reqId,
        retryable: true
      };
    }

    return {
      ok: true,
      mode: 'transcribe',
      provider,
      connected: true,
      stage: 'done',
      code: 'OK',
      latencyMs: Date.now() - started,
      transcript,
      partials,
      messageZh: `试转写成功：「${transcript}」`,
      hintZh: '实时连接、音频分包与定稿回调均已端到端验证通过。',
      rawCode: '',
      requestId: reqId,
      retryable: false
    };
  } catch (e) {
    const info = classifyRealtimeError(e, { ...check.normalized, connected, requestId: reqId });
    if (connected && !info.messageZh.startsWith('已连接')) {
      info.messageZh = `已连接，试转写失败：${info.messageZh}`;
    }
    return {
      ...info,
      mode: 'transcribe',
      latencyMs: Date.now() - started,
      transcript: sentences.join(' ').trim(),
      partials
    };
  } finally {
    clearTimeout(timer);
    session?.cancel?.();
  }
}

// =============================================================================
// Per-Provider Realtime Settings Normalization & Migration (DashScope / Doubao)
// =============================================================================

function emptyProfileFor(provider) {
  if (provider === 'doubao') {
    return {
      baseUrl: REALTIME_PROVIDERS.doubao.defaultBaseUrl,
      model: REALTIME_PROVIDERS.doubao.defaultModel,
      resourceId: REALTIME_PROVIDERS.doubao.defaultResourceId,
      authMode: 'api-key',
      appKey: '',
      apiKeyEnc: '',
      apiKeyHint: undefined,
      verification: undefined
    };
  }
  return {
    baseUrl: '',
    model: '',
    apiKeyEnc: '',
    apiKeyHint: undefined,
    verification: undefined
  };
}

function normalizeRealtimeSettings(rawRealtime = {}) {
  const src = rawRealtime && typeof rawRealtime === 'object' ? rawRealtime : {};
  const activeProvider = inferRealtimeProvider(src);
  const existingProfiles = src.profiles && typeof src.profiles === 'object' ? src.profiles : {};

  const dashscope = {
    ...emptyProfileFor('dashscope'),
    ...(existingProfiles.dashscope && typeof existingProfiles.dashscope === 'object' ? existingProfiles.dashscope : {})
  };
  const doubao = {
    ...emptyProfileFor('doubao'),
    ...(existingProfiles.doubao && typeof existingProfiles.doubao === 'object' ? existingProfiles.doubao : {})
  };

  // Migrate legacy flat top-level config into its inferred provider profile without losing credentials
  const hasFlatData = Boolean(src.baseUrl || src.model || src.apiKeyEnc || src.resourceId);
  if (hasFlatData) {
    if (activeProvider === 'doubao' && !existingProfiles.doubao) {
      if (src.baseUrl) doubao.baseUrl = src.baseUrl;
      if (src.model) doubao.model = src.model;
      if (src.resourceId) doubao.resourceId = src.resourceId;
      if (src.authMode) doubao.authMode = src.authMode === 'app-access' ? 'app-access' : 'api-key';
      if (src.appKey) doubao.appKey = src.appKey;
      if (src.apiKeyEnc) doubao.apiKeyEnc = src.apiKeyEnc;
      if (src.apiKeyHint) doubao.apiKeyHint = src.apiKeyHint;
      if (src.verification) doubao.verification = src.verification;
    } else if (activeProvider === 'dashscope' && !existingProfiles.dashscope) {
      if (src.baseUrl) dashscope.baseUrl = src.baseUrl;
      if (src.model) dashscope.model = src.model;
      if (src.apiKeyEnc) dashscope.apiKeyEnc = src.apiKeyEnc;
      if (src.apiKeyHint) dashscope.apiKeyHint = src.apiKeyHint;
      if (src.verification) dashscope.verification = src.verification;
    }
  }

  const active = activeProvider === 'doubao' ? doubao : dashscope;
  return {
    provider: activeProvider,
    baseUrl: active.baseUrl || '',
    model: active.model || '',
    resourceId: activeProvider === 'doubao' ? (active.resourceId || '') : '',
    authMode: activeProvider === 'doubao' ? (active.authMode === 'app-access' ? 'app-access' : 'api-key') : 'api-key',
    appKey: activeProvider === 'doubao' ? (active.appKey || '') : '',
    apiKeyEnc: active.apiKeyEnc || '',
    apiKeyHint: active.apiKeyHint,
    verification: active.verification,
    profiles: {
      dashscope,
      doubao
    }
  };
}

function publicRealtimeSettings(rawRealtime = {}) {
  const norm = normalizeRealtimeSettings(rawRealtime);
  const ds = norm.profiles.dashscope;
  const db = norm.profiles.doubao;
  return {
    provider: norm.provider,
    baseUrl: norm.baseUrl,
    model: norm.model,
    resourceId: norm.resourceId,
    authMode: norm.authMode,
    appKey: norm.appKey,
    apiKeySet: Boolean(norm.apiKeyEnc),
    apiKeyHint: norm.apiKeyHint,
    verification: norm.verification,
    profiles: {
      dashscope: {
        baseUrl: ds.baseUrl || '',
        model: ds.model || '',
        apiKeySet: Boolean(ds.apiKeyEnc),
        apiKeyHint: ds.apiKeyHint,
        verification: ds.verification
      },
      doubao: {
        baseUrl: db.baseUrl || '',
        model: db.model || '',
        resourceId: db.resourceId || '',
        authMode: db.authMode === 'app-access' ? 'app-access' : 'api-key',
        appKey: db.appKey || '',
        apiKeySet: Boolean(db.apiKeyEnc),
        apiKeyHint: db.apiKeyHint,
        verification: db.verification
      }
    }
  };
}

module.exports = {
  REALTIME_PROVIDERS,
  DOUBAO_PROTO,
  inferRealtimeProvider,
  sanitizeDiagnosticText,
  validateRealtimeConfig,
  classifyRealtimeError,
  f32ToPcm16,
  encodeDoubaoFullClientRequest,
  encodeDoubaoAudioPacket,
  decodeDoubaoServerPacket,
  buildDoubaoHeaders,
  buildDoubaoInitPayload,
  DashScopeRealtimeEngine,
  DoubaoRealtimeEngine,
  createRealtimeEngine,
  testRealtimeConnection,
  testRealtimeTranscribe,
  normalizeRealtimeSettings,
  publicRealtimeSettings
};
