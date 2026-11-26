'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const asrAdapters = require('../meeting-copilot/tools/asr-adapters.cjs');

async function loadUiModules() {
  const coreDir = path.resolve(__dirname, '../meeting-copilot/ui/src/core');
  const [turnPolicy, sessionModel, settingsPatch] = await Promise.all([
    import(pathToFileURL(path.join(coreDir, 'turnPolicy.js')).href),
    import(pathToFileURL(path.join(coreDir, 'sessionModel.js')).href),
    import(pathToFileURL(path.join(coreDir, 'settingsPatch.js')).href)
  ]);
  return { turnPolicy, sessionModel, settingsPatch };
}

function createFakeClock(start = 10000) {
  let current = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => current,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { id, fn, at: current + Math.max(0, ms) });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    advance(ms) {
      const target = current + ms;
      while (true) {
        let earliest = null;
        for (const t of timers.values()) {
          if (t.at <= target && (!earliest || t.at < earliest.at)) earliest = t;
        }
        if (!earliest) break;
        timers.delete(earliest.id);
        current = earliest.at;
        earliest.fn();
      }
      current = target;
    }
  };
}

// =============================================================================
// 1. Protocol-Level Low-Latency Segmentation Parameters (Doubao / DashScope / Xfyun / OpenAI / Deepgram)
// =============================================================================

