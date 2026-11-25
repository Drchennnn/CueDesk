'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CORE_DIR = path.resolve(__dirname, '../meeting-copilot/ui/src/core');
const FIXTURE_PATH = path.resolve(__dirname, '../meeting-copilot/analysis/前端重构交接/合成会话与验收用例.json');

async function loadCore() {
  const [sessionModel, turnPolicy, codingPrefs, hitTest, audioController] = await Promise.all([
    import(pathToFileURL(path.join(CORE_DIR, 'sessionModel.js')).href),
    import(pathToFileURL(path.join(CORE_DIR, 'turnPolicy.js')).href),
    import(pathToFileURL(path.join(CORE_DIR, 'codingPrefs.js')).href),
    import(pathToFileURL(path.join(CORE_DIR, 'clickThroughHitTest.js')).href),
    import(pathToFileURL(path.join(CORE_DIR, 'audioController.js')).href)
  ]);
  return { sessionModel, turnPolicy, codingPrefs, hitTest, audioController };
}

test('case read-older: reading question 1 stays pinned while question 2 streams and badges 1 newer question', async () => {
  const { sessionModel } = await loadCore();
  let s = sessionModel.createEmptySession({ name: '读旧题验证' });
  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'q1', requestId: 'r1', prompt: '第一题' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'r1', kind: 'done', text: '第一题完整答案' });
  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'q2', requestId: 'r2', prompt: '第二题' });

  // User clicks back to question 1 while question 2 is still generating
  s = sessionModel.selectQuestion(s, 'q1');
  assert.equal(s.selectedQuestionId, 'q1');
  assert.equal(sessionModel.countNewerQuestions(s), 0);

  // Question 2 receives streaming delta & done
  s = sessionModel.applyLlmEvent(s, { requestId: 'r2', kind: 'delta', text: '第二题片段A' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'r2', kind: 'delta', text: '片段B' });
  assert.equal(s.selectedQuestionId, 'q1');
  assert.equal(sessionModel.getActiveAttempt(s.questions[1]).text, '第二题片段A片段B');
  assert.equal(sessionModel.countNewerQuestions(s), 1);

  // Clicking the newer-question pill jumps to question 2 and clears badge
  s = sessionModel.jumpToLatestQuestion(s);
  assert.equal(s.selectedQuestionId, 'q2');
  assert.equal(sessionModel.countNewerQuestions(s), 0);
});

test('case same-text-new-question: duplicate prompt legacy turns stay distinct and idempotent across reloads', async () => {
  const { sessionModel } = await loadCore();
  const legacy = {
    currentId: 's-dup',
    sessions: [
      {
        id: 's-dup',
        name: '重复题干迁移',
        createdAt: 1795563000000,
        kbText: '旧单文件知识库内容',
        kbName: 'legacy-kb.md',
        segments: [
          { id: 10, speaker: 'them', text: '你怎样验证优化有效？', startTs: 1, endTs: 2 },
          { id: 25, speaker: 'them', text: '你怎样验证优化有效？', startTs: 3, endTs: 4 }
        ],
        turns: [
          { id: 'req-a', kind: 'segment', label: '你怎样验证优化有效？', text: '第一次回答内容', status: 'done' },
          { id: 'req-b', kind: 'segment', label: '你怎样验证优化有效？', text: '第二次回答内容', status: 'streaming' }
        ]
      }
    ]
  };

  const first = sessionModel.migrateSessionsFile(legacy);
  const s1 = first.sessions[0];
  assert.equal(s1.questions.length, 2);
  assert.notEqual(s1.questions[0].id, s1.questions[1].id);
  assert.equal(sessionModel.getActiveAttempt(s1.questions[0]).text, '第一次回答内容');
  assert.equal(sessionModel.getActiveAttempt(s1.questions[1]).text, '第二次回答内容');
  assert.equal(sessionModel.getActiveAttempt(s1.questions[1]).status, 'interrupted');
  assert.equal(s1.kbText, '旧单文件知识库内容');
  assert.deepEqual(s1.segments.map(seg => seg.id), [10, 25]);

  // Serialize to disk and reload again: IDs remain identical and no duplicates are created
  const disk = sessionModel.serializeSessionsForDisk(first.sessions, first.currentId);
  const reloaded = sessionModel.migrateSessionsFile(JSON.parse(JSON.stringify(disk)));
  const s2 = reloaded.sessions[0];
  assert.equal(s2.questions.length, 2);
  assert.deepEqual(s2.questions.map(q => q.id), s1.questions.map(q => q.id));
  assert.equal(sessionModel.getActiveAttempt(s2.questions[0]).text, '第一次回答内容');
  assert.equal(sessionModel.getActiveAttempt(s2.questions[1]).text, '第二次回答内容');
});

