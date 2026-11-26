'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const REALTIME_PROVIDER_IDS = Object.freeze([
  'dashscope',
  'doubao',
  'openai-realtime',
  'deepgram',
  'tencent',
  'xfyun'
]);

const REALTIME_PROVIDERS = Object.freeze({
  dashscope: Object.freeze({
    id: 'dashscope',
    labelZh: '阿里云百炼 DashScope（Paraformer / Fun-ASR）',
    defaultBaseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    defaultModel: 'paraformer-realtime-v2',
    needsResourceId: false,
    needsAppId: false,
    supportsAuthModes: false
  }),
  doubao: Object.freeze({
    id: 'doubao',
    labelZh: '火山豆包流式 ASR v3（SAUC 二进制协议）',
    defaultBaseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    defaultModel: 'bigmodel',
    defaultResourceId: 'volc.seedasr.sauc.duration',
    needsResourceId: true,
    needsAppId: false,
    supportsAuthModes: true
  }),
  'openai-realtime': Object.freeze({
    id: 'openai-realtime',
    labelZh: 'OpenAI Realtime 转写协议（兼容 OpenAI & 阿里 Qwen3-ASR 实时）',
    defaultBaseUrl: 'wss://api.openai.com/v1/realtime?intent=transcription',
    defaultModel: 'gpt-4o-mini-transcribe',
    needsResourceId: false,
    needsAppId: false,
    supportsAuthModes: false
  }),
  deepgram: Object.freeze({
    id: 'deepgram',
    labelZh: 'Deepgram Live 流式协议（Nova-3 / Nova-2）',
    defaultBaseUrl: 'wss://api.deepgram.com/v1/listen',
    defaultModel: 'nova-3',
    needsResourceId: false,
    needsAppId: false,
    supportsAuthModes: false
  }),
  tencent: Object.freeze({
    id: 'tencent',
    labelZh: '腾讯云实时语音识别（WebSocket v2）',
    defaultBaseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
    defaultModel: '16k_zh',
    needsResourceId: false,
    needsAppId: true,
    needsSecretId: true,
    supportsAuthModes: false
  }),
  xfyun: Object.freeze({
    id: 'xfyun',
    labelZh: '科大讯飞实时语音转写（RTASR）',
    defaultBaseUrl: 'wss://rtasr.xfyun.cn/v1/ws',
    defaultModel: 'cn',
    needsResourceId: false,
    needsAppId: true,
    supportsAuthModes: false
  })
});