test('Segmentation: Doubao, DashScope, Qwen3-ASR, OpenAI, Deepgram & Xfyun honor segmentationMode profiles', () => {
  // Doubao SAUC v3 end_window_size
  assert.equal(asrAdapters.buildDoubaoInitPayload({ model: 'bigmodel' }, 'auto', { segmentationMode: 'fast' }).request.end_window_size, 450);
  assert.equal(asrAdapters.buildDoubaoInitPayload({ model: 'bigmodel' }, 'auto', { segmentationMode: 'balanced' }).request.end_window_size, 650);
  assert.equal(asrAdapters.buildDoubaoInitPayload({ model: 'bigmodel' }, 'auto', { segmentationMode: 'long' }).request.end_window_size, 1100);

  // DashScope Paraformer v2 max_sentence_silence + semantic_punctuation_enabled=false
  const dashFast = asrAdapters.buildDashScopeRunTaskPayload(
    { baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', model: 'paraformer-realtime-v2' },
    'task-1',
    'chinese',
    { segmentationMode: 'fast' }
  );
  assert.equal(dashFast.payload.parameters.semantic_punctuation_enabled, false);
  assert.equal(dashFast.payload.parameters.max_sentence_silence, 450);

  const dashBal = asrAdapters.buildDashScopeRunTaskPayload(
    { baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', model: 'fun-asr-realtime' },
    'task-2',
    'auto',
    { segmentationMode: 'balanced' }
  );
  assert.equal(dashBal.payload.parameters.max_sentence_silence, 700);

  // Local sidecar & legacy v1 models must NOT receive v2-only silence fields
  const localSidecar = asrAdapters.buildDashScopeRunTaskPayload(
    { baseUrl: 'ws://127.0.0.1:10097', model: 'fun-asr-nano' },
    'task-3',
    'auto',
    { segmentationMode: 'fast' }
  );
  assert.equal(localSidecar.payload.parameters.max_sentence_silence, undefined);

  const legacyV1 = asrAdapters.buildDashScopeRunTaskPayload(
    { baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', model: 'paraformer-realtime-v1' },
    'task-4',
    'auto',
    { segmentationMode: 'fast' }
  );
  assert.equal(legacyV1.payload.parameters.max_sentence_silence, undefined);

  // OpenAI Realtime & Aliyun Qwen3-ASR silence_duration_ms
  const qwenFast = asrAdapters.buildOpenAiRealtimeInitEvent(
    { baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime', model: 'qwen3-asr-flash-realtime' },
    'chinese',
    { segmentationMode: 'fast' }
  );
  assert.equal(qwenFast.session.turn_detection.silence_duration_ms, 450);

  const oaiLong = asrAdapters.buildOpenAiRealtimeInitEvent(
    { baseUrl: 'wss://api.openai.com/v1/realtime', model: 'gpt-4o-mini-transcribe' },
    'chinese',
    { segmentationMode: 'long' }
  );
  assert.equal(oaiLong.session.turn_detection.silence_duration_ms, 900);

  // Deepgram endpointing
  const dgFast = new URL(asrAdapters.buildDeepgramUrl({ baseUrl: 'wss://api.deepgram.com/v1/listen', model: 'nova-3' }, 'auto', { segmentationMode: 'fast' }));
  assert.equal(dgFast.searchParams.get('endpointing'), '250');
  const dgCustom = new URL(asrAdapters.buildDeepgramUrl({ baseUrl: 'wss://api.deepgram.com/v1/listen?endpointing=500', model: 'nova-3' }, 'auto', { segmentationMode: 'fast' }));
  assert.equal(dgCustom.searchParams.get('endpointing'), '500', 'explicit user endpointing in URL must be preserved');

  // iFlytek RTASR vadMdn for system loopback ("them") vs far-field mic
  const xfThem = asrAdapters.buildXfyunSignedUrl(
    { baseUrl: 'wss://rtasr.xfyun.cn/v1/ws', appId: '5f1234ab', apiKey: 'xf_secret', model: 'cn' },
    { timestampSec: 1700000000, channel: 'them' }
  );
  assert.equal(new URL(xfThem.url).searchParams.get('vadMdn'), '2');

  const xfMic = asrAdapters.buildXfyunSignedUrl(
    { baseUrl: 'wss://rtasr.xfyun.cn/v1/ws', appId: '5f1234ab', apiKey: 'xf_secret', model: 'cn' },
    { timestampSec: 1700000000, vadMdn: '1' }
  );
  assert.equal(new URL(xfMic.url).searchParams.get('vadMdn'), '1');
  assert.equal(xfThem.signa, xfMic.signa, 'vadMdn must not alter iFlytek MD5+HMAC-SHA1 signa');
});

// =============================================================================
// 2. Cross-Channel Audio Echo Gate & Text-Level Speaker Echo Deduplicator
// =============================================================================

test('EchoGuard: audio gate suppresses leaked speaker wakeups on idle me-channel without blocking real speech', () => {
  const gate = asrAdapters.createCrossChannelEchoGate({ hangoverMs: 260 });

  // Interviewer speaks loudly on system audio ("them")
  gate.observeThem({ rms: 0.04, speechActive: true, now: 1000 });

  // Leaked acoustic echo on idle mic ("me") at moderate RMS -> suppressed!
  assert.equal(gate.shouldSuppressMe({ rms: 0.025, meStreamOpen: false, now: 1080 }), true);

  // Loud near-field genuine user barge-in -> NOT suppressed!
  assert.equal(gate.shouldSuppressMe({ rms: 0.11, meStreamOpen: false, now: 1080 }), false);

  // Already-open user stream -> NOT chopped by audio gate (defers edge cases to text dedup)
  assert.equal(gate.shouldSuppressMe({ rms: 0.025, meStreamOpen: true, now: 1080 }), false);

  // After interviewer finishes + hangover passes -> normal user speech passes cleanly
  gate.observeThem({ rms: 0.002, speechActive: false, now: 1400 });
  assert.equal(gate.shouldSuppressMe({ rms: 0.025, meStreamOpen: false, now: 1400 }), false);
});

test('EchoGuard: text-level deduplicator filters leaked speaker echo in me-channel while preserving real answers', async () => {
  const { turnPolicy } = await loadUiModules();
  const recent = [
    { id: 1, speaker: 'them', text: '请你介绍一下你在 RAG 项目里怎么做的分块优化？', startTs: 1000, endTs: 2000 },
    { id: 2, speaker: 'them', text: '以及为什么没有选固定长度切分？', startTs: 2100, endTs: 3000 }
  ];

  // Near-exact speaker leak 700ms later
  const leak1 = turnPolicy.isEchoOfRecentThem('介绍一下你在RAG项目里怎么做的分块优化', recent, 3700);
  assert.equal(leak1.isEcho, true);
  assert.ok(leak1.score >= 0.65);

  // Merged leak across 2 consecutive them segments
  const leak2 = turnPolicy.isEchoOfRecentThem('怎么做的分块优化以及为什么没有选固定长度切分', recent, 3800);
  assert.equal(leak2.isEcho, true);

  // Genuine user answer
  const realAns = turnPolicy.isEchoOfRecentThem('我在这个项目里主要用了语义分块加上父子文档索引，把召回率提升了不少', recent, 4000);
  assert.equal(realAns.isEcho, false);

  // Outside 3.5s window (candidate quotes the question 10 seconds later) -> NOT filtered as echo
  const delayedQuote = turnPolicy.isEchoOfRecentThem('介绍一下你在RAG项目里怎么做的分块优化', recent, 15000);
  assert.equal(delayedQuote.isEcho, false);
});

// =============================================================================
// 3. Lossless TurnAggregator + Partial Extension + Speculative Question Revision
// =============================================================================

test('TurnAggregator: lossless merging of multi-clause questions & incomplete Tier-C fragments without dropping Clause A', async () => {
  const { turnPolicy } = await loadUiModules();
  const clock = createFakeClock(1000);
  const dispatched = [];
  const revised = [];
  let qSeq = 0;

  const agg = turnPolicy.createTurnAggregator({
    getMode: () => 'balanced',
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDispatch: (payload) => {
      const qid = `q-${++qSeq}`;
      dispatched.push({ qid, at: clock.now(), ...payload });
      return qid;
    },
    onRevise: (payload) => {
      revised.push({ at: clock.now(), ...payload });
    }
  });

  // Clause A: declarative setup (Tier B -> 620ms buffer)
  agg.onSegment({ id: 1, text: '我看你简历里写了一个 RAG 课程问答项目。', ts: clock.now() });
  clock.advance(300);
  assert.equal(dispatched.length, 0, 'Tier B setup should still be buffering at 300ms');

  // Clause B: backchannel ignored without clearing buffer
  agg.onSegment({ id: 2, text: '嗯', ts: clock.now() });
  assert.equal(agg.getDebugState().pendingCount, 1);

  // Clause C: actual question arrives -> combined becomes Tier A -> dispatches in 180ms with BOTH segments!
  agg.onSegment({ id: 3, text: '你当时分块怎么做的？', ts: clock.now() });
  clock.advance(180);
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0].sourceSegmentIds, [1, 3]);
  assert.match(dispatched[0].prompt, /RAG 课程问答项目/);
  assert.match(dispatched[0].prompt, /分块怎么做的/);

  // Advance past revision window (4s) then test Tier C incomplete fragment + follow-up
  clock.advance(4000);
  agg.onSegment({ id: 4, text: '关于这个项目，因为', ts: clock.now() });
  clock.advance(500);
  assert.equal(dispatched.length, 1, 'Incomplete Tier C fragment must wait');
  agg.onSegment({ id: 5, text: '你们为什么选 Qdrant 而不是 Milvus？', ts: clock.now() });
  clock.advance(180);
  assert.equal(dispatched.length, 2);
  assert.deepEqual(dispatched[1].sourceSegmentIds, [4, 5]);
  assert.match(dispatched[1].prompt, /关于这个项目，因为/);
  assert.match(dispatched[1].prompt, /Qdrant/);
  assert.equal(revised.length, 0);
});

test('TurnAggregator: speculative Question Revision merges 3.5s follow-up qualifier, stops on topic switch or user speech', async () => {
  const { turnPolicy } = await loadUiModules();
  const clock = createFakeClock(5000);
  const dispatched = [];
  const revised = [];
  let qSeq = 0;

  const agg = turnPolicy.createTurnAggregator({
    getMode: () => 'balanced',
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDispatch: (payload) => {
      const qid = `q-${++qSeq}`;
      dispatched.push({ qid, at: clock.now(), ...payload });
      return qid;
    },
    onRevise: (payload) => {
      revised.push({ at: clock.now(), ...payload });
    }
  });

  // 1. Explicit question dispatches quickly (~180ms)
  agg.onSegment({ id: 10, text: 'Redis 持久化是怎么做的？', ts: clock.now() });
  clock.advance(180);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].qid, 'q-1');

  // 2. Interviewer adds a qualifier 1.2s later -> revises q-1 in place (NO q-2!)
  clock.advance(1200);
  agg.onSegment({ id: 11, text: '重点说说 AOF 重写期间怎么避免阻塞主线程', ts: clock.now() });
  clock.advance(200);
  assert.equal(dispatched.length, 1, 'Must NOT spawn a duplicate question card');
  assert.equal(revised.length, 1);
  assert.equal(revised[0].questionId, 'q-1');
  assert.deepEqual(revised[0].addedSegmentIds, [11]);
  assert.match(revised[0].fullPrompt, /Redis 持久化是怎么做的/);
  assert.match(revised[0].fullPrompt, /AOF 重写期间/);

  // 3. Explicit topic switch 1.5s later -> MUST dispatch new q-2 instead of revising q-1
  clock.advance(1500);
  agg.onSegment({ id: 12, text: '好的下一题，讲讲 TCP 三次握手为什么不能两次？', ts: clock.now() });
  clock.advance(180);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].qid, 'q-2');
  assert.equal(revised.length, 1);

  // 4. Candidate starts answering -> closes revision window immediately; interviewer remark becomes q-3
  clock.advance(400);
  agg.onMeSpeech();
  clock.advance(600);
  agg.onSegment({ id: 13, text: '那四次挥手的 TIME_WAIT 作用是什么？', ts: clock.now() });
  clock.advance(180);
  assert.equal(dispatched.length, 3);
  assert.equal(dispatched[2].qid, 'q-3');
  assert.equal(revised.length, 1);
});

