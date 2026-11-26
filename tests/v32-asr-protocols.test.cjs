'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const asrAdapters = require('../cuedesk/tools/asr-adapters.cjs');

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

function makeSamplePcm(samples = 6400) {
  const pcm = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.25;
  }
  return pcm;
}

// =============================================================================
// 1. OpenAI Realtime Transcription WS (OpenAI 24kHz & Aliyun Qwen3-ASR 16kHz)
// =============================================================================

test('ASR-Protocol: OpenAI Realtime WS URL, 16k->24k resample, init event & transcribe round-trip', async () => {
  const url = asrAdapters.buildOpenAiRealtimeUrl({
    baseUrl: 'wss://api.openai.com/v1/realtime',
    model: 'gpt-4o-mini-transcribe'
  });
  assert.equal(url, 'wss://api.openai.com/v1/realtime?intent=transcription');

  const initEv = asrAdapters.buildOpenAiRealtimeInitEvent({
    baseUrl: 'wss://api.openai.com/v1/realtime?intent=transcription',
    model: 'gpt-4o-mini-transcribe'
  }, 'chinese');
  assert.equal(initEv.type, 'transcription_session.update');
  assert.equal(initEv.session.input_audio_format, 'pcm16');
  assert.equal(initEv.session.input_audio_transcription.model, 'gpt-4o-mini-transcribe');
  assert.equal(initEv.session.input_audio_transcription.language, 'zh');

  const receivedEvents = [];
  const audioChunkByteLengths = [];
  let capturedHeaders = null;

  const MockWs = createMockWsFactory((ws, _url, opts) => {
    capturedHeaders = opts.headers;
    ws.on('__client_send', (raw) => {
      const ev = JSON.parse(String(raw));
      receivedEvents.push(ev.type);
      if (ev.type === 'transcription_session.update') {
        ws.serverSend(JSON.stringify({ type: 'transcription_session.updated', session: { id: 'sess_oai_01' } }), false);
      } else if (ev.type === 'input_audio_buffer.append') {
        audioChunkByteLengths.push(Buffer.from(ev.audio, 'base64').length);
      } else if (ev.type === 'input_audio_buffer.commit') {
        ws.serverSend(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: '你好' }), false);
        ws.serverSend(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '你好，这是测试语音' }), false);
      }
    });
    ws.serverOpen({ 'x-request-id': 'req_oai_99' });
  });

  const res = await asrAdapters.testRealtimeTranscribe(
    {
      provider: 'openai-realtime',
      baseUrl: 'wss://api.openai.com/v1/realtime',
      model: 'gpt-4o-mini-transcribe',
      apiKey: 'sk-openai-test-123456'
    },
    makeSamplePcm(6400), // 2 chunks of 3200 samples @ 16kHz -> each resampled to 4800 samples @ 24kHz -> 9600 bytes
    { WebSocket: MockWs, language: 'chinese', paceMs: 0 }
  );

  assert.equal(res.ok, true);
  assert.equal(res.transcript, '你好，这是测试语音');
  assert.equal(capturedHeaders.Authorization, 'Bearer sk-openai-test-123456');
  assert.equal(capturedHeaders['OpenAI-Beta'], 'realtime=v1');
  assert.ok(receivedEvents.includes('transcription_session.update'));
  assert.ok(receivedEvents.includes('input_audio_buffer.commit'));
  assert.equal(audioChunkByteLengths.length, 2);
  assert.equal(audioChunkByteLengths[0], 9600, '3200 samples @ 16kHz must resample to 4800 PCM16 samples (9600 bytes) @ 24kHz');
});