test('case cancel-one: cancelling A freezes A against late deltas while B completes independently of selection', async () => {
  const { sessionModel } = await loadCore();
  let s = sessionModel.createEmptySession();
  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'qA', requestId: 'reqA', prompt: '问题 A' });
  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'qB', requestId: 'reqB', prompt: '问题 B' });
  s = sessionModel.selectQuestion(s, 'qA');

  s = sessionModel.applyLlmEvent(s, { requestId: 'reqA', kind: 'delta', text: 'A的前半段' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'reqB', kind: 'delta', text: 'B的前半段' });

  // Cancel A; then late events arrive for A while B finishes
  s = sessionModel.cancelAttempt(s, 'reqA');
  s = sessionModel.applyLlmEvent(s, { requestId: 'reqA', kind: 'delta', text: '不应写入的迟到碎片' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'reqA', kind: 'done', text: '不应覆盖的结束内容' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'reqB', kind: 'delta', text: '+B的后半段' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'reqB', kind: 'done', text: 'B的前半段+B的后半段' });

  const attA = sessionModel.getActiveAttempt(s.questions[0]);
  const attB = sessionModel.getActiveAttempt(s.questions[1]);
  assert.equal(attA.status, 'cancelled');
  assert.equal(attA.text, 'A的前半段');
  assert.equal(attB.status, 'done');
  assert.equal(attB.text, 'B的前半段+B的后半段');
  assert.equal(s.selectedQuestionId, 'qA');

  // Cancelled A must NOT pollute LLM history, while done B IS included
  const hist = sessionModel.buildLlmHistory(s);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].content, '问题 B');
  assert.equal(hist[1].content, 'B的前半段+B的后半段');
});

test('case regenerate: regenerating Q1 preserves question count and blocks stale requestId events', async () => {
  const { sessionModel } = await loadCore();
  let s = sessionModel.createEmptySession();
  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'q1', requestId: 'req-1a', prompt: '第一题' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'req-1a', kind: 'done', text: '初版答案' });
  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'q2', requestId: 'req-2a', prompt: '第二题' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'req-2a', kind: 'done', text: '第二题答案' });

  s = sessionModel.selectQuestion(s, 'q1');
  s = sessionModel.regenerateQuestion(s, 'q1', { requestId: 'req-1b' });
  assert.equal(s.questions.length, 2);
  assert.equal(s.questions[0].attempts.length, 2);

  // Late stale delta for req-1a must NOT touch req-1b
  s = sessionModel.applyLlmEvent(s, { requestId: 'req-1a', kind: 'delta', text: '过期消息' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'req-1b', kind: 'delta', text: '新版答案' });
  s = sessionModel.applyLlmEvent(s, { requestId: 'req-1b', kind: 'done', text: '新版答案' });

  assert.equal(sessionModel.getActiveAttempt(s.questions[0]).id, 'req-1b');
  assert.equal(sessionModel.getActiveAttempt(s.questions[0]).text, '新版答案');
  assert.equal(s.questions[0].attempts[0].text, '初版答案');
});

test('mergeQuestions, computePrimaryButtonState, and fixture legacySession compatibility', async () => {
  const { sessionModel } = await loadCore();
  if (fs.existsSync(FIXTURE_PATH)) {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const migrated = sessionModel.migrateSessionsFile(fixture.legacySession);
    assert.equal(migrated.sessions.length, 1);
    assert.equal(migrated.sessions[0].questions.length, 2);
    assert.equal(migrated.sessions[0].segments.length, 3);
  }

  let s = sessionModel.createEmptySession();
  assert.equal(sessionModel.computePrimaryButtonState('', null).action, 'disabled');
  assert.equal(sessionModel.computePrimaryButtonState('手动输入', null).action, 'send');

  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'q1', requestId: 'r1', prompt: '第一句', sourceSegmentIds: [1] });
  assert.equal(sessionModel.computePrimaryButtonState('', s.questions[0]).action, 'stop');
  s = sessionModel.applyLlmEvent(s, { requestId: 'r1', kind: 'done', text: '答1' });
  assert.equal(sessionModel.computePrimaryButtonState('', s.questions[0]).action, 'regenerate');

  s = sessionModel.addQuestionWithAttempt(s, { questionId: 'q2', requestId: 'r2', prompt: '补充的第二句', sourceSegmentIds: [2] });
  s = sessionModel.mergeQuestions(s, 'q1', 'q2');
  assert.equal(s.questions.length, 1);
  assert.equal(s.questions[0].prompt, '第一句\n补充的第二句');
  assert.deepEqual(s.questions[0].sourceSegmentIds, [1, 2]);
  assert.deepEqual(s.questions[0].mergedFromOrdinals, [1, 2]);
  assert.equal(s.questions[0].ordinal, 1);
});