const SEGMENT_PROTOCOLS = Object.freeze({
  'openai-transcriptions': Object.freeze({
    id: 'openai-transcriptions',
    labelZh: 'OpenAI 标准 /audio/transcriptions（兼容硅基流动 / 智谱 / Groq / OpenAI / 中转站）'
  }),
  'chat-audio': Object.freeze({
    id: 'chat-audio',
    labelZh: '音频对话 /chat/completions（input_audio · 兼容 gpt-4o-audio / qwen-audio）'
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
const XFYUN_CHUNK_BYTES = 1280; // 40ms @ 16kHz 16-bit mono PCM (iFlytek recommended)

const SEGMENTATION_PROFILES = Object.freeze({
  fast: Object.freeze({
    id: 'fast',
    labelZh: '极速抢答（停顿短、首字最快）',
    doubaoEndWindowMs: 450,
    dashscopeSilenceMs: 450,
    qwenSilenceMs: 450,
    openaiSilenceMs: 400,
    deepgramEndpointingMs: 250
  }),
  balanced: Object.freeze({
    id: 'balanced',
    labelZh: '均衡（推荐 · 低延迟且不易碎句）',
    doubaoEndWindowMs: 650,
    dashscopeSilenceMs: 700,
    qwenSilenceMs: 600,
    openaiSilenceMs: 550,
    deepgramEndpointingMs: 350
  }),
  long: Object.freeze({
    id: 'long',
    labelZh: '长句连贯（适合思考停顿多的面试官）',
    doubaoEndWindowMs: 1100,
    dashscopeSilenceMs: 1100,
    qwenSilenceMs: 950,
    openaiSilenceMs: 900,
    deepgramEndpointingMs: 700
  })
});

function normalizeSegmentationMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'fast' || m === 'long' || m === 'balanced') return m;
  return 'balanced';
}

function getSegmentationProfile(mode) {
  return SEGMENTATION_PROFILES[normalizeSegmentationMode(mode)] || SEGMENTATION_PROFILES.balanced;
}

function computePcmRms(pcm) {
  const len = pcm?.length || 0;
  if (!len) return 0;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const v = pcm[i];
    sum += v * v;
  }
  return Math.sqrt(sum / len);
}

/**
 * Lightweight cross-channel echo gate for Windows speaker-playback interviews:
 * When system loopback ("them") is actively outputting interviewer audio, acoustic
 * leakage into the user's mic ("me") tends to rise in lockstep at moderate RMS.
 * Suppressing idle-stream wakeups during active "them" output avoids opening a
 * redundant cloud ASR stream for speaker echo while still letting loud near-field
 * barge-in speech through.
 */
function createCrossChannelEchoGate({
  hangoverMs = 260,
  themActiveRms = 0.012,
  meBargeInFloorRms = 0.06,
  meToThemRatio = 1.5
} = {}) {
  let lastThemActiveAt = 0;
  let recentThemRms = 0;

  return {
    observeThem({ rms = 0, speechActive = false, now = Date.now() } = {}) {
      if (speechActive || rms >= themActiveRms) {
        lastThemActiveAt = now;
        recentThemRms = recentThemRms > 0 ? (recentThemRms * 0.55 + rms * 0.45) : rms;
      } else if (now - lastThemActiveAt > hangoverMs) {
        recentThemRms *= 0.6;
        if (recentThemRms < 0.001) recentThemRms = 0;
      }
    },
    shouldSuppressMe({ rms = 0, meStreamOpen = false, now = Date.now() } = {}) {
      const themActive = (now - lastThemActiveAt) <= hangoverMs && recentThemRms >= themActiveRms;
      if (!themActive) return false;
      const bargeInThreshold = Math.max(meBargeInFloorRms, recentThemRms * meToThemRatio);
      if (rms >= bargeInThreshold) return false;
      // Suppress waking up an idle "me" stream from speaker echo; once "me" is genuinely open,
      // let text-level echo deduplication handle edge overlap cleanly without cutting user speech.
      return !meStreamOpen;
    },
    getState() {
      return { lastThemActiveAt, recentThemRms };
    }
  };
}

function isLocalWsUrl(url) {
  return /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(String(url || '').trim());
}

function isLocalHttpUrl(url) {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(String(url || '').trim());
}

function isDashScopeRealtimeDialect(cfg = {}) {
  const url = String(cfg?.baseUrl || '').trim().toLowerCase();
  const model = String(cfg?.model || '').trim().toLowerCase();
  return (
    url.includes('dashscope') ||
    url.includes('aliyuncs.com') ||
    url.includes('maas.aliyuncs.com') ||
    model.startsWith('qwen')
  );
}

function inferRealtimeProvider(cfg = {}) {
  const explicit = String(cfg?.provider || '').trim().toLowerCase();
  if (explicit === 'doubao' || explicit === 'volcengine' || explicit === 'seedasr') return 'doubao';
  if (explicit === 'openai-realtime' || explicit === 'openai' || explicit === 'qwen-realtime') return 'openai-realtime';
  if (explicit === 'deepgram') return 'deepgram';
  if (explicit === 'tencent' || explicit === 'qcloud') return 'tencent';
  if (explicit === 'xfyun' || explicit === 'iflytek' || explicit === 'rtasr') return 'xfyun';
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
  if (url.includes('api.deepgram.com') || url.includes('/v1/listen')) return 'deepgram';
  if (url.includes('asr.cloud.tencent.com')) return 'tencent';
  if (url.includes('rtasr.xfyun.cn') || url.includes('xfyun.cn')) return 'xfyun';
  if (
    url.includes('/v1/realtime') ||
    url.includes('intent=transcription') ||
    String(cfg?.model || '').toLowerCase().includes('qwen3-asr')
  ) {
    return 'openai-realtime';
  }
  return 'dashscope';
}

function inferSegmentProtocol(cfg = {}) {
  const explicit = String(cfg?.protocol || '').trim().toLowerCase();
  if (explicit === 'chat-audio' || explicit === 'chat-completions') return 'chat-audio';
  if (explicit === 'openai-transcriptions' || explicit === 'transcriptions' || explicit === 'multipart') {
    return 'openai-transcriptions';
  }
  const url = String(cfg?.baseUrl || '').trim().toLowerCase();
  const model = String(cfg?.model || '').trim().toLowerCase();
  if (url.endsWith('/chat/completions') || /audio-preview|qwen.*audio|omni/i.test(model)) {
    return 'chat-audio';
  }
  return 'openai-transcriptions';
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
    .replace(/Token\s+[A-Za-z0-9._\-]{8,}/gi, 'Token [REDACTED]')
    .replace(/(X-Api-(?:Key|Access-Key|App-Key)\s*[:=]\s*)([^\s,;'"}\]]+)/gi, '$1[REDACTED]')
    .replace(/((?:signature|signa|secretid|api_key)\s*=\s*)([^&\s'"]+)/gi, '$1[REDACTED]')
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

function resampleF32Linear(pcm, fromRate, toRate) {
  if (!pcm || pcm.length === 0 || fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(pcm.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = pcm[idx] ?? 0;
    const s1 = pcm[Math.min(idx + 1, pcm.length - 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

function encodeWav16kMono(pcm, sampleRate = 16000) {
  const dataLen = (pcm?.length || 0) * 2;
  const buf = Buffer.allocUnsafe(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  let off = 44;
  for (let i = 0; i < (pcm?.length || 0); i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? (s * 32768) | 0 : (s * 32767) | 0, off);
    off += 2;
  }
  return buf;
}

function languageHintsDashScope(language) {
  if (language === 'chinese') return ['zh'];
  if (language === 'english') return ['en'];
  return undefined;
}

function languageIso639(language) {
  if (language === 'chinese') return 'zh';
  if (language === 'english') return 'en';
  return undefined;
}

function makeStructuredError({
  stage = 'connect',
  code = 'UNKNOWN_ERROR',
  messageZh = '语音识别连接失败',
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
  const appId = String(cfg?.appId || '').trim();
  const appKey = String(cfg?.appKey || '').trim();

  if (!baseUrl) {
    const meta = REALTIME_PROVIDERS[provider] || REALTIME_PROVIDERS.dashscope;
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_ENDPOINT',
      messageZh: '未填写实时 ASR WebSocket 地址',
      hintZh: `请填写 WebSocket 地址，例如 ${meta.defaultBaseUrl}`
    };
  }
  if (!/^wss?:\/\//i.test(baseUrl)) {
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_ENDPOINT',
      messageZh: '实时 ASR 地址协议无效（需以 ws:// 或 wss:// 开头）',
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

  if (provider === 'tencent') {
    if (!appId) {
      return {
        ok: false,
        stage: 'config',
        code: 'MISSING_APP_ID',
        messageZh: '缺少腾讯云 AppID',
        hintZh: '请在腾讯云语音识别控制台「账号信息」复制数字 AppID 填入。'
      };
    }
    if (!appKey && !isLocalWsUrl(baseUrl)) {
      return {
        ok: false,
        stage: 'config',
        code: 'MISSING_APP_KEY',
        messageZh: '缺少腾讯云 SecretId',
        hintZh: '请在腾讯云「访问管理 → API 密钥管理」获取 SecretId 与 SecretKey。'
      };
    }
    if (!apiKey && !isLocalWsUrl(baseUrl)) {
      return {
        ok: false,
        stage: 'config',
        code: 'INVALID_KEY',
        messageZh: '未填写腾讯云 SecretKey',
        hintZh: '请在密钥栏填写对应的 SecretKey 用于计算 HMAC-SHA1 实时签名。'
      };
    }
    return { ok: true, provider, normalized: { provider, baseUrl, model: model || '16k_zh', appId, appKey, apiKey } };
  }

  if (provider === 'xfyun') {
    if (!appId) {
      return {
        ok: false,
        stage: 'config',
        code: 'MISSING_APP_ID',
        messageZh: '缺少科大讯飞 AppID',
        hintZh: '请在讯飞开放平台「实时语音转写」应用详情页复制 AppID。'
      };
    }
    if (!apiKey && !isLocalWsUrl(baseUrl)) {
      return {
        ok: false,
        stage: 'config',
        code: 'INVALID_KEY',
        messageZh: '未填写科大讯飞实时语音转写 APIKey',
        hintZh: '请填写讯飞「实时语音转写（RTASR）」专用的 APIKey（非语音听写 IAT 的 APISecret）。'
      };
    }
    return { ok: true, provider, normalized: { provider, baseUrl, model: model || 'cn', appId, apiKey } };
  }

  if (provider === 'openai-realtime') {
    if (!model) {
      return {
        ok: false,
        stage: 'config',
        code: 'MISSING_MODEL',
        messageZh: '未填写 Realtime 转写模型名',
        hintZh: '例如 OpenAI 填 gpt-4o-mini-transcribe / gpt-4o-transcribe，阿里云百炼填 qwen3-asr-flash-realtime。'
      };
    }
    if (!apiKey && !isLocalWsUrl(baseUrl)) {
      return {
        ok: false,
        stage: 'config',
        code: 'INVALID_KEY',
        messageZh: '未填写 Realtime API Key',
        hintZh: '请填写 OpenAI / 百炼或中转站 API Key（sk-...）后再试。'
      };
    }
    return { ok: true, provider, normalized: { provider, baseUrl, model, apiKey } };
  }

  if (provider === 'deepgram') {
    if (!apiKey && !isLocalWsUrl(baseUrl)) {
      return {
        ok: false,
        stage: 'config',
        code: 'INVALID_KEY',
        messageZh: '未填写 Deepgram API Key',
        hintZh: '请在 Deepgram Console 生成 API Key 后填入（请求头使用 Authorization: Token）。'
      };
    }
    return { ok: true, provider, normalized: { provider, baseUrl, model: model || 'nova-3', apiKey } };
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

function validateSegmentConfig(cfg = {}) {
  const protocol = inferSegmentProtocol(cfg);
  const baseUrl = String(cfg?.baseUrl || '').trim();
  const model = String(cfg?.model || '').trim();
  const apiKey = String(cfg?.apiKey || '').trim();

  if (!baseUrl) {
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_ENDPOINT',
      messageZh: '未填写云端分段 ASR Base URL',
      hintZh: '例如硅基流动 https://api.siliconflow.cn/v1、智谱 https://open.bigmodel.cn/api/paas/v4、Groq https://api.groq.com/openai/v1 或任意中转站 /v1。'
    };
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_ENDPOINT',
      messageZh: '云端分段 ASR 地址需以 http:// 或 https:// 开头',
      hintZh: '流式 wss:// 地址请切换到「云端流式实时（WebSocket）」配置。'
    };
  }
  if (!model) {
    return {
      ok: false,
      stage: 'config',
      code: 'MISSING_MODEL',
      messageZh: '未填写分段转录模型名',
      hintZh: '可点击「获取模型」拉取，或手动填入如 FunAudioLLM/SenseVoiceSmall、glm-asr-2512、whisper-large-v3-turbo、gpt-4o-mini-transcribe。'
    };
  }
  if (!apiKey && !isLocalHttpUrl(baseUrl)) {
    return {
      ok: false,
      stage: 'config',
      code: 'INVALID_KEY',
      messageZh: '未填写云端分段 ASR API Key',
      hintZh: '请填写有效 API Key（本地 http://127.0.0.1 服务可留空）。'
    };
  }
  return { ok: true, protocol, normalized: { protocol, baseUrl, model, apiKey } };
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
      messageZh: connected ? '已连接，但等待转写结果超时' : '连接语音识别服务超时',
      hintZh: connected
        ? '握手已成功，但服务端未在超时时间内返回最终文本；请检查音频格式、模型/资源配置或稍后重试。'
        : '请检查网络连通性、接口地址是否正确，或确认代理未拦截连接。',
      rawCode: rawCode || 'TIMEOUT',
      requestId,
      retryable: true
    };
  }

  if (
    statusCode === 401 ||
    /45000010|4002|10105|10106|10107|10110|invalid[\s_-]?api[\s_-]?key|unauthorized|authentication|auth\s*fail|signature|invalid\s*token|access[\s_-]?key|illegal\s*access/i.test(lower) ||
    /^(?:45000010|4002|10105|10106|10107|10110)$/i.test(rawCode)
  ) {
    const hintMap = {
      doubao: '请确认控制台密钥类型：新版单 Key 选「API Key（X-Api-Key）」；旧版选「App ID + Access Token」并核对两个字段。',
      tencent: '请核对腾讯云 AppID、SecretId 与 SecretKey 是否成套对应，且本机系统时间准确（签名依赖当前时间戳）。',
      xfyun: '请核对讯飞 AppID 与「实时语音转写（RTASR）」专用 APIKey，并确认本机系统时间准确。',
      deepgram: '请核对 Deepgram API Key 是否有效（需具有 listen 权限）。',
      'openai-realtime': '请核对 API Key 是否有权限调用 Realtime 接口（OpenAI 或百炼对应地域 Key）。'
    };
    return {
      ok: false,
      provider,
      connected,
      stage: 'auth',
      code: 'AUTH_FAILED',
      messageZh: '鉴权失败：密钥无效、签名不匹配或无权限',
      hintZh: hintMap[provider] || '请检查 API Key 是否完整、无多余空格，且属于对应控制台与地域。',
      rawCode: rawCode || 'AUTH_FAILED',
      requestId,
      retryable: false
    };
  }

  if (
    statusCode === 403 ||
    /45000030|40000005|4003|4004|10114|10800|resource.*not|not\s*granted|permission|accessdenied|forbidden|quota|arrearage|insufficient|unsubscribed|not\s*activated|model.*not.*found|no\s*credit/i.test(lower) ||
    /^(?:45000030|40000005|4003|4004|10114|10800|AccessDenied|Arrearage)$/i.test(rawCode)
  ) {
    return {
      ok: false,
      provider,
      connected,
      stage: 'auth',
      code: 'RESOURCE_UNAUTHORIZED',
      messageZh: provider === 'doubao'
        ? '豆包资源未开通或无权访问（Resource ID 权限不足）'
        : '服务商拒绝访问：服务未开通、模型不可用或余额不足',
      hintZh: provider === 'doubao'
        ? '请核对 X-Api-Resource-Id 是否已在火山控制台开通（2.0 小时版：volc.seedasr.sauc.duration；1.0 小时版：volc.bigasr.sauc.duration），并检查余额。'
        : '请确认已在对应平台开通该语音识别服务/模型，且账户余额或免费额度充足。',
      rawCode: rawCode || 'RESOURCE_UNAUTHORIZED',
      requestId,
      retryable: false
    };
  }

  if (
    /45000001|45000002|45000151|4001|10109|audio|codec|sample[\s_-]?rate|format|invalid\s*param|invalidparameter|illegal\s*packet|decode|pcm|multipart/i.test(lower) ||
    /^(?:45000001|45000002|45000151|4001|10109|InvalidParameter)$/i.test(rawCode)
  ) {
    return {
      ok: false,
      provider,
      connected,
      stage: 'audio',
      code: 'AUDIO_FORMAT_ERROR',
      messageZh: connected ? '已连接，试转写失败：音频参数或帧格式不被服务端接受' : '请求参数或音频格式不被服务端接受',
      hintZh: '请核对所选协议族是否与目标接口一致（例如 OpenAI /audio/transcriptions vs /chat/completions，或流式协议类型与模型名）。',
      rawCode: rawCode || 'AUDIO_FORMAT_ERROR',
      requestId,
      retryable: false
    };
  }

  if (/enotfound|econnrefused|econnreset|ehostunreach|enetunreach|tls|cert|socket|network|fetch failed|unexpected server response: 5\d\d/i.test(lower) || statusCode >= 500) {
    return {
      ok: false,
      provider,
      connected,
      stage: connected ? 'transcribe' : 'connect',
      code: 'NETWORK_ERROR',
      messageZh: connected ? '实时识别中途断线（网络异常）' : '无法连接到语音服务器（网络或地址异常）',
      hintZh: '请检查网络连接、接口地址拼写及代理设置后重试。',
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
      : `语音服务连接失败：${rawText || '服务端拒绝连接'}`,
    hintZh: '请展开查看原始错误码与请求 ID，核对所选协议、地址、模型名与鉴权字段。',
    rawCode: rawCode || 'UNKNOWN',
    requestId,
    retryable: false
  };
}

// =============================================================================
// Shared WS Upgrade Rejection Inspector
// =============================================================================

function attachUnexpectedResponseHandler(ws, onFail) {
  ws.on('unexpected-response', (_req, res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8').slice(0, 400);
      const statusCode = res.statusCode || 0;
      const apiStatus = res.headers?.['x-api-status-code'] || res.headers?.['dg-error'] || '';
      const apiMsg = res.headers?.['x-api-message'] || '';
      const logId =
        res.headers?.['x-tt-logid'] ||
        res.headers?.['x-dashscope-request-id'] ||
        res.headers?.['dg-request-id'] ||
        res.headers?.['x-request-id'] ||
        '';
      const err = new Error([apiMsg, body, `HTTP ${statusCode}`].filter(Boolean).join(' · '));
      err.statusCode = statusCode;
      err.rawCode = apiStatus ? String(apiStatus) : `HTTP ${statusCode}`;
      err.requestId = String(logId || '');
      onFail(err);
    });
  });
}

// =============================================================================
// 1. Doubao SAUC v3 Binary Protocol Adapter
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

function buildDoubaoInitPayload(cfg, language, opts = {}) {
  const audio = {
    format: 'pcm',
    codec: 'raw',
    rate: 16000,
    bits: 16,
    channel: 1
  };
  if (language === 'english' && /nostream/i.test(String(cfg?.baseUrl || ''))) {
    audio.language = 'en-US';
  }
  const segProf = getSegmentationProfile(opts.segmentationMode || cfg?.segmentationMode);
  return {
    user: { uid: 'cuedesk' },
    audio,
    request: {
      model_name: cfg.model || 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      show_utterances: true,
      result_type: 'single',
      end_window_size: segProf.doubaoEndWindowMs
    }
  };
}

class DoubaoRtSession {
  constructor(cfg, cb, language, WebSocketImpl, opts = {}) {
    this.cfg = cfg;
    this.cb = cb;
    this.language = language || 'auto';
    this.sessionOpts = opts || {};
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

    this.ws = new WebSocketImpl(cfg.baseUrl, {
      headers: buildDoubaoHeaders(cfg, this.connectId),
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
        const initFrame = encodeDoubaoFullClientRequest(
          buildDoubaoInitPayload(cfg, this.language, this.sessionOpts),
          this.seq
        );
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
    const combined = this.pendingBytes.length === 1 ? this.pendingBytes[0] : Buffer.concat(this.pendingBytes, this.pendingByteLen);
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
    return new DoubaoRealtimeEngine(check.normalized, WebSocket || require('ws'));
  }

  async warmup() { return 0; }

  openSession(cb, opts = {}) {
    return new DoubaoRtSession(this.cfg, cb, opts.language, this.WebSocketImpl, opts);
  }
}

// =============================================================================
// 2. Aliyun DashScope WebSocket Realtime Adapter (also covers local FunASR/MOSS)
// =============================================================================

function buildDashScopeRunTaskPayload(cfg, taskId, language, opts = {}) {
  const hints = languageHintsDashScope(language);
  const segProf = getSegmentationProfile(opts.segmentationMode || cfg?.segmentationMode);
  const supportsSilenceTuning = !isLocalWsUrl(cfg?.baseUrl) && !/-v1$/i.test(String(cfg?.model || '').trim());
  return {
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: cfg.model,
      parameters: {
        format: 'pcm',
        sample_rate: 16000,
        ...(supportsSilenceTuning ? {
          semantic_punctuation_enabled: false,
          max_sentence_silence: segProf.dashscopeSilenceMs
        } : {}),
        ...(hints ? { language_hints: hints } : {})
      },
      input: {}
    }
  };
}

class DashScopeRtSession {
  constructor(cfg, cb, language, WebSocketImpl, opts = {}) {
    this.cfg = cfg;
    this.cb = cb;
    this.sessionOpts = opts || {};
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
      const runTask = buildDashScopeRunTaskPayload(cfg, this.taskId, language, this.sessionOpts);
      this.ws.send(JSON.stringify(runTask));
    });

    this.ws.on('message', (data, isBinary) => {
      if (this.aborted || this.closed || isBinary) return;
      let ev;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
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
    try { this.ws.send(JSON.stringify(finishTask)); } catch {
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
    return new DashScopeRealtimeEngine(check.normalized, WebSocket || require('ws'));
  }

  async warmup() { return 0; }

  openSession(cb, opts = {}) {
    return new DashScopeRtSession(this.cfg, cb, opts.language, this.WebSocketImpl, opts);
  }
}

// =============================================================================
// 3. OpenAI Realtime Transcription WS (also covers Aliyun Qwen3-ASR-Flash-Realtime)
// =============================================================================

function buildOpenAiRealtimeUrl(cfg) {
  const raw = String(cfg?.baseUrl || '').trim();
  const isDash = isDashScopeRealtimeDialect(cfg);
  try {
    const u = new URL(raw);
    if (isDash) {
      if (cfg.model && !u.searchParams.has('model')) {
        u.searchParams.set('model', cfg.model);
      }
    } else if (!u.searchParams.has('intent') && !u.searchParams.has('model')) {
      u.searchParams.set('intent', 'transcription');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function buildOpenAiRealtimeInitEvent(cfg, language, opts = {}) {
  const isDash = isDashScopeRealtimeDialect(cfg);
  const isoLang = languageIso639(language);
  const segProf = getSegmentationProfile(opts.segmentationMode || cfg?.segmentationMode);
  if (isDash) {
    return {
      event_id: `mc_${crypto.randomUUID().slice(0, 12)}`,
      type: 'session.update',
      session: {
        modalities: ['text'],
        input_audio_format: 'pcm',
        sample_rate: 16000,
        input_audio_transcription: isoLang ? { language: isoLang } : {},
        turn_detection: {
          type: 'server_vad',
          threshold: 0.2,
          silence_duration_ms: segProf.qwenSilenceMs
        }
      }
    };
  }
  return {
    type: 'transcription_session.update',
    session: {
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: cfg.model || 'gpt-4o-mini-transcribe',
        ...(isoLang ? { language: isoLang } : {})
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: segProf.openaiSilenceMs
      }
    }
  };
}

class OpenAiRealtimeSession {
  constructor(cfg, cb, language, WebSocketImpl, opts = {}) {
    this.cfg = cfg;
    this.cb = cb;
    this.language = language || 'auto';
    this.sessionOpts = opts || {};
    this.isDash = isDashScopeRealtimeDialect(cfg);
    this.targetRate = this.isDash ? 16000 : 24000;
    this.requestId = '';
    this.started = false;
    this.closing = false;
    this.aborted = false;
    this.closed = false;
    this.pendingB64 = [];
    this.partialAccum = '';
    this.finishResolve = null;

    const wsUrl = buildOpenAiRealtimeUrl(cfg);
    const headers = {
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      'OpenAI-Beta': 'realtime=v1'
    };

    this.ws = new WebSocketImpl(wsUrl, {
      headers,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS
    });

    attachUnexpectedResponseHandler(this.ws, (err) => {
      if (!err.requestId) err.requestId = this.requestId;
      this.fail(err);
    });

    this.ws.on('upgrade', (res) => {
      const id = res?.headers?.['x-request-id'] || res?.headers?.['x-dashscope-request-id'];
      if (id) this.requestId = String(id);
    });

    this.ws.on('open', () => {
      if (this.aborted || this.closed) return;
      try {
        this.ws.send(JSON.stringify(buildOpenAiRealtimeInitEvent(cfg, this.language, this.sessionOpts)));
      } catch (e) {
        this.fail(e);
      }
    });

    this.ws.on('message', (data, isBinary) => {
      if (this.aborted || this.closed || isBinary) return;
      let ev;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
      const kind = ev?.type;
      if (!kind) return;
      if (ev?.session?.id && !this.requestId) this.requestId = String(ev.session.id);

      if (
        kind === 'session.created' ||
        kind === 'session.updated' ||
        kind === 'transcription_session.created' ||
        kind === 'transcription_session.updated'
      ) {
        if (!this.started) {
          this.started = true;
          this.cb.onReady?.({ requestId: this.requestId });
          for (const audio of this.pendingB64) {
            if (this.ws.readyState === 1) {
              this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
            }
          }
          this.pendingB64 = [];
        }
        return;
      }

      if (kind === 'conversation.item.input_audio_transcription.delta') {
        const d = String(ev.delta || '');
        if (d) {
          this.partialAccum += d;
          this.cb.onPartial?.(this.partialAccum.trim());
        }
        return;
      }

      if (kind === 'conversation.item.input_audio_transcription.text') {
        // Aliyun Qwen3-ASR interim event
        const combined = `${ev.text || ''}${ev.stash || ''}`.trim();
        if (combined) {
          this.partialAccum = combined;
          this.cb.onPartial?.(combined);
        }
        return;
      }

      if (kind === 'conversation.item.input_audio_transcription.completed') {
        const text = String(ev.transcript || this.partialAccum || '').trim();
        this.partialAccum = '';
        if (text) {
          this.cb.onSentence?.({ text, beginMs: 0, endMs: 0 });
        }
        if (this.closing) {
          this.closed = true;
          this.settleFinish();
        }
        return;
      }

      if (kind === 'session.finished') {
        this.flushTailOnClose();
        this.closed = true;
        this.settleFinish();
        try { this.ws.close(); } catch {}
        return;
      }

      if (kind === 'error' || kind === 'conversation.item.input_audio_transcription.failed') {
        const eObj = ev.error || {};
        const err = new Error(eObj.message || 'OpenAI Realtime transcription error');
        err.rawCode = String(eObj.code || eObj.type || 'REALTIME_ERROR');
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
        this.flushTailOnClose();
        this.closed = true;
        this.settleFinish();
        return;
      }
      if (!this.started) {
        const err = new Error((reason ? reason.toString('utf8') : '') || `WebSocket closed (code ${code})`);
        err.rawCode = `WS_${code}`;
        err.requestId = this.requestId;
        this.fail(err);
      } else {
        this.closed = true;
        this.settleFinish();
      }
    });
  }

  flushTailOnClose() {
    if (this.aborted) return;
    const t = this.partialAccum.trim();
    if (t) {
      this.partialAccum = '';
      this.cb.onSentence?.({ text: t, beginMs: 0, endMs: 0 });
    }
  }

  fail(err) {
    if (this.aborted || this.closed) return;
    this.closed = true;
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
    const info = classifyRealtimeError(err, {
      provider: 'openai-realtime',
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
    const samples = this.targetRate === 16000 ? pcm : resampleF32Linear(pcm, 16000, this.targetRate);
    const b64 = f32ToPcm16(samples).toString('base64');
    if (this.started && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
    } else {
      this.pendingB64.push(b64);
    }
  }

  cancel() {
    if (this.aborted) return;
    this.aborted = true;
    this.closed = true;
    this.pendingB64 = [];
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
    const finished = new Promise((res) => { this.finishResolve = res; });
    try {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      if (this.isDash) {
        this.ws.send(JSON.stringify({ type: 'session.finish' }));
      }
    } catch {
      this.closed = true;
      this.settleFinish();
      return;
    }
    const timeout = new Promise((res) => setTimeout(res, FINISH_TIMEOUT_MS).unref?.());
    await Promise.race([finished, timeout]);
    this.flushTailOnClose();
    this.closed = true;
    try { this.ws.terminate(); } catch {}
  }
}

class OpenAiRealtimeEngine {
  constructor(cfg, WebSocketImpl) {
    this.cfg = cfg;
    this.WebSocketImpl = WebSocketImpl;
    this.provider = 'openai-realtime';
    this.ep = 'cloud-rt';
    this.streaming = true;
    this.loadMs = 0;
    this.warmMs = 0;
    this.lidAvailable = false;
  }

  static async load(cfg, { WebSocket } = {}) {
    const check = validateRealtimeConfig({ ...cfg, provider: 'openai-realtime' });
    if (!check.ok) throw makeStructuredError(check);
    return new OpenAiRealtimeEngine(check.normalized, WebSocket || require('ws'));
  }

  async warmup() { return 0; }

  openSession(cb, opts = {}) {
    return new OpenAiRealtimeSession(this.cfg, cb, opts.language, this.WebSocketImpl, opts);
  }
}

// =============================================================================
// 4. Deepgram Live Streaming WS Adapter (Nova-3 / Nova-2 / Flux)
// =============================================================================

function buildDeepgramUrl(cfg, language, opts = {}) {
  const raw = String(cfg?.baseUrl || 'wss://api.deepgram.com/v1/listen').trim();
  const model = String(cfg?.model || 'nova-3').trim();
  const segProf = getSegmentationProfile(opts.segmentationMode || cfg?.segmentationMode);
  try {
    const u = new URL(raw);
    if (!u.searchParams.has('model')) u.searchParams.set('model', model);
    if (!u.searchParams.has('encoding')) u.searchParams.set('encoding', 'linear16');
    if (!u.searchParams.has('sample_rate')) u.searchParams.set('sample_rate', '16000');
    if (!u.searchParams.has('channels')) u.searchParams.set('channels', '1');
    if (!u.searchParams.has('interim_results')) u.searchParams.set('interim_results', 'true');
    if (!u.searchParams.has('smart_format')) u.searchParams.set('smart_format', 'true');
    if (!u.searchParams.has('punctuate')) u.searchParams.set('punctuate', 'true');
    if (!u.searchParams.has('endpointing')) u.searchParams.set('endpointing', String(segProf.deepgramEndpointingMs));
    if (!u.searchParams.has('language')) {
      if (language === 'english') u.searchParams.set('language', 'en');
      else if (language === 'chinese') u.searchParams.set('language', 'zh-CN');
      else if (/nova-3/i.test(model)) u.searchParams.set('language', 'multi');
      else u.searchParams.set('language', 'zh-CN');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

class DeepgramRtSession {
  constructor(cfg, cb, language, WebSocketImpl, opts = {}) {
    this.cfg = cfg;
    this.cb = cb;
    this.requestId = '';
    this.started = false;
    this.closing = false;
    this.aborted = false;
    this.closed = false;
    this.pending = [];
    this.finalParts = [];
    this.lastInterim = '';
    this.finishResolve = null;

    const wsUrl = buildDeepgramUrl(cfg, language, opts);
    this.ws = new WebSocketImpl(wsUrl, {
      headers: cfg.apiKey ? { Authorization: `Token ${cfg.apiKey}` } : {},
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS
    });

    attachUnexpectedResponseHandler(this.ws, (err) => {
      if (!err.requestId) err.requestId = this.requestId;
      this.fail(err);
    });

    this.ws.on('upgrade', (res) => {
      const id = res?.headers?.['dg-request-id'] || res?.headers?.['x-request-id'];
      if (id) this.requestId = String(id);
    });

    this.ws.on('open', () => {
      if (this.aborted || this.closed) return;
      this.started = true;
      this.cb.onReady?.({ requestId: this.requestId });
      for (const b of this.pending) {
        if (this.ws.readyState === 1) this.ws.send(b);
      }
      this.pending = [];
    });

    this.ws.on('message', (data, isBinary) => {
      if (this.aborted || this.closed || isBinary) return;
      let ev;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
      if (ev?.metadata?.request_id && !this.requestId) {
        this.requestId = String(ev.metadata.request_id);
      }
      if (ev?.type === 'Error' || ev?.err_code) {
        const err = new Error(ev.description || ev.err_msg || ev.message || 'Deepgram stream error');
        err.rawCode = String(ev.err_code || ev.type || 'DEEPGRAM_ERROR');
        err.requestId = this.requestId;
        this.fail(err);
        return;
      }
      if (ev?.type === 'Results') {
        const alt = ev.channel?.alternatives?.[0];
        const txt = String(alt?.transcript || '').trim();
        const beginMs = Math.round((Number(ev.start) || 0) * 1000);
        const endMs = Math.round(((Number(ev.start) || 0) + (Number(ev.duration) || 0)) * 1000);

        if (ev.is_final) {
          if (txt) this.finalParts.push(txt);
          this.lastInterim = '';
          if (ev.speech_final || ev.from_finalize) {
            const full = this.finalParts.join(' ').trim();
            this.finalParts = [];
            if (full) this.cb.onSentence?.({ text: full, beginMs, endMs });
            if (ev.from_finalize && this.closing) {
              this.closed = true;
              this.settleFinish();
            }
          } else if (this.finalParts.length > 0) {
            this.cb.onPartial?.(this.finalParts.join(' ').trim());
          }
        } else if (txt) {
          this.lastInterim = txt;
          const preview = [...this.finalParts, txt].join(' ').trim();
          if (preview) this.cb.onPartial?.(preview);
        }
        return;
      }
      if (ev?.type === 'Metadata' && this.closing) {
        this.flushTailOnClose();
        this.closed = true;
        this.settleFinish();
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
      if (!this.started) {
        const err = new Error((reason ? reason.toString('utf8') : '') || `WebSocket closed (code ${code})`);
        err.rawCode = `WS_${code}`;
        err.requestId = this.requestId;
        this.fail(err);
      } else {
        this.flushTailOnClose();
        this.closed = true;
        this.settleFinish();
      }
    });
  }

  flushTailOnClose() {
    if (this.aborted) return;
    const text = [...this.finalParts, this.lastInterim].filter(Boolean).join(' ').trim();
    this.finalParts = [];
    this.lastInterim = '';
    if (text) this.cb.onSentence?.({ text, beginMs: 0, endMs: 0 });
  }

  fail(err) {
    if (this.aborted || this.closed) return;
    this.closed = true;
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
    const info = classifyRealtimeError(err, {
      provider: 'deepgram',
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
    const finished = new Promise((res) => { this.finishResolve = res; });
    try {
      this.ws.send(JSON.stringify({ type: 'Finalize' }));
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
    } catch {
      this.closed = true;
      this.settleFinish();
      return;
    }
    const timeout = new Promise((res) => setTimeout(res, FINISH_TIMEOUT_MS).unref?.());
    await Promise.race([finished, timeout]);
    this.flushTailOnClose();
    this.closed = true;
    try { this.ws.terminate(); } catch {}
  }
}

class DeepgramRealtimeEngine {
  constructor(cfg, WebSocketImpl) {
    this.cfg = cfg;
    this.WebSocketImpl = WebSocketImpl;
    this.provider = 'deepgram';
    this.ep = 'cloud-rt';
    this.streaming = true;
    this.loadMs = 0;
    this.warmMs = 0;
    this.lidAvailable = false;
  }

  static async load(cfg, { WebSocket } = {}) {
    const check = validateRealtimeConfig({ ...cfg, provider: 'deepgram' });
    if (!check.ok) throw makeStructuredError(check);
    return new DeepgramRealtimeEngine(check.normalized, WebSocket || require('ws'));
  }

  async warmup() { return 0; }

  openSession(cb, opts = {}) {
    return new DeepgramRtSession(this.cfg, cb, opts.language, this.WebSocketImpl, opts);
  }
}

// =============================================================================
// 5. Tencent Cloud Real-time ASR v2 WS Adapter (HMAC-SHA1 Signed Query)
// =============================================================================

function buildTencentSignedUrl(cfg, opts = {}) {
  const nowSec = Number.isFinite(Number(opts.timestampSec))
    ? Math.floor(Number(opts.timestampSec))
    : Math.floor(Date.now() / 1000);
  const nonce = opts.nonce !== undefined ? String(opts.nonce) : String(Math.floor(100000000 + Math.random() * 899999999));
  const voiceId = String(opts.voiceId || crypto.randomUUID().replace(/-/g, '').slice(0, 32));
  const baseRaw = String(cfg.baseUrl || 'wss://asr.cloud.tencent.com/asr/v2').trim().replace(/\/+$/, '');
  const protoMatch = baseRaw.match(/^(wss?:)\/\//i);
  const proto = protoMatch ? protoMatch[1].toLowerCase() : 'wss:';
  let hostAndPath = baseRaw.replace(/^wss?:\/\//i, '').split('?')[0];
  const appIdStr = String(cfg.appId || '').trim();
  if (appIdStr && !hostAndPath.endsWith(`/${appIdStr}`)) {
    hostAndPath = `${hostAndPath}/${appIdStr}`;
  }

  let engineModel = String(cfg.model || '16k_zh').trim() || '16k_zh';
  if (opts.language === 'english' && engineModel === '16k_zh') {
    engineModel = '16k_en';
  }

  const params = {
    engine_model_type: engineModel,
    expired: String(nowSec + 86400),
    needvad: '1',
    nonce,
    secretid: String(cfg.appKey || '').trim(),
    timestamp: String(nowSec),
    voice_format: '1',
    voice_id: voiceId
  };

  const sortedQuery = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const signOrigin = `${hostAndPath}?${sortedQuery}`;
  const signature = crypto
    .createHmac('sha1', String(cfg.apiKey || ''))
    .update(signOrigin, 'utf8')
    .digest('base64');

  return {
    url: `${proto}//${signOrigin}&signature=${encodeURIComponent(signature)}`,
    voiceId,
    signOrigin,
    signature
  };
}

class TencentRtSession {
  constructor(cfg, cb, language, WebSocketImpl) {
    this.cfg = cfg;
    this.cb = cb;
    const signed = buildTencentSignedUrl(cfg, { language });
    this.requestId = signed.voiceId;
    this.started = false;
    this.closing = false;
    this.aborted = false;
    this.closed = false;
    this.pendingBytes = [];
    this.pendingByteLen = 0;
    this.lastPartial = '';
    this.finishResolve = null;

    this.ws = new WebSocketImpl(signed.url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });

    attachUnexpectedResponseHandler(this.ws, (err) => {
      if (!err.requestId) err.requestId = this.requestId;
      this.fail(err);
    });

    this.ws.on('message', (data, isBinary) => {
      if (this.aborted || this.closed || isBinary) return;
      let ev;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
      if (ev?.voice_id) this.requestId = String(ev.voice_id);

      if (typeof ev?.code === 'number' && ev.code !== 0) {
        const err = new Error(ev.message || `Tencent ASR error ${ev.code}`);
        err.rawCode = String(ev.code);
        err.requestId = this.requestId;
        this.fail(err);
        return;
      }

      if (!this.started && ev?.code === 0) {
        this.started = true;
        this.cb.onReady?.({ requestId: this.requestId });
        this.flushPendingAudio(false);
      }

      const r = ev?.result;
      if (r && typeof r === 'object') {
        const text = String(r.voice_text_str || '').trim();
        const sliceType = Number(r.slice_type);
        const beginMs = Number.isFinite(Number(r.start_time)) ? Number(r.start_time) : 0;
        const endMs = Number.isFinite(Number(r.end_time)) ? Number(r.end_time) : beginMs;
        if (sliceType === 2) {
          this.lastPartial = '';
          if (text) this.cb.onSentence?.({ text, beginMs, endMs });
        } else if (text) {
          this.lastPartial = text;
          this.cb.onPartial?.(text);
        }
      }

      if (ev?.final === 1) {
        this.flushTailOnClose();
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
      if (!this.started) {
        const err = new Error((reason ? reason.toString('utf8') : '') || `WebSocket closed (code ${code})`);
        err.rawCode = `WS_${code}`;
        err.requestId = this.requestId;
        this.fail(err);
      } else {
        this.closed = true;
        this.settleFinish();
      }
    });
  }

  flushTailOnClose() {
    if (this.aborted) return;
    const t = this.lastPartial.trim();
    if (t) {
      this.lastPartial = '';
      this.cb.onSentence?.({ text: t, beginMs: 0, endMs: 0 });
    }
  }

  fail(err) {
    if (this.aborted || this.closed) return;
    this.closed = true;
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
    const info = classifyRealtimeError(err, {
      provider: 'tencent',
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
    const combined = this.pendingBytes.length === 1 ? this.pendingBytes[0] : Buffer.concat(this.pendingBytes, this.pendingByteLen);
    this.pendingBytes = [];
    this.pendingByteLen = 0;

    let offset = 0;
    while (combined.length - offset >= PCM_CHUNK_BYTES) {
      this.ws.send(combined.subarray(offset, offset + PCM_CHUNK_BYTES));
      offset += PCM_CHUNK_BYTES;
    }
    const rem = combined.subarray(offset);
    if (rem.length > 0) {
      if (forceSmall) this.ws.send(rem);
      else {
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
    this.flushPendingAudio(true);
    const finished = new Promise((res) => { this.finishResolve = res; });
    try { this.ws.send(JSON.stringify({ type: 'end' })); } catch {
      this.closed = true;
      this.settleFinish();
      return;
    }
    const timeout = new Promise((res) => setTimeout(res, FINISH_TIMEOUT_MS).unref?.());
    await Promise.race([finished, timeout]);
    this.flushTailOnClose();
    this.closed = true;
    try { this.ws.terminate(); } catch {}
  }
}

class TencentRealtimeEngine {
  constructor(cfg, WebSocketImpl) {
    this.cfg = cfg;
    this.WebSocketImpl = WebSocketImpl;
    this.provider = 'tencent';
    this.ep = 'cloud-rt';
    this.streaming = true;
    this.loadMs = 0;
    this.warmMs = 0;
    this.lidAvailable = false;
  }

  static async load(cfg, { WebSocket } = {}) {
    const check = validateRealtimeConfig({ ...cfg, provider: 'tencent' });
    if (!check.ok) throw makeStructuredError(check);
    return new TencentRealtimeEngine(check.normalized, WebSocket || require('ws'));
  }

  async warmup() { return 0; }

  openSession(cb, opts = {}) {
    return new TencentRtSession(this.cfg, cb, opts.language, this.WebSocketImpl);
  }
}

// =============================================================================
// 6. iFlytek RTASR Real-time Transcription WS Adapter (MD5 Hex + HMAC-SHA1)
// =============================================================================

function buildXfyunSignedUrl(cfg, opts = {}) {
  const ts = String(
    Number.isFinite(Number(opts.timestampSec))
      ? Math.floor(Number(opts.timestampSec))
      : Math.floor(Date.now() / 1000)
  );
  const appId = String(cfg.appId || '').trim();
  const apiKey = String(cfg.apiKey || '').trim();
  const md5Hex = crypto.createHash('md5').update(appId + ts, 'utf8').digest('hex');
  const signa = crypto.createHmac('sha1', apiKey).update(md5Hex, 'utf8').digest('base64');

  const baseRaw = String(cfg.baseUrl || 'wss://rtasr.xfyun.cn/v1/ws').trim().split('?')[0];
  const qs = new URLSearchParams();
  qs.set('appid', appId);
  qs.set('ts', ts);
  qs.set('signa', signa);
  const langParam = String(cfg.model || '').trim();
  if (opts.language === 'english' || langParam === 'en') {
    qs.set('lang', 'en');
  } else if (langParam && langParam !== 'cn') {
    qs.set('lang', langParam);
  }
  const explicitVadMdn = opts.vadMdn !== undefined
    ? String(opts.vadMdn)
    : (opts.channel === 'them' ? '2' : '');
  if (explicitVadMdn === '1' || explicitVadMdn === '2') {
    qs.set('vadMdn', explicitVadMdn);
  }
  return {
    url: `${baseRaw}?${qs.toString()}`,
    ts,
    md5Hex,
    signa
  };
}

function extractXfyunResultText(parsedData) {
  const rt = parsedData?.cn?.st?.rt;
  if (!Array.isArray(rt)) return '';
  let out = '';
  for (const r of rt) {
    if (!Array.isArray(r?.ws)) continue;
    for (const w of r.ws) {
      if (!Array.isArray(w?.cw)) continue;
      for (const cw of w.cw) {
        if (cw?.w) out += String(cw.w);
      }
    }
  }
  return out.trim();
}

class XfyunRtSession {
  constructor(cfg, cb, language, WebSocketImpl, opts = {}) {
    this.cfg = cfg;
    this.cb = cb;
    const signed = buildXfyunSignedUrl(cfg, { language, channel: opts.channel, vadMdn: opts.vadMdn });
    this.requestId = '';
    this.started = false;
    this.closing = false;
    this.aborted = false;
    this.closed = false;
    this.pendingBytes = [];
    this.pendingByteLen = 0;
    this.lastPartial = '';
    this.finishResolve = null;

    this.ws = new WebSocketImpl(signed.url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });

    attachUnexpectedResponseHandler(this.ws, (err) => {
      if (!err.requestId) err.requestId = this.requestId;
      this.fail(err);
    });

    this.ws.on('message', (data, isBinary) => {
      if (this.aborted || this.closed || isBinary) return;
      let ev;
      try { ev = JSON.parse(data.toString('utf8')); } catch { return; }
      const action = ev?.action;
      const codeStr = String(ev?.code ?? '0');

      if (action === 'error' || codeStr !== '0') {
        const err = new Error(ev?.desc || `iFlytek RTASR error ${codeStr}`);
        err.rawCode = codeStr;
        err.requestId = this.requestId || String(ev?.sid || '');
        this.fail(err);
        return;
      }

      if (action === 'started') {
        if (ev?.data) this.requestId = String(ev.data);
        if (!this.started) {
          this.started = true;
          this.cb.onReady?.({ requestId: this.requestId });
          this.flushPendingAudio(false);
        }
        return;
      }

      if (action === 'result' && ev?.data) {
        let payload;
        try { payload = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
        const text = extractXfyunResultText(payload);
        const stType = String(payload?.cn?.st?.type ?? '');
        const beginMs = Number.isFinite(Number(payload?.cn?.st?.bg)) ? Number(payload.cn.st.bg) : 0;
        const endMs = Number.isFinite(Number(payload?.cn?.st?.ed)) ? Number(payload.cn.st.ed) : beginMs;
        if (stType === '0') {
          this.lastPartial = '';
          if (text) this.cb.onSentence?.({ text, beginMs, endMs });
        } else if (text) {
          this.lastPartial = text;
          this.cb.onPartial?.(text);
        }
        if (payload?.ls === true) {
          this.flushTailOnClose();
          this.closed = true;
          this.settleFinish();
          try { this.ws.close(); } catch {}
        }
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
      if (!this.started) {
        const err = new Error((reason ? reason.toString('utf8') : '') || `WebSocket closed (code ${code})`);
        err.rawCode = `WS_${code}`;
        err.requestId = this.requestId;
        this.fail(err);
      } else {
        this.closed = true;
        this.settleFinish();
      }
    });
  }

  flushTailOnClose() {
    if (this.aborted) return;
    const t = this.lastPartial.trim();
    if (t) {
      this.lastPartial = '';
      this.cb.onSentence?.({ text: t, beginMs: 0, endMs: 0 });
    }
  }

  fail(err) {
    if (this.aborted || this.closed) return;
    this.closed = true;
    this.settleFinish();
    try { this.ws.terminate(); } catch {}
    const info = classifyRealtimeError(err, {
      provider: 'xfyun',
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

  flushPendingAudio(forceSmall = false) {
    if (this.aborted || this.closed || !this.started || this.ws.readyState !== 1) return;
    if (this.pendingByteLen === 0) return;
    const combined = this.pendingBytes.length === 1 ? this.pendingBytes[0] : Buffer.concat(this.pendingBytes, this.pendingByteLen);
    this.pendingBytes = [];
    this.pendingByteLen = 0;

    let offset = 0;
    while (combined.length - offset >= XFYUN_CHUNK_BYTES) {
      this.ws.send(combined.subarray(offset, offset + XFYUN_CHUNK_BYTES));
      offset += XFYUN_CHUNK_BYTES;
    }
    const rem = combined.subarray(offset);
    if (rem.length > 0) {
      if (forceSmall) this.ws.send(rem);
      else {
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
    if (this.started && this.ws.readyState === 1 && this.pendingByteLen >= XFYUN_CHUNK_BYTES) {
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
    this.flushPendingAudio(true);
    const finished = new Promise((res) => { this.finishResolve = res; });
    try { this.ws.send(JSON.stringify({ end: true })); } catch {
      this.closed = true;
      this.settleFinish();
      return;
    }
    const timeout = new Promise((res) => setTimeout(res, FINISH_TIMEOUT_MS).unref?.());
    await Promise.race([finished, timeout]);
    this.flushTailOnClose();
    this.closed = true;
    try { this.ws.terminate(); } catch {}
  }
}

class XfyunRealtimeEngine {
  constructor(cfg, WebSocketImpl) {
    this.cfg = cfg;
    this.WebSocketImpl = WebSocketImpl;
    this.provider = 'xfyun';
    this.ep = 'cloud-rt';
    this.streaming = true;
    this.loadMs = 0;
    this.warmMs = 0;
    this.lidAvailable = false;
  }

  static async load(cfg, { WebSocket } = {}) {
    const check = validateRealtimeConfig({ ...cfg, provider: 'xfyun' });
    if (!check.ok) throw makeStructuredError(check);
    return new XfyunRealtimeEngine(check.normalized, WebSocket || require('ws'));
  }

  async warmup() { return 0; }

  openSession(cb, opts = {}) {
    return new XfyunRtSession(this.cfg, cb, opts.language, this.WebSocketImpl, opts);
  }
}

// =============================================================================
// 7. Segmented HTTP ASR Engine (OpenAI /audio/transcriptions + Legacy Chat Audio)
// =============================================================================

function resolveTranscriptionsUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/audio\/transcriptions$/i.test(clean)) return clean;
  return `${clean}/audio/transcriptions`;
}

function resolveChatAudioUrl(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(clean)) return clean;
  return `${clean}/chat/completions`;
}

class CloudSegmentAsrEngine {
  constructor(cfg, fetchImpl = globalThis.fetch) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
    this.protocol = inferSegmentProtocol(cfg);
    this.ep = 'cloud';
    this.loadMs = 0;
    this.warmMs = 0;
    this.lidAvailable = false;
  }

  static async load(cfg, { fetchImpl } = {}) {
    const check = validateSegmentConfig(cfg);
    if (!check.ok) throw makeStructuredError(check);
    return new CloudSegmentAsrEngine(check.normalized, fetchImpl || globalThis.fetch);
  }

  async warmup() { return 0; }

  async transcribe(pcm, language = 'auto', { signal } = {}) {
    const t0 = Date.now();
    const wav = encodeWav16kMono(pcm, 16000);
    const headers = {};
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;

    if (this.protocol === 'openai-transcriptions') {
      const url = resolveTranscriptionsUrl(this.cfg.baseUrl);
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', this.cfg.model);
      form.append('response_format', 'json');
      const iso = languageIso639(language);
      if (iso) form.append('language', iso);

      const res = await this.fetchImpl(url, { method: 'POST', headers, body: form, signal });
      const reqId = res.headers?.get?.('x-request-id') || res.headers?.get?.('x-tt-logid') || '';
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
        err.statusCode = res.status;
        err.rawCode = `HTTP ${res.status}`;
        err.requestId = reqId;
        throw err;
      }
      const ctype = (res.headers?.get?.('content-type') || '').toLowerCase();
      let text = '';
      if (ctype.includes('application/json')) {
        const j = await res.json();
        text = String(j?.text ?? j?.transcript ?? '').trim();
      } else {
        const raw = await res.text();
        try {
          const j = JSON.parse(raw);
          text = String(j?.text ?? j?.transcript ?? '').trim();
        } catch {
          text = raw.trim();
        }
      }
      return { text, lang: undefined, inferMs: Date.now() - t0, requestId: reqId };
    }

    // Legacy chat/completions input_audio path
    const url = resolveChatAudioUrl(this.cfg.baseUrl);
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }] }],
        stream: false
      }),
      signal
    });
    const reqId = res.headers?.get?.('x-request-id') || '';
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      err.statusCode = res.status;
      err.rawCode = `HTTP ${res.status}`;
      err.requestId = reqId;
      throw err;
    }
    const j = await res.json();
    const text = String(j?.choices?.[0]?.message?.content ?? '').trim();
    return { text, lang: undefined, inferMs: Date.now() - t0, requestId: reqId };
  }
}

async function createRealtimeEngine(cfg, opts = {}) {
  const provider = inferRealtimeProvider(cfg);
  switch (provider) {
    case 'doubao':
      return DoubaoRealtimeEngine.load(cfg, opts);
    case 'openai-realtime':
      return OpenAiRealtimeEngine.load(cfg, opts);
    case 'deepgram':
      return DeepgramRealtimeEngine.load(cfg, opts);
    case 'tencent':
      return TencentRealtimeEngine.load(cfg, opts);
    case 'xfyun':
      return XfyunRealtimeEngine.load(cfg, opts);
    case 'dashscope':
    default:
      return DashScopeRealtimeEngine.load(cfg, opts);
  }
}

async function createSegmentEngine(cfg, opts = {}) {
  return CloudSegmentAsrEngine.load(cfg, opts);
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

    const SAMPLES_PER_CHUNK = 3200; // 200ms @ 16kHz
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
          : '握手正常但未能识别测试样本，请确认模型/Resource ID 支持 16kHz PCM 中文或英文语音。',
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

async function testSegmentTranscribe(cfg, pcmFloat32, opts = {}) {
  const started = Date.now();
  const protocol = inferSegmentProtocol(cfg);
  const check = validateSegmentConfig({ ...cfg, protocol });
  if (!check.ok) {
    return {
      ok: false,
      mode: 'transcribe',
      provider: protocol,
      protocol,
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
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  try {
    const engine = await createSegmentEngine(check.normalized, opts);
    const r = await engine.transcribe(pcmFloat32, opts.language || 'chinese', { signal: ac.signal });
    const transcript = String(r?.text || '').trim();
    if (!transcript) {
      return {
        ok: false,
        mode: 'transcribe',
        provider: protocol,
        protocol,
        connected: true,
        stage: 'transcribe',
        code: 'NO_TRANSCRIPT',
        latencyMs: Date.now() - started,
        transcript: '',
        messageZh: '接口已响应，但返回空转写文本',
        hintZh: '请确认模型支持音频转录（如 SenseVoiceSmall / glm-asr / whisper-large-v3-turbo / gpt-4o-mini-transcribe）且协议选项匹配。',
        rawCode: 'EMPTY_TRANSCRIPT',
        requestId: r?.requestId || '',
        retryable: true
      };
    }
    return {
      ok: true,
      mode: 'transcribe',
      provider: protocol,
      protocol,
      connected: true,
      stage: 'done',
      code: 'OK',
      latencyMs: Date.now() - started,
      transcript,
      messageZh: `试转写成功：「${transcript}」`,
      hintZh: `已通过 ${SEGMENT_PROTOCOLS[protocol]?.labelZh || protocol} 端到端验证通过。`,
      rawCode: '',
      requestId: r?.requestId || '',
      retryable: false
    };
  } catch (e) {
    const errObj = ac.signal.aborted ? Object.assign(new Error('HTTP segment ASR timed out'), { name: 'TimeoutError' }) : e;
    const info = classifyRealtimeError(errObj, { ...check.normalized, provider: protocol, connected: false });
    return {
      ...info,
      mode: 'transcribe',
      protocol,
      latencyMs: Date.now() - started,
      transcript: ''
    };
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Per-Provider Realtime Settings Normalization & Migration (All 6 Protocols)
// =============================================================================

function emptyProfileFor(provider) {
  const meta = REALTIME_PROVIDERS[provider] || REALTIME_PROVIDERS.dashscope;
  const base = {
    baseUrl: provider === 'dashscope' ? '' : meta.defaultBaseUrl,
    model: provider === 'dashscope' ? '' : meta.defaultModel,
    apiKeyEnc: '',
    apiKeyHint: undefined,
    verification: undefined
  };
  if (provider === 'doubao') {
    return {
      ...base,
      resourceId: meta.defaultResourceId || 'volc.seedasr.sauc.duration',
      authMode: 'api-key',
      appKey: ''
    };
  }
  if (provider === 'tencent') {
    return { ...base, appId: '', appKey: '' };
  }
  if (provider === 'xfyun') {
    return { ...base, appId: '' };
  }
  return base;
}

function normalizeRealtimeSettings(rawRealtime = {}) {
  const src = rawRealtime && typeof rawRealtime === 'object' ? rawRealtime : {};
  const activeProvider = inferRealtimeProvider(src);
  const existingProfiles = src.profiles && typeof src.profiles === 'object' ? src.profiles : {};

  const profiles = {};
  for (const pid of REALTIME_PROVIDER_IDS) {
    profiles[pid] = {
      ...emptyProfileFor(pid),
      ...(existingProfiles[pid] && typeof existingProfiles[pid] === 'object' ? existingProfiles[pid] : {})
    };
  }

  // Migrate legacy flat top-level config into its inferred provider profile without losing credentials
  const hasFlatData = Boolean(src.baseUrl || src.model || src.apiKeyEnc || src.resourceId || src.appId);
  if (hasFlatData && !existingProfiles[activeProvider]) {
    const target = profiles[activeProvider];
    if (src.baseUrl) target.baseUrl = src.baseUrl;
    if (src.model) target.model = src.model;
    if (src.resourceId && activeProvider === 'doubao') target.resourceId = src.resourceId;
    if (src.authMode && activeProvider === 'doubao') target.authMode = src.authMode === 'app-access' ? 'app-access' : 'api-key';
    if (src.appKey && (activeProvider === 'doubao' || activeProvider === 'tencent')) target.appKey = src.appKey;
    if (src.appId && (activeProvider === 'tencent' || activeProvider === 'xfyun')) target.appId = src.appId;
    if (src.apiKeyEnc) target.apiKeyEnc = src.apiKeyEnc;
    if (src.apiKeyHint) target.apiKeyHint = src.apiKeyHint;
    if (src.verification) target.verification = src.verification;
  }

  const active = profiles[activeProvider];
  return {
    provider: activeProvider,
    baseUrl: active.baseUrl || '',
    model: active.model || '',
    resourceId: activeProvider === 'doubao' ? (active.resourceId || '') : '',
    authMode: activeProvider === 'doubao' ? (active.authMode === 'app-access' ? 'app-access' : 'api-key') : 'api-key',
    appId: (activeProvider === 'tencent' || activeProvider === 'xfyun') ? (active.appId || '') : '',
    appKey: (activeProvider === 'doubao' || activeProvider === 'tencent') ? (active.appKey || '') : '',
    apiKeyEnc: active.apiKeyEnc || '',
    apiKeyHint: active.apiKeyHint,
    verification: active.verification,
    profiles
  };
}

function publicRealtimeSettings(rawRealtime = {}) {
  const norm = normalizeRealtimeSettings(rawRealtime);
  const pubProfiles = {};
  for (const pid of REALTIME_PROVIDER_IDS) {
    const p = norm.profiles[pid];
    pubProfiles[pid] = {
      baseUrl: p.baseUrl || '',
      model: p.model || '',
      ...(pid === 'doubao' ? {
        resourceId: p.resourceId || '',
        authMode: p.authMode === 'app-access' ? 'app-access' : 'api-key',
        appKey: p.appKey || ''
      } : {}),
      ...(pid === 'tencent' ? { appId: p.appId || '', appKey: p.appKey || '' } : {}),
      ...(pid === 'xfyun' ? { appId: p.appId || '' } : {}),
      apiKeySet: Boolean(p.apiKeyEnc),
      apiKeyHint: p.apiKeyHint,
      verification: p.verification
    };
  }
  return {
    provider: norm.provider,
    baseUrl: norm.baseUrl,
    model: norm.model,
    resourceId: norm.resourceId,
    authMode: norm.authMode,
    appId: norm.appId,
    appKey: norm.appKey,
    apiKeySet: Boolean(norm.apiKeyEnc),
    apiKeyHint: norm.apiKeyHint,
    verification: norm.verification,
    profiles: pubProfiles
  };
}

module.exports = {
  REALTIME_PROVIDER_IDS,
  REALTIME_PROVIDERS,
  SEGMENT_PROTOCOLS,
  SEGMENTATION_PROFILES,
  DOUBAO_PROTO,
  normalizeSegmentationMode,
  getSegmentationProfile,
  computePcmRms,
  createCrossChannelEchoGate,
  inferRealtimeProvider,
  inferSegmentProtocol,
  isDashScopeRealtimeDialect,
  sanitizeDiagnosticText,
  validateRealtimeConfig,
  validateSegmentConfig,
  classifyRealtimeError,
  f32ToPcm16,
  resampleF32Linear,
  encodeWav16kMono,
  encodeDoubaoFullClientRequest,
  encodeDoubaoAudioPacket,
  decodeDoubaoServerPacket,
  buildDoubaoHeaders,
  buildDoubaoInitPayload,
  buildDashScopeRunTaskPayload,
  buildOpenAiRealtimeUrl,
  buildOpenAiRealtimeInitEvent,
  buildDeepgramUrl,
  buildTencentSignedUrl,
  buildXfyunSignedUrl,
  extractXfyunResultText,
  resolveTranscriptionsUrl,
  resolveChatAudioUrl,
  DashScopeRealtimeEngine,
  DoubaoRealtimeEngine,
  OpenAiRealtimeEngine,
  DeepgramRealtimeEngine,
  TencentRealtimeEngine,
  XfyunRealtimeEngine,
  CloudSegmentAsrEngine,
  createRealtimeEngine,
  createSegmentEngine,
  testRealtimeConnection,
  testRealtimeTranscribe,
  testSegmentTranscribe,
  normalizeRealtimeSettings,
  publicRealtimeSettings
};