test('ASR-Protocol: Aliyun Qwen3-ASR-Flash-Realtime dialect keeps 16kHz PCM and sends session.finish', async () => {
  const cfg = {
    provider: 'openai-realtime',
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    model: 'qwen3-asr-flash-realtime',
    apiKey: 'sk-dash-qwen-123456'
  };
  assert.equal(asrAdapters.isDashScopeRealtimeDialect(cfg), true);
  assert.equal(
    asrAdapters.buildOpenAiRealtimeUrl(cfg),
    'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime'
  );

  const initEv = asrAdapters.buildOpenAiRealtimeInitEvent(cfg, 'chinese');
  assert.equal(initEv.type, 'session.update');
  assert.equal(initEv.session.sample_rate, 16000);
  assert.equal(initEv.session.input_audio_format, 'pcm');

  const receivedEvents = [];
  const audioChunkByteLengths = [];

  const MockWs = createMockWsFactory((ws) => {
    ws.on('__client_send', (raw) => {
      const ev = JSON.parse(String(raw));
      receivedEvents.push(ev.type);
      if (ev.type === 'session.update') {
        ws.serverSend(JSON.stringify({ type: 'session.updated', session: { id: 'sess_qwen_1' } }), false);
      } else if (ev.type === 'input_audio_buffer.append') {
        audioChunkByteLengths.push(Buffer.from(ev.audio, 'base64').length);
      } else if (ev.type === 'session.finish') {
        ws.serverSend(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '千问', stash: '实时' }), false);
        ws.serverSend(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '千问实时语音识别' }), false);
        ws.serverSend(JSON.stringify({ type: 'session.finished' }), false);
      }
    });
    ws.serverOpen();
  });

  const res = await asrAdapters.testRealtimeTranscribe(cfg, makeSamplePcm(3200), {
    WebSocket: MockWs,
    language: 'chinese',
    paceMs: 0
  });

  assert.equal(res.ok, true);
  assert.equal(res.transcript, '千问实时语音识别');
  assert.ok(receivedEvents.includes('session.update'));
  assert.ok(receivedEvents.includes('session.finish'));
  assert.equal(audioChunkByteLengths[0], 6400, 'DashScope Qwen3-ASR must send native 16kHz PCM16 (6400 bytes per 3200 samples)');
});

// =============================================================================
// 2. Deepgram Live WebSocket
// =============================================================================

test('ASR-Protocol: Deepgram Live WS Authorization Token header, query params & transcribe round-trip', async () => {
  const dgUrl = asrAdapters.buildDeepgramUrl(
    { baseUrl: 'wss://api.deepgram.com/v1/listen', model: 'nova-3' },
    'auto'
  );
  const parsed = new URL(dgUrl);
  assert.equal(parsed.searchParams.get('model'), 'nova-3');
  assert.equal(parsed.searchParams.get('encoding'), 'linear16');
  assert.equal(parsed.searchParams.get('sample_rate'), '16000');
  assert.equal(parsed.searchParams.get('interim_results'), 'true');
  assert.equal(parsed.searchParams.get('language'), 'multi');

  let capturedHeaders = null;
  let binaryBytesReceived = 0;
  const controlMsgs = [];

  const MockWs = createMockWsFactory((ws, _url, opts) => {
    capturedHeaders = opts.headers;
    ws.on('__client_send', (data) => {
      if (Buffer.isBuffer(data)) {
        binaryBytesReceived += data.length;
      } else {
        const msg = JSON.parse(String(data));
        controlMsgs.push(msg.type);
        if (msg.type === 'Finalize') {
          ws.serverSend(JSON.stringify({
            type: 'Results',
            is_final: false,
            channel: { alternatives: [{ transcript: 'Deepgram interim' }] }
          }), false);
          ws.serverSend(JSON.stringify({
            type: 'Results',
            is_final: true,
            speech_final: true,
            start: 0.1,
            duration: 1.2,
            channel: { alternatives: [{ transcript: 'Deepgram live transcript' }] }
          }), false);
        } else if (msg.type === 'CloseStream') {
          ws.close(1000, 'done');
        }
      }
    });
    ws.serverOpen({ 'dg-request-id': 'dg_req_777' });
  });

  const res = await asrAdapters.testRealtimeTranscribe(
    {
      provider: 'deepgram',
      baseUrl: 'wss://api.deepgram.com/v1/listen',
      model: 'nova-3',
      apiKey: 'dg_secret_key_987654'
    },
    makeSamplePcm(6400),
    { WebSocket: MockWs, language: 'english', paceMs: 0 }
  );

  assert.equal(res.ok, true);
  assert.equal(res.transcript, 'Deepgram live transcript');
  assert.equal(capturedHeaders.Authorization, 'Token dg_secret_key_987654');
  assert.equal(binaryBytesReceived, 12800);
  assert.deepEqual(controlMsgs, ['Finalize', 'CloseStream']);
});