test('case asr-capability: turn policy, manual draft accumulator, source switch policy, and revision gate', async () => {
  const { turnPolicy } = await loadCore();
  assert.equal(turnPolicy.classifyTurn('好的，明白了').action, 'ignore');
  assert.equal(turnPolicy.classifyTurn('关于这个项目，如果').action, 'wait');
  assert.equal(turnPolicy.classifyTurn('如果调用超时你会怎样排查？').action, 'answer');

  assert.equal(turnPolicy.resolveAsrCapabilities({}).supportsRevision, false);
  assert.equal(turnPolicy.resolveAsrCapabilities({ supportsRevision: true }).supportsRevision, true);

  let draft = turnPolicy.createManualDraftState();
  draft = turnPolicy.appendManualDraft(draft, { id: 1, text: '先讲一下你的项目架构' });
  draft = turnPolicy.appendManualDraft(draft, { id: 2, text: '还有缓存一致性怎么保证？' });
  assert.match(draft.text, /项目架构/);
  assert.match(draft.text, /缓存一致性/);

  const switched = turnPolicy.handleAudioSourceSwitch(draft, 'mic', 'clear');
  assert.equal(switched.switched, true);
  assert.match(switched.droppedText, /项目架构/);
  assert.equal(switched.nextState.text, '');
  assert.equal(switched.nextState.audioSource, 'mic');

  draft = turnPolicy.appendManualDraft(switched.nextState, { id: 3, text: '麦克风收到的新问题？' });
  const committed = turnPolicy.commitManualDraft(draft);
  assert.equal(committed.prompt, '麦克风收到的新问题？');
  assert.deepEqual(committed.sourceSegmentIds, [3]);
  assert.equal(committed.nextState.text, '');
});

test('codingPrefs, clickThroughHitTest, and audioController system vs mic routing', async () => {
  const { codingPrefs, hitTest, audioController } = await loadCore();
  assert.equal(codingPrefs.formatCodingSummary({ mode: 'normal' }), '常规');
  assert.equal(codingPrefs.formatCodingSummary({ mode: 'coding', language: 'cpp' }), 'Coding · C++');

  // Hit-test: interactive button -> true; passive reading area -> false; 16px right scrollbar edge -> true
  const interactiveBtn = { nodeType: 1, closest: sel => sel.includes('button') ? {} : null };
  assert.equal(hitTest.isInteractiveTarget(interactiveBtn, 100, 100), true);

  const scrollBox = {
    nodeType: 1,
    dataset: { scrollable: 'true' },
    scrollHeight: 800,
    clientHeight: 300,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300 }),
    closest: () => null,
    parentElement: null
  };
  const passiveParagraph = { nodeType: 1, closest: () => null, parentElement: scrollBox };
  assert.equal(hitTest.isInteractiveTarget(passiveParagraph, 200, 150), false);
  assert.equal(hitTest.isInteractiveTarget(passiveParagraph, 392, 150), true);

  // AudioController: mic source routes directly to "them"; system source routes loopback to "them" + optional mic to "me"
  const sent = [];
  let startedCount = 0;
  let stoppedCount = 0;
  class FakeLoopback {
    constructor(cb) { this.cb = cb; }
    async start() { this.cb(new ArrayBuffer(8), 100); }
    async stop() {}
  }
  class FakeMic {
    constructor(cb, _lvl, devId) { this.cb = cb; this.devId = devId; }
    async start() { this.cb(new ArrayBuffer(4), 200); }
    async stop() {}
  }
  const ctrl = audioController.createAudioController({
    LoopbackCapture: FakeLoopback,
    MicCapture: FakeMic,
    sendPcm: (_buf, ts, ch) => sent.push({ ts, ch }),
    notifyStarted: () => { startedCount++; },
    notifyStopped: () => { stoppedCount++; }
  });

  await ctrl.start({ audioSource: 'system', micEnabled: true, micDeviceId: 'mic-1' });
  assert.deepEqual(sent, [{ ts: 100, ch: 'them' }, { ts: 200, ch: 'me' }]);
  assert.equal(startedCount, 1);

  sent.length = 0;
  await ctrl.start({ audioSource: 'mic', micEnabled: false, micDeviceId: 'mic-2' });
  assert.deepEqual(sent, [{ ts: 200, ch: 'them' }]);
  assert.equal(stoppedCount, 1);
  assert.equal(startedCount, 2);

  await ctrl.stop();
  assert.equal(stoppedCount, 2);
});