test('TurnAggregator: partial extension delays flush cleanly but respects maxHoldMs cap', async () => {
  const { turnPolicy } = await loadUiModules();
  const clock = createFakeClock(1000);
  const dispatched = [];

  const agg = turnPolicy.createTurnAggregator({
    getMode: () => 'fast', // tierBMs=480, partialExtendMs=450, maxHoldMs=1500
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDispatch: (p) => { dispatched.push({ at: clock.now(), ...p }); return 'q-1'; }
  });

  agg.onSegment({ id: 1, text: '假设我们现在有一个高并发订单系统。', ts: clock.now() });
  clock.advance(350);
  agg.onPartial('然后每秒大概十万请求');
  clock.advance(200); // 550ms total (> 480ms), still extended by partial!
  assert.equal(dispatched.length, 0);

  // Keep pumping partials; must STILL flush at or before maxHoldMs (1500ms)
  for (let i = 0; i < 6; i++) {
    clock.advance(200);
    agg.onPartial(`继续说话 ${i}`);
  }
  assert.equal(dispatched.length, 1);
  assert.ok(dispatched[0].at - 1000 <= 1550, 'Must never exceed maxHoldMs cap');
});

// =============================================================================
// 4. sessionModel reviseQuestionWithAttempt & settingsPatch segmentation/echoGuard diff
// =============================================================================