// =============================================================================
// 3. Tencent Cloud Real-time ASR v2 WebSocket (HMAC-SHA1 Signing + Protocol)
// =============================================================================

test('ASR-Protocol: Tencent Cloud ASR v2 exact HMAC-SHA1 signature, validation & transcribe round-trip', async () => {
  // Missing credential validation
  const missApp = asrAdapters.validateRealtimeConfig({
    provider: 'tencent',
    baseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
    appKey: 'AKIDtest123',
    apiKey: 'secretKey123'
  });
  assert.equal(missApp.ok, false);
  assert.equal(missApp.code, 'MISSING_APP_ID');

  const missSecretId = asrAdapters.validateRealtimeConfig({
    provider: 'tencent',
    baseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
    appId: '1300001234',
    apiKey: 'secretKey123'
  });
  assert.equal(missSecretId.ok, false);
  assert.equal(missSecretId.code, 'MISSING_APP_KEY');

  // Deterministic HMAC-SHA1 signature verification
  const signed = asrAdapters.buildTencentSignedUrl(
    {
      baseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
      appId: '1300001234',
      appKey: 'AKID_TEST_ID',
      apiKey: 'TENCENT_SECRET_KEY_XYZ',
      model: '16k_zh'
    },
    { timestampSec: 1700000000, nonce: '123456', voiceId: 'voice-test-01' }
  );
  const expectedOrigin =
    'asr.cloud.tencent.com/asr/v2/1300001234?' +
    'engine_model_type=16k_zh&expired=1700086400&needvad=1&nonce=123456&secretid=AKID_TEST_ID&timestamp=1700000000&voice_format=1&voice_id=voice-test-01';
  const expectedSig = crypto
    .createHmac('sha1', 'TENCENT_SECRET_KEY_XYZ')
    .update(expectedOrigin, 'utf8')
    .digest('base64');
  assert.equal(signed.signOrigin, expectedOrigin);
  assert.equal(signed.signature, expectedSig);
  assert.ok(signed.url.startsWith('wss://asr.cloud.tencent.com/asr/v2/1300001234?'));
  assert.ok(signed.url.includes(`&signature=${encodeURIComponent(expectedSig)}`));

  // End-to-end mock WS transcription
  let binaryBytes = 0;
  let sawEndSignal = false;
  const MockWs = createMockWsFactory((ws, url) => {
    assert.ok(url.includes('/asr/v2/1300001234?'));
    assert.ok(url.includes('signature='));
    ws.on('__client_send', (data) => {
      if (Buffer.isBuffer(data)) {
        binaryBytes += data.length;
      } else {
        const msg = JSON.parse(String(data));
        if (msg.type === 'end') {
          sawEndSignal = true;
          ws.serverSend(JSON.stringify({
            code: 0,
            voice_id: 'tc_voice_1',
            result: { slice_type: 1, voice_text_str: '腾讯云实时', start_time: 0, end_time: 400 }
          }), false);
          ws.serverSend(JSON.stringify({
            code: 0,
            voice_id: 'tc_voice_1',
            result: { slice_type: 2, voice_text_str: '腾讯云实时语音识别成功', start_time: 0, end_time: 900 }
          }), false);
          ws.serverSend(JSON.stringify({ code: 0, voice_id: 'tc_voice_1', final: 1 }), false);
        }
      }
    });
    ws.serverOpen();
    ws.serverSend(JSON.stringify({ code: 0, message: 'success', voice_id: 'tc_voice_1' }), false);
  });

  const res = await asrAdapters.testRealtimeTranscribe(
    {
      provider: 'tencent',
      baseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
      appId: '1300001234',
      appKey: 'AKID_TEST_ID',
      apiKey: 'TENCENT_SECRET_KEY_XYZ',
      model: '16k_zh'
    },
    makeSamplePcm(6400),
    { WebSocket: MockWs, language: 'chinese', paceMs: 0 }
  );

  assert.equal(res.ok, true);
  assert.equal(res.transcript, '腾讯云实时语音识别成功');
  assert.equal(binaryBytes, 12800);
  assert.equal(sawEndSignal, true);
});

