'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const asrAdapters = require('../cuedesk/tools/asr-adapters.cjs');
const { createWorkbenchPrefs, DEFAULT_WORKBENCH_HOTKEYS } = require('../cuedesk/tools/workbench-prefs.cjs');
const { createWorkbenchWindow } = require('../cuedesk/tools/workbench-window.cjs');
const { createEyeContact } = require('../cuedesk/eye-contact.cjs');

// =============================================================================
// Mock WebSocket harness supporting binary frames, HTTP upgrade failures, & late packets
// =============================================================================
function createMockWsFactory(handler) {
  const instances = [];
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url, options = {}) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = 0;
      this.sent = [];
      this.terminated = false;
      instances.push(this);
      setImmediate(() => {
        if (!this.terminated) handler(this, url, options);
      });
    }
    send(data) {
      this.sent.push(data);
      this.emit('__client_send', data);
    }
    close(code = 1000, reason = '') {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close', code, Buffer.from(reason));
    }
    terminate() {
      this.terminated = true;
      this.readyState = 3;
    }
    // Helpers for test server side
    serverOpen(upgradeHeaders = {}) {
      if (this.terminated) return;
      this.readyState = 1;
      this.emit('upgrade', { headers: upgradeHeaders });
      this.emit('open');
    }
    serverSend(data, isBinary = Buffer.isBuffer(data)) {
      if (this.terminated) return;
      this.emit('message', data, isBinary);
    }
    serverRejectHttp(statusCode, headers = {}, body = '') {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.headers = headers;
      this.emit('unexpected-response', {}, res);
      if (body) res.emit('data', Buffer.from(body, 'utf8'));
      res.emit('end');
    }
  }
  MockWebSocket.instances = instances;
  return MockWebSocket;
}

function makeDoubaoServerResponse(payloadObj, { seq = 1, isLast = false, compress = true } = {}) {
  const raw = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const body = compress ? zlib.gzipSync(raw) : raw;
  const flags = isLast ? asrAdapters.DOUBAO_PROTO.FLAG_NEG_WITH_SEQ : asrAdapters.DOUBAO_PROTO.FLAG_POS_SEQ;
  const header = Buffer.from([
    0x11,
    (asrAdapters.DOUBAO_PROTO.MSG_FULL_SERVER_RESPONSE << 4) | flags,
    (asrAdapters.DOUBAO_PROTO.SER_JSON << 4) | (compress ? asrAdapters.DOUBAO_PROTO.COMP_GZIP : 0),
    0x00
  ]);
  const meta = Buffer.allocUnsafe(8);
  meta.writeInt32BE(isLast ? -Math.abs(seq) : Math.abs(seq), 0);
  meta.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, meta, body]);
}

function makeDoubaoServerError(errorCode, message) {
  const body = Buffer.from(JSON.stringify({ error: message }), 'utf8');
  const header = Buffer.from([
    0x11,
    (asrAdapters.DOUBAO_PROTO.MSG_SERVER_ERROR_RESPONSE << 4),
    (asrAdapters.DOUBAO_PROTO.SER_JSON << 4),
    0x00
  ]);
  const meta = Buffer.allocUnsafe(8);
  meta.writeUInt32BE(errorCode, 0);
  meta.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, meta, body]);
}

// =============================================================================
// P1-1: Real-time ASR Adapter Layer (Doubao SAUC v3 + DashScope + Isolation)
// =============================================================================