test('SessionModel & settingsPatch: reviseQuestionWithAttempt replaces short stream in-place, versions long stream, and settingsPatch diffs new fields', async () => {
  const { sessionModel, settingsPatch } = await loadUiModules();

  let s = sessionModel.createEmptySession({ name: '同题修订测试' });
  s = sessionModel.addQuestionWithAttempt(s, {
    questionId: 'q1',
    requestId: 'req-1',
    prompt: 'Redis 持久化怎么做？',
    sourceSegmentIds: [10]
  });
  // Only 8 chars streamed so far -> replace in-place cleanly (no empty v1 clutter)
  s = sessionModel.applyLlmEvent(s, { requestId: 'req-1', kind: 'delta', text: '主要有 RDB' });
  const rev1 = sessionModel.reviseQuestionWithAttempt(s, 'q1', {
    nextPrompt: 'Redis 持久化怎么做？重点说说 AOF 重写',
    addedSegmentIds: [11],
    requestId: 'req-2'
  });
  assert.deepEqual(rev1.cancelledRequestIds, ['req-1']);
  assert.equal(rev1.session.questions.length, 1);
  assert.equal(rev1.session.questions[0].attempts.length, 1);
  assert.equal(rev1.session.questions[0].activeAttemptId, 'req-2');
  assert.equal(rev1.session.questions[0].revisedCount, 1);
  assert.deepEqual(rev1.session.questions[0].sourceSegmentIds, [10, 11]);

  // Now stream >= 40 chars -> second revision preserves req-2 as cancelled v1 and appends req-3 as v2
  s = sessionModel.applyLlmEvent(
    rev1.session,
    { requestId: 'req-2', kind: 'delta', text: 'Redis 持久化主要有 RDB 快照和 AOF 日志两种机制，AOF 重写通过 fork 子进程在后台执行以降低主线程阻塞。' }
  );
  const rev2 = sessionModel.reviseQuestionWithAttempt(s, 'q1', {
    nextPrompt: 'Redis 持久化怎么做？重点说说 AOF 重写，以及混合持久化怎么配？',
    addedSegmentIds: [12],
    requestId: 'req-3'
  });
  assert.deepEqual(rev2.cancelledRequestIds, ['req-2']);
  assert.equal(rev2.session.questions[0].attempts.length, 2);
  assert.equal(rev2.session.questions[0].attempts[0].status, 'cancelled');
  assert.equal(rev2.session.questions[0].attempts[1].id, 'req-3');
  assert.equal(rev2.session.questions[0].revisedCount, 2);

  // settingsPatch diff coverage
  const base = {
    baseUrl: '', model: '', reasoningEffort: 'default', answerLang: 'chinese', llmProviderId: 'custom',
    visionBaseUrl: '', visionModel: '', visionProxy: '', multimodal: null,
    asrBackend: 'cloud-realtime', language: 'auto', segmentationMode: 'balanced', echoGuard: true,
    cloudProtocol: 'openai-transcriptions', cloudBaseUrl: '', cloudModel: '',
    rtProvider: 'doubao', rtBaseUrl: '', rtModel: '', rtResourceId: '', rtAuthMode: 'api-key', rtAppId: '', rtAppKey: '',
    rtLocalModel: 'fun-asr-nano', asrProviderId: 'doubao',
    themDeviceId: '', micDeviceId: '', hotkey: 'Control+B', hotkeyShot: 'Control+Shift+S', hotkeyRegion: 'Control+Alt+A',
    theme: 'light', fontScale: 'medium', uiLang: 'zh', autoLaunch: false, interviewPrompt: ''
  };
  const p = settingsPatch.buildSettingsDiffPatch(base, { ...base, segmentationMode: 'fast', echoGuard: false });
  assert.equal(p.asr.segmentationMode, 'fast');
  assert.equal(p.asr.echoGuard, false);
  assert.equal(p.asr.realtime, undefined, 'Changing segmentationMode/echoGuard must NOT rewrite realtime credentials');
});