test('ASR-Protocol: Tencent Cloud error redacts SecretId and SecretKey from diagnostics', async () => {
  const MockWs = createMockWsFactory((ws) => {
    ws.serverOpen();
    ws.serverSend(JSON.stringify({
      code: 4002,
      message: 'signature invalid for secretid=AKID_SENSITIVE_999 key=MY_SUPER_SECRET_KEY_888'
    }), false);
  });

  const res = await asrAdapters.testRealtimeConnection(
    {
      provider: 'tencent',
      baseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
      appId: '1300001234',
      appKey: 'AKID_SENSITIVE_999',
      apiKey: 'MY_SUPER_SECRET_KEY_888',
      model: '16k_zh'
    },
    { WebSocket: MockWs }
  );

  assert.equal(res.ok, false);
  assert.equal(res.rawCode, '4002');
  const serialized = JSON.stringify(res);
  assert.ok(!serialized.includes('AKID_SENSITIVE_999'));
  assert.ok(!serialized.includes('MY_SUPER_SECRET_KEY_888'));
});

// =============================================================================
// 4. iFlytek RTASR WebSocket (MD5 Hex + HMAC-SHA1 Signing + 1280B Framing)
// =============================================================================

test('ASR-Protocol: iFlytek RTASR exact MD5-hex + HMAC-SHA1 signa, 1280B frames & JSON parsing', async () => {
  const missApp = asrAdapters.validateRealtimeConfig({
    provider: 'xfyun',
    baseUrl: 'wss://rtasr.xfyun.cn/v1/ws',
    apiKey: 'xfyun_api_key_abc'
  });
  assert.equal(missApp.ok, false);
  assert.equal(missApp.code, 'MISSING_APP_ID');

  // Verify exact official iFlytek RTASR signing algorithm: Base64(HMAC-SHA1(MD5_HEX(appid + ts), apiKey))
  const signed = asrAdapters.buildXfyunSignedUrl(
    {
      baseUrl: 'wss://rtasr.xfyun.cn/v1/ws',
      appId: '5f1234ab',
      apiKey: 'xfyun_rtasr_secret_key_99',
      model: 'cn'
    },
    { timestampSec: 1700000000, language: 'english' }
  );
  const expectedMd5Hex = crypto.createHash('md5').update('5f1234ab1700000000', 'utf8').digest('hex');
  const expectedSigna = crypto.createHmac('sha1', 'xfyun_rtasr_secret_key_99').update(expectedMd5Hex, 'utf8').digest('base64');
  assert.equal(signed.md5Hex, expectedMd5Hex);
  assert.equal(signed.signa, expectedSigna);
  const parsedUrl = new URL(signed.url);
  assert.equal(parsedUrl.searchParams.get('appid'), '5f1234ab');
  assert.equal(parsedUrl.searchParams.get('ts'), '1700000000');
  assert.equal(parsedUrl.searchParams.get('signa'), expectedSigna);
  assert.equal(parsedUrl.searchParams.get('lang'), 'en');

  // Verify extractXfyunResultText
  const extracted = asrAdapters.extractXfyunResultText({
    cn: {
      st: {
        type: '0',
        bg: '100',
        ed: '1200',
        rt: [{ ws: [{ cw: [{ w: '科大' }] }, { cw: [{ w: '讯飞' }] }, { cw: [{ w: '转写' }] }] }]
      }
    }
  });
  assert.equal(extracted, '科大讯飞转写');

  // End-to-end mock WS transcription checking 1280B chunking
  const frameSizes = [];
  let sawEnd = false;
  const MockWs = createMockWsFactory((ws) => {
    ws.on('__client_send', (data) => {
      if (Buffer.isBuffer(data)) {
        frameSizes.push(data.length);
      } else {
        const msg = JSON.parse(String(data));
        if (msg.end === true) {
          sawEnd = true;
          // Interim (type = "1")
          ws.serverSend(JSON.stringify({
            action: 'result',
            code: '0',
            data: JSON.stringify({
              cn: { st: { type: '1', bg: '0', ed: '500', rt: [{ ws: [{ cw: [{ w: '讯飞' }] }] }] } },
              ls: false
            })
          }), false);
          // Final (type = "0", ls = true)
          ws.serverSend(JSON.stringify({
            action: 'result',
            code: '0',
            data: JSON.stringify({
              cn: { st: { type: '0', bg: '0', ed: '900', rt: [{ ws: [{ cw: [{ w: '讯飞实时' }] }, { cw: [{ w: '转写成功' }] }] }] } },
              ls: true
            })
          }), false);
        }
      }
    });
    ws.serverOpen();
    ws.serverSend(JSON.stringify({ action: 'started', code: '0', data: 'xf_sid_001' }), false);
  });

  const res = await asrAdapters.testRealtimeTranscribe(
    {
      provider: 'xfyun',
      baseUrl: 'wss://rtasr.xfyun.cn/v1/ws',
      appId: '5f1234ab',
      apiKey: 'xfyun_rtasr_secret_key_99',
      model: 'cn'
    },
    makeSamplePcm(3200), // 6400 bytes -> 5 frames of 1280 bytes!
    { WebSocket: MockWs, language: 'chinese', paceMs: 0 }
  );

  assert.equal(res.ok, true);
  assert.equal(res.transcript, '讯飞实时转写成功');
  assert.equal(sawEnd, true);
  assert.deepEqual(frameSizes, [1280, 1280, 1280, 1280, 1280]);
});