test('P1-1: Doubao SAUC v3 binary encode/decode round-trip and header auth modes', () => {
  const initBuf = asrAdapters.encodeDoubaoFullClientRequest(
    asrAdapters.buildDoubaoInitPayload({ model: 'bigmodel', baseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel' }, 'auto'),
    1
  );
  assert.equal(initBuf[0], 0x11);
  assert.equal((initBuf[1] >> 4) & 0xf, 0x1);
  assert.equal(initBuf[1] & 0xf, 0x1);
  assert.equal(initBuf.readInt32BE(4), 1);
  const payloadLen = initBuf.readUInt32BE(8);
  const parsedInit = JSON.parse(zlib.gunzipSync(initBuf.subarray(12, 12 + payloadLen)).toString('utf8'));
  assert.equal(parsedInit.audio.format, 'pcm');
  assert.equal(parsedInit.audio.rate, 16000);
  assert.equal(parsedInit.request.model_name, 'bigmodel');
  assert.equal(parsedInit.request.show_utterances, true);

  const audioLast = asrAdapters.encodeDoubaoAudioPacket(Buffer.alloc(320), 4, { isLast: true });
  assert.equal((audioLast[1] >> 4) & 0xf, 0x2);
  assert.equal(audioLast[1] & 0xf, 0x3); // NEG_WITH_SEQ
  assert.equal(audioLast.readInt32BE(4), -4);

  const serverResp = makeDoubaoServerResponse({
    result: { utterances: [{ text: '你好世界', start_time: 0, end_time: 900, definite: true }] }
  }, { seq: 4, isLast: true });
  const decoded = asrAdapters.decodeDoubaoServerPacket(serverResp);
  assert.equal(decoded.kind, 'response');
  assert.equal(decoded.isLast, true);
  assert.equal(decoded.payload.result.utterances[0].text, '你好世界');

  const serverErr = makeDoubaoServerError(45000030, 'resource not granted');
  const decodedErr = asrAdapters.decodeDoubaoServerPacket(serverErr);
  assert.equal(decodedErr.kind, 'error');
  assert.equal(decodedErr.errorCode, 45000030);

  const hApiKey = asrAdapters.buildDoubaoHeaders({
    authMode: 'api-key',
    apiKey: 'secret-api-key',
    resourceId: 'volc.seedasr.sauc.duration'
  }, 'conn-1');
  assert.equal(hApiKey['X-Api-Key'], 'secret-api-key');
  assert.equal(hApiKey['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration');
  assert.equal(hApiKey['X-Api-Connect-Id'], 'conn-1');
  assert.equal(hApiKey['X-Api-App-Key'], undefined);

  const hApp = asrAdapters.buildDoubaoHeaders({
    authMode: 'app-access',
    appKey: 'app-123',
    apiKey: 'tok-456',
    resourceId: 'volc.bigasr.sauc.duration'
  }, 'conn-2');
  assert.equal(hApp['X-Api-App-Key'], 'app-123');
  assert.equal(hApp['X-Api-Access-Key'], 'tok-456');
  assert.equal(hApp['X-Api-Key'], undefined);
});

test('P1-1: Local config validation flags missing Resource ID & App ID before connecting', () => {
  const missingRes = asrAdapters.validateRealtimeConfig({
    provider: 'doubao',
    baseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    model: 'bigmodel',
    resourceId: '',
    apiKey: 'key-123'
  });
  assert.equal(missingRes.ok, false);
  assert.equal(missingRes.code, 'MISSING_RESOURCE_ID');
  assert.equal(missingRes.stage, 'config');
  assert.match(missingRes.hintZh, /volc\.seedasr\.sauc\.duration/);

  const missingApp = asrAdapters.validateRealtimeConfig({
    provider: 'doubao',
    baseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    model: 'bigmodel',
    resourceId: 'volc.seedasr.sauc.duration',
    authMode: 'app-access',
    appKey: '',
    apiKey: 'tok-123'
  });
  assert.equal(missingApp.ok, false);
  assert.equal(missingApp.code, 'MISSING_APP_KEY');
});

test('P1-1: Per-provider profile migration & credential isolation (DashScope <-> Doubao)', () => {
  // Legacy DashScope flat config upgrades seamlessly
  const migrated = asrAdapters.normalizeRealtimeSettings({
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    model: 'paraformer-realtime-v2',
    apiKeyEnc: 'ENC_DS_KEY',
    apiKeyHint: '1234'
  });
  assert.equal(migrated.provider, 'dashscope');
  assert.equal(migrated.profiles.dashscope.apiKeyEnc, 'ENC_DS_KEY');
  assert.equal(migrated.profiles.doubao.apiKeyEnc, '');

  // Configure Doubao separately without touching DashScope
  migrated.profiles.doubao.apiKeyEnc = 'ENC_DB_KEY';
  migrated.profiles.doubao.apiKeyHint = '9876';
  migrated.profiles.doubao.resourceId = 'volc.seedasr.sauc.duration';

  const onDoubao = asrAdapters.normalizeRealtimeSettings({
    provider: 'doubao',
    profiles: migrated.profiles
  });
  assert.equal(onDoubao.provider, 'doubao');
  assert.equal(onDoubao.apiKeyEnc, 'ENC_DB_KEY');
  assert.equal(onDoubao.resourceId, 'volc.seedasr.sauc.duration');
  assert.equal(onDoubao.profiles.dashscope.apiKeyEnc, 'ENC_DS_KEY');

  // Switch back to DashScope: key & model preserved intact!
  const backDash = asrAdapters.normalizeRealtimeSettings({
    provider: 'dashscope',
    profiles: onDoubao.profiles
  });
  assert.equal(backDash.provider, 'dashscope');
  assert.equal(backDash.apiKeyEnc, 'ENC_DS_KEY');
  assert.equal(backDash.model, 'paraformer-realtime-v2');
  assert.equal(backDash.profiles.doubao.apiKeyEnc, 'ENC_DB_KEY');

  // Public projection never leaks encrypted payload
  const pub = asrAdapters.publicRealtimeSettings(backDash);
  assert.equal(pub.apiKeySet, true);
  assert.equal(pub.apiKeyEnc, undefined);
  assert.equal(pub.profiles.doubao.apiKeySet, true);
  assert.equal(pub.profiles.doubao.apiKeyEnc, undefined);
});

test('P1-1: Doubao handshake + real testRealtimeTranscribe + single-emit definite + cancel guard', async () => {
  const WS = createMockWsFactory((ws) => {
    let seenInit = false;
    ws.on('__client_send', (buf) => {
      const msgType = (buf[1] >> 4) & 0xf;
      const flags = buf[1] & 0xf;
      if (msgType === 0x1 && !seenInit) {
        seenInit = true;
        ws.serverSend(makeDoubaoServerResponse({ result: { text: '' } }, { seq: 1 }));
      } else if (msgType === 0x2) {
        const isLast = (flags & 0x2) !== 0;
        if (!isLast) {
          ws.serverSend(makeDoubaoServerResponse({
            result: { utterances: [{ text: '测试语音', start_time: 0, end_time: 400, definite: false }] }
          }, { seq: 2 }));
        } else {
          // Send duplicate definite utterance to verify dedupe (emitted only once!)
          ws.serverSend(makeDoubaoServerResponse({
            result: { utterances: [{ text: '测试语音识别成功', start_time: 0, end_time: 1000, definite: true }] }
          }, { seq: 3, isLast: false }));
          ws.serverSend(makeDoubaoServerResponse({
            result: { utterances: [{ text: '测试语音识别成功', start_time: 0, end_time: 1000, definite: true }] }
          }, { seq: 4, isLast: true }));
        }
      }
    });
    ws.serverOpen({ 'x-tt-logid': 'tt-log-001' });
  });

  const cfg = {
    provider: 'doubao',
    baseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    model: 'bigmodel',
    resourceId: 'volc.seedasr.sauc.duration',
    authMode: 'api-key',
    apiKey: 'secret-doubao-key-abcdef'
  };

  const hs = await asrAdapters.testRealtimeConnection(cfg, { WebSocket: WS });
  assert.equal(hs.ok, true);
  assert.equal(hs.connected, true);
  assert.equal(hs.requestId, 'tt-log-001');

  const pcm = new Float32Array(6400); // 400ms @ 16kHz
  const tr = await asrAdapters.testRealtimeTranscribe(cfg, pcm, { WebSocket: WS, paceMs: 0 });
  assert.equal(tr.ok, true);
  assert.equal(tr.connected, true);
  assert.equal(tr.transcript, '测试语音识别成功');
  assert.match(tr.messageZh, /试转写成功/);

  // Verify cancel() suppresses late packets completely
  const engine = await asrAdapters.createRealtimeEngine(cfg, { WebSocket: WS });
  const lateEvents = [];
  const sess = engine.openSession({
    onPartial: (t) => lateEvents.push(['p', t]),
    onSentence: (s) => lateEvents.push(['s', s.text]),
    onError: (e) => lateEvents.push(['e', e])
  });
  sess.cancel();
  WS.instances[WS.instances.length - 1].serverSend(makeDoubaoServerResponse({
    result: { utterances: [{ text: '迟到句子', start_time: 0, end_time: 500, definite: true }] }
  }, { seq: 5, isLast: true }));
  assert.equal(lateEvents.length, 0);
});

test('P1-1: Structured error taxonomy (Auth 401, Resource 403, Connected+AudioError, Secret Redaction)', async () => {
  const cfg = {
    provider: 'doubao',
    baseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    model: 'bigmodel',
    resourceId: 'volc.seedasr.sauc.duration',
    apiKey: 'super-secret-token-99999'
  };

  // 1. Auth 401 with leaked secret in server body -> must redact!
  const Ws401 = createMockWsFactory((ws) => {
    ws.serverRejectHttp(401, { 'x-tt-logid': 'log-401', 'x-api-status-code': '45000010' }, 'bad key super-secret-token-99999');
  });
  const r401 = await asrAdapters.testRealtimeConnection(cfg, { WebSocket: Ws401 });
  assert.equal(r401.ok, false);
  assert.equal(r401.code, 'AUTH_FAILED');
  assert.equal(r401.stage, 'auth');
  assert.equal(r401.requestId, 'log-401');
  assert.equal(JSON.stringify(r401).includes('super-secret-token-99999'), false);

  // 2. Resource unauthorized (45000030)
  const Ws403 = createMockWsFactory((ws) => {
    ws.on('__client_send', () => {
      ws.serverSend(makeDoubaoServerError(45000030, 'resource not granted'));
    });
    ws.serverOpen({ 'x-tt-logid': 'log-403' });
  });
  const r403 = await asrAdapters.testRealtimeConnection(cfg, { WebSocket: Ws403 });
  assert.equal(r403.ok, false);
  assert.equal(r403.code, 'RESOURCE_UNAUTHORIZED');
  assert.equal(r403.rawCode, '45000030');

  // 3. Handshake succeeds, then audio packet triggers 45000001 -> must clearly say "已连接，试转写失败"
  const WsAudioErr = createMockWsFactory((ws) => {
    let initDone = false;
    ws.on('__client_send', (buf) => {
      const msgType = (buf[1] >> 4) & 0xf;
      if (msgType === 0x1 && !initDone) {
        initDone = true;
        ws.serverSend(makeDoubaoServerResponse({ result: {} }, { seq: 1 }));
      } else if (msgType === 0x2) {
        ws.serverSend(makeDoubaoServerError(45000001, 'invalid audio format'));
      }
    });
    ws.serverOpen({ 'x-tt-logid': 'log-audio' });
  });
  const rAudio = await asrAdapters.testRealtimeTranscribe(cfg, new Float32Array(3200), { WebSocket: WsAudioErr, paceMs: 0 });
  assert.equal(rAudio.ok, false);
  assert.equal(rAudio.connected, true);
  assert.equal(rAudio.code, 'AUDIO_FORMAT_ERROR');
  assert.equal(rAudio.stage, 'audio');
  assert.match(rAudio.messageZh, /已连接，试转写失败/);
});

test('P1-1: DashScope realtime adapter handshake + testRealtimeTranscribe', async () => {
  const WsDash = createMockWsFactory((ws) => {
    ws.on('__client_send', (data) => {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.header?.action === 'run-task') {
          ws.serverSend(JSON.stringify({ header: { event: 'task-started', task_id: msg.header.task_id } }), false);
        } else if (msg.header?.action === 'finish-task') {
          ws.serverSend(JSON.stringify({
            header: { event: 'result-generated', task_id: msg.header.task_id },
            payload: { output: { sentence: { text: '百炼流式转写通过', sentence_end: true, begin_time: 0, end_time: 800 } } }
          }), false);
          ws.serverSend(JSON.stringify({ header: { event: 'task-finished', task_id: msg.header.task_id } }), false);
        }
      }
    });
    ws.serverOpen();
  });
  const cfg = {
    provider: 'dashscope',
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    model: 'paraformer-realtime-v2',
    apiKey: 'sk-dashscope-test-123456'
  };
  const tr = await asrAdapters.testRealtimeTranscribe(cfg, new Float32Array(3200), { WebSocket: WsDash, paceMs: 0 });
  assert.equal(tr.ok, true);
  assert.equal(tr.transcript, '百炼流式转写通过');
});

// =============================================================================
// P1-2: Eye Contact camera registration status + tolerant device matching
// =============================================================================

test('P1-2: EyeContact exposes checkCameraRegistration & justRegistered flag', async () => {
  const ec = createEyeContact({
    platform: {
      assertAvailable: async () => {},
      resources: async () => ({ helper: 'h', softcam: 's', sdkDir: '.' }),
      ensureCamera: async () => ({ registered: true, name: 'DirectShow Softcam', dll: 'softcam.dll', justRegistered: true }),
      cameraStatus: async () => ({ registered: true, name: 'DirectShow Softcam', dll: 'softcam.dll', justRegistered: false })
    }
  });
  const reg = await ec.checkCameraRegistration();
  assert.equal(reg.registered, true);
  assert.equal(reg.name, 'DirectShow Softcam');
  assert.equal(ec.getState().cameraRegistration.registered, true);
});

// =============================================================================
// P2-1: Workbench shortcut reset surfaces real OS registration conflicts
// =============================================================================

test('P2-1: resetWorkbenchHotkeys restores defaults and reports OS-occupied conflicts without swallowing them', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hk-reset-'));
  try {
    const prefs = createWorkbenchPrefs({ file: path.join(tmpDir, 'workbench-prefs.json') });
    const [targetAction, occupiedKey] = Object.entries(DEFAULT_WORKBENCH_HOTKEYS).find(([, v]) => Boolean(v && !/^Mouse[45]$/.test(v)));
    assert.ok(targetAction && occupiedKey, 'expected at least one keyboard default hotkey');
    prefs.applyPatch({ workbenchHotkeys: { ...DEFAULT_WORKBENCH_HOTKEYS, [targetAction]: 'Control+Alt+1' } });
    const registered = new Set();
    const fakeShortcuts = {
      isRegistered: (k) => k === occupiedKey || registered.has(k),
      register: (k) => {
        if (k === occupiedKey) return false;
        registered.add(k);
        return true;
      },
      unregister: (k) => registered.delete(k)
    };
    const wb = createWorkbenchWindow({
      prefs,
      shortcuts: fakeShortcuts,
      screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getAllDisplays: () => [] }
    });
    const st = wb.resetWorkbenchHotkeys();
    assert.equal(st.workbenchHotkeys[targetAction], occupiedKey);
    assert.ok(st.hotkeyErrors.some(msg => msg.includes(occupiedKey)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// =============================================================================
// P2-3 & P2-4 & settingsPatch: ESM module assertions
// =============================================================================

test('P2-4: summarizeWrittenCounts counts root problems separately from follow-ups', async () => {
  const mod = await import(pathToFileURL(path.resolve(__dirname, '../cuedesk/ui/src/core/sessionModel.js')).href);
  let sess = mod.createEmptySession({ scene: 'written', name: '笔试' });
  sess = mod.addQuestionWithAttempt(sess, { questionId: 'q1', requestId: 'r1', prompt: '栈题截图', kind: 'shot' });
  sess = mod.addQuestionWithAttempt(sess, { questionId: 'q2', requestId: 'r2', prompt: '为什么是 12', kind: 'free', parentQuestionId: 'q1', isFollowup: true });

  const sum = mod.summarizeWrittenCounts(sess);
  assert.equal(sum.problemCount, 1);
  assert.equal(sum.followupCount, 1);
  assert.equal(sum.summaryText, '已作答 1 题 · 1 次追问');
  assert.equal(sum.compactText, '1 题 · 1 次追问');
  assert.equal(sum.getProblemIndex('q1'), 1);
  assert.equal(sum.getProblemIndex('q2'), 1);

  // Adding a second root problem increments problemCount to 2
  sess = mod.addQuestionWithAttempt(sess, { questionId: 'q3', requestId: 'r3', prompt: '第二题', kind: 'shot' });
  const sum2 = mod.summarizeWrittenCounts(sess);
  assert.equal(sum2.problemCount, 2);
  assert.equal(sum2.followupCount, 1);
  assert.equal(sum2.getProblemIndex('q3'), 2);
});

test('P1-1: buildSettingsDiffPatch tracks realtime provider, resourceId, authMode, appKey independently', async () => {
  const mod = await import(pathToFileURL(path.resolve(__dirname, '../cuedesk/ui/src/core/settingsPatch.js')).href);
  const base = {
    baseUrl: 'https://api.example.com/v1', model: 'm1', reasoningEffort: 'default', answerLang: 'chinese',
    visionBaseUrl: '', visionModel: '', visionProxy: '', multimodal: null,
    asrBackend: 'cloud-realtime', language: 'auto', cloudBaseUrl: '', cloudModel: '',
    rtProvider: 'dashscope', rtBaseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', rtModel: 'paraformer-realtime-v2',
    rtResourceId: '', rtAuthMode: 'api-key', rtAppKey: '', rtLocalModel: 'fun-asr-nano',
    themDeviceId: '', micDeviceId: '', hotkey: 'Control+B', hotkeyShot: 'Control+Shift+S', hotkeyRegion: 'Control+Alt+A',
    theme: 'light', fontScale: 'medium', uiLang: 'zh', autoLaunch: false, interviewPrompt: ''
  };
  const next = {
    ...base,
    rtProvider: 'doubao',
    rtBaseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
    rtModel: 'bigmodel',
    rtResourceId: 'volc.seedasr.sauc.duration',
    rtAuthMode: 'api-key'
  };
  const diff = mod.buildSettingsDiffPatch(base, next, { keys: { realtime: 'doubao-key-123' } });
  assert.equal(diff.llm, undefined);
  assert.equal(diff.asr.realtime.provider, 'doubao');
  assert.equal(diff.asr.realtime.resourceId, 'volc.seedasr.sauc.duration');
  assert.equal(diff.asr.realtime.apiKey, 'doubao-key-123');
});