// =============================================================================
// 5. HTTP Segmented ASR (OpenAI /audio/transcriptions + Legacy Chat Audio)
// =============================================================================

test('ASR-Protocol: HTTP openai-transcriptions multipart WAV, chat-audio legacy & keyless local server', async () => {
  assert.equal(
    asrAdapters.resolveTranscriptionsUrl('https://api.siliconflow.cn/v1/'),
    'https://api.siliconflow.cn/v1/audio/transcriptions'
  );
  assert.equal(
    asrAdapters.resolveTranscriptionsUrl('https://api.groq.com/openai/v1/audio/transcriptions'),
    'https://api.groq.com/openai/v1/audio/transcriptions'
  );
  assert.equal(
    asrAdapters.resolveChatAudioUrl('https://example.com/v1/'),
    'https://example.com/v1/chat/completions'
  );

  // WAV header verification
  const wav = asrAdapters.encodeWav16kMono(makeSamplePcm(1600), 16000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.length, 44 + 3200);

  // Multipart /audio/transcriptions mock fetch
  let capturedReq = null;
  const mockFetchMultipart = async (url, init) => {
    capturedReq = { url, init };
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('model'), 'FunAudioLLM/SenseVoiceSmall');
    assert.equal(init.body.get('language'), 'zh');
    assert.equal(init.body.get('response_format'), 'json');
    const file = init.body.get('file');
    assert.ok(file && file.size === 44 + 3200);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'sf_req_01' }),
      json: async () => ({ text: '硅基流动分段识别测试通过' })
    };
  };

  const resSeg = await asrAdapters.testSegmentTranscribe(
    {
      protocol: 'openai-transcriptions',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'FunAudioLLM/SenseVoiceSmall',
      apiKey: 'sk-sf-test-999999'
    },
    makeSamplePcm(1600),
    { fetchImpl: mockFetchMultipart, language: 'chinese' }
  );
  assert.equal(resSeg.ok, true);
  assert.equal(resSeg.transcript, '硅基流动分段识别测试通过');
  assert.equal(capturedReq.url, 'https://api.siliconflow.cn/v1/audio/transcriptions');
  assert.equal(capturedReq.init.headers.Authorization, 'Bearer sk-sf-test-999999');

  // Legacy chat-audio mock fetch
  const mockFetchChat = async (url, init) => {
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-4o-audio-preview');
    assert.equal(body.messages[0].content[0].type, 'input_audio');
    assert.equal(body.messages[0].content[0].input_audio.format, 'wav');
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ choices: [{ message: { content: '音频对话模型识别成功' } }] })
    };
  };

  const resChat = await asrAdapters.testSegmentTranscribe(
    {
      protocol: 'chat-audio',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-audio-preview',
      apiKey: 'sk-chat-audio-123456'
    },
    makeSamplePcm(1600),
    { fetchImpl: mockFetchChat, language: 'chinese' }
  );
  assert.equal(resChat.ok, true);
  assert.equal(resChat.transcript, '音频对话模型识别成功');

  // Keyless local HTTP server validation
  const localCheck = asrAdapters.validateSegmentConfig({
    protocol: 'openai-transcriptions',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'whisper-large-v3-turbo',
    apiKey: ''
  });
  assert.equal(localCheck.ok, true);
});

// =============================================================================
// 6. 6-Provider Profile Isolation & settingsPatch.js Diff Coverage
// =============================================================================

test('ASR-Protocol: 6-provider profile isolation preserves every provider without key leakage', () => {
  const seeded = asrAdapters.normalizeRealtimeSettings({
    provider: 'tencent',
    profiles: {
      dashscope: { baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', model: 'paraformer-realtime-v2', apiKeyEnc: 'enc-dash', apiKeyHint: '1111' },
      doubao: { baseUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel', model: 'bigmodel', resourceId: 'volc.seedasr.sauc.duration', authMode: 'api-key', apiKeyEnc: 'enc-doubao', apiKeyHint: '2222' },
      'openai-realtime': { baseUrl: 'wss://api.openai.com/v1/realtime?intent=transcription', model: 'gpt-4o-mini-transcribe', apiKeyEnc: 'enc-oai', apiKeyHint: '3333' },
      deepgram: { baseUrl: 'wss://api.deepgram.com/v1/listen', model: 'nova-3', apiKeyEnc: 'enc-dg', apiKeyHint: '4444' },
      tencent: { baseUrl: 'wss://asr.cloud.tencent.com/asr/v2', model: '16k_zh', appId: '1300112233', appKey: 'AKID_ABC', apiKeyEnc: 'enc-tc', apiKeyHint: '5555' },
      xfyun: { baseUrl: 'wss://rtasr.xfyun.cn/v1/ws', model: 'cn', appId: '5f998877', apiKeyEnc: 'enc-xf', apiKeyHint: '6666' }
    }
  });

  assert.equal(seeded.provider, 'tencent');
  assert.equal(seeded.appId, '1300112233');
  assert.equal(seeded.appKey, 'AKID_ABC');
  assert.equal(seeded.apiKeyEnc, 'enc-tc');

  // Switch active provider to xfyun; tencent & all others remain intact
  const switched = asrAdapters.normalizeRealtimeSettings({
    provider: 'xfyun',
    profiles: seeded.profiles
  });
  assert.equal(switched.provider, 'xfyun');
  assert.equal(switched.appId, '5f998877');
  assert.equal(switched.apiKeyEnc, 'enc-xf');
  assert.equal(switched.profiles.tencent.appId, '1300112233');
  assert.equal(switched.profiles.tencent.apiKeyEnc, 'enc-tc');
  assert.equal(switched.profiles.deepgram.apiKeyEnc, 'enc-dg');

  const pub = asrAdapters.publicRealtimeSettings(switched);
  assert.equal(pub.provider, 'xfyun');
  assert.equal(pub.apiKeySet, true);
  assert.equal(pub.apiKeyEnc, undefined);
  assert.equal(pub.profiles.tencent.apiKeySet, true);
  assert.equal(pub.profiles.tencent.apiKeyEnc, undefined);
  assert.equal(pub.profiles.tencent.appId, '1300112233');
  assert.equal(pub.profiles.tencent.appKey, 'AKID_ABC');
  assert.equal(pub.profiles['openai-realtime'].apiKeyHint, '3333');
  assert.equal(Object.keys(pub.profiles).length, 6);
});

test('ASR-Protocol: settingsPatch diffs cloudProtocol, tencent appId/appKey, xfyun appId without touching unrelated UI edits', async () => {
  const mod = await import(pathToFileURL(path.resolve(__dirname, '../cuedesk/ui/src/core/settingsPatch.js')).href);
  const { buildSettingsDiffPatch } = mod;

  const base = {
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-5',
    reasoningEffort: 'default',
    answerLang: 'chinese',
    llmProviderId: 'custom',
    visionBaseUrl: '',
    visionModel: '',
    visionProxy: '',
    multimodal: null,
    asrBackend: 'cloud-realtime',
    language: 'auto',
    cloudProtocol: 'openai-transcriptions',
    cloudBaseUrl: 'https://api.siliconflow.cn/v1',
    cloudModel: 'FunAudioLLM/SenseVoiceSmall',
    rtProvider: 'dashscope',
    rtBaseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    rtModel: 'paraformer-realtime-v2',
    rtResourceId: '',
    rtAuthMode: 'api-key',
    rtAppId: '',
    rtAppKey: '',
    rtLocalModel: 'fun-asr-nano',
    asrProviderId: 'dashscope',
    themDeviceId: '',
    micDeviceId: '',
    hotkey: 'Control+B',
    hotkeyShot: 'Control+Shift+S',
    hotkeyRegion: 'Control+Alt+A',
    theme: 'light',
    fontScale: 'medium',
    uiLang: 'zh',
    autoLaunch: false,
    interviewPrompt: ''
  };

  // Switching to Tencent sends appId + appKey + provider
  const pTencent = buildSettingsDiffPatch(base, {
    ...base,
    rtProvider: 'tencent',
    rtBaseUrl: 'wss://asr.cloud.tencent.com/asr/v2',
    rtModel: '16k_zh',
    rtAppId: '1300112233',
    rtAppKey: 'AKID_TEST',
    asrProviderId: 'tencent'
  }, { keys: { realtime: 'TC_SECRET' } });
  assert.equal(pTencent.asr.realtime.provider, 'tencent');
  assert.equal(pTencent.asr.realtime.appId, '1300112233');
  assert.equal(pTencent.asr.realtime.appKey, 'AKID_TEST');
  assert.equal(pTencent.asr.realtime.apiKey, 'TC_SECRET');

  // Switching cloud segmented protocol sends protocol field
  const pCloud = buildSettingsDiffPatch(base, {
    ...base,
    asrBackend: 'cloud',
    cloudProtocol: 'chat-audio',
    cloudModel: 'gpt-4o-audio-preview'
  });
  assert.equal(pCloud.asr.cloud.protocol, 'chat-audio');
  assert.equal(pCloud.asr.cloud.model, 'gpt-4o-audio-preview');

  // Changing UI fontScale does NOT include asr
  const pUi = buildSettingsDiffPatch(base, { ...base, fontScale: 'large' });
  assert.equal(pUi.ui.fontScale, 'large');
  assert.equal(pUi.asr, undefined);
});
