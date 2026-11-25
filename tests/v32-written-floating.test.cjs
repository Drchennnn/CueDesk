'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createWorkbenchPrefs } = require('../meeting-copilot/tools/workbench-prefs.cjs');
const {
  createWorkbenchWindow,
  WRITTEN_DEFAULT,
  WRITTEN_MIN,
  WRITTEN_MINI_DEFAULT,
  WRITTEN_MINI_MIN
} = require('../meeting-copilot/tools/workbench-window.cjs');
const { createRouter } = require('../meeting-copilot/multimodal-router.cjs');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-v32-written-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeWindow() {
  const listeners = new Map();
  let bounds = { x: 100, y: 100, width: 1120, height: 760 };
  let minSize = [380, 440];
  let alwaysOnTop = false;
  let focusable = true;
  let ignoreMouse = { ignore: false, forward: false };
  return {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isMaximized: () => false,
    getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...bounds }),
    setBounds: (b) => { bounds = { ...b }; },
    setMinimumSize: (w, h) => { minSize = [w, h]; },
    getMinimumSize: () => [...minSize],
    setAlwaysOnTop: (on) => { alwaysOnTop = !!on; },
    isAlwaysOnTop: () => alwaysOnTop,
    setFocusable: (f) => { focusable = !!f; },
    isFocusable: () => focusable,
    focus: () => {},
    setSkipTaskbar: () => {},
    setContentProtection: () => {},
    setIgnoreMouseEvents: (ignore, opts) => { ignoreMouse = { ignore: !!ignore, forward: !!opts?.forward }; },
    getIgnoreMouse: () => ({ ...ignoreMouse }),
    on: (ev, cb) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(cb);
    }
  };
}

test('workbench-window supports written & written-mini floating modes with independent bounds and 5 core controls', t => {
  const dir = tmpDir(t);
  const prefs = createWorkbenchPrefs({ file: path.join(dir, 'prefs.json') });
  const display = { id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const cursor = { current: { x: 500, y: 500 } };
  const scr = {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getDisplayMatching: () => display,
    getCursorScreenPoint: () => cursor.current
  };
  const win = fakeWindow();
  const actions = [];
  const wb = createWorkbenchWindow({
    prefs,
    screen: scr,
    shortcuts: { isRegistered: () => false, register: () => true, unregister: () => {} },
    onHotkeyAction: (a) => actions.push(a),
    pollIntervalMs: 1000
  });
  wb.attach(win);
  t.after(() => wb.dispose());

  // 1. Enter standard written floating window (SuiSi ~440x560)
  const st1 = wb.setMode('written');
  assert.equal(st1.mode, 'written');
  assert.equal(win.getBounds().width, WRITTEN_DEFAULT.width);
  assert.equal(win.getBounds().height, WRITTEN_DEFAULT.height);
  assert.deepEqual(win.getMinimumSize(), [...WRITTEN_MIN]);
  assert.equal(win.isAlwaysOnTop(), true);

  // Move/resize written window and verify preventFocus + local smart click-through work
  win.setBounds({ x: 1320, y: 120, width: 460, height: 590 });
  wb.setPreventFocus(true);
  assert.equal(win.isFocusable(), false);
  wb.setClickThrough(true);
  assert.equal(win.getIgnoreMouse().ignore, true);
  wb.setMouseInteractive(true);
  assert.equal(win.getIgnoreMouse().ignore, false);
  wb.setMouseInteractive(false);
  assert.equal(win.getIgnoreMouse().ignore, true);

  // Floating hotkeys dispatch in written mode
  wb.dispatchHotkeyAction('questionPrev');
  wb.dispatchHotkeyAction('scrollDown');
  assert.deepEqual(actions, ['questionPrev', 'scrollDown']);

  // 2. Switch to written-mini choice strip (280x188) and save custom mini bounds
  const st2 = wb.setMode('written-mini');
  assert.equal(st2.mode, 'written-mini');
  assert.equal(win.getBounds().width, WRITTEN_MINI_DEFAULT.width);
  assert.equal(win.getBounds().height, WRITTEN_MINI_DEFAULT.height);
  assert.deepEqual(win.getMinimumSize(), [...WRITTEN_MINI_MIN]);
  win.setBounds({ x: 1500, y: 90, width: 300, height: 170 });

  // 3. Return to Home -> ALWAYS focusable, clickThrough cleared, writtenBounds preserved!
  const stHome = wb.setMode('home');
  assert.equal(stHome.mode, 'home');
  assert.equal(win.isFocusable(), true);
  assert.equal(stHome.clickThrough, false);
  assert.equal(win.getIgnoreMouse().ignore, false);

  // Re-enter written -> restores saved 460x590 bounds
  wb.setMode('written');
  assert.equal(win.getBounds().width, 460);
  assert.equal(win.getBounds().height, 590);

  // Re-enter written-mini -> restores saved 300x170 bounds
  wb.setMode('written-mini');
  assert.equal(win.getBounds().width, 300);
  assert.equal(win.getBounds().height, 170);
});

test('workbench-prefs normalizes and persists writtenConfig safely', t => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'prefs.json');
  const prefs = createWorkbenchPrefs({ file });
  const next = prefs.applyPatch({
    writtenConfig: {
      mode: 'followup',
      compactMini: true,
      systemPrompt: '优先使用 C++ ACM 模式',
      skipPreCheck: true,
      preferredEndpointId: 'ep-primary',
      simultaneousMode: 'parallel',
      miniFontSize: 99,
      showModelNames: false
    }
  });
  assert.equal(next.writtenConfig.mode, 'followup');
  assert.equal(next.writtenConfig.compactMini, true);
  assert.equal(next.writtenConfig.systemPrompt, '优先使用 C++ ACM 模式');
  assert.equal(next.writtenConfig.skipPreCheck, true);
  assert.equal(next.writtenConfig.preferredEndpointId, 'ep-primary');
  assert.equal(next.writtenConfig.simultaneousMode, 'parallel');
  assert.equal(next.writtenConfig.miniFontSize, 64);
  assert.equal(next.writtenConfig.showModelNames, false);

  const reloaded = createWorkbenchPrefs({ file }).getPublic();
  assert.deepEqual(reloaded.writtenConfig, next.writtenConfig);
});

test('multimodal-router supports multimodal follow-up history, custom writtenPrompt, endpointId priority, and latencyMs', async t => {
  const dir = tmpDir(t);
  const promptsDir = path.join(dir, 'defaults');
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const name of ['common.md', 'written.md', 'interview.md', 'auto.md', 'original-vision.md']) {
    fs.writeFileSync(path.join(promptsDir, name), `# ${name}\n默认提示词`);
  }
  const calls = [];
  const fakeSafe = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8')
  };
  const router = createRouter({
    directory: path.join(dir, 'mm'),
    defaultsDirectory: promptsDir,
    safeStorage: fakeSafe,
    transport: async (cfg, messages) => {
      calls.push({ id: cfg.id, model: cfg.model, messages });
      return {
        status: 200,
        body: JSON.stringify({ choices: [{ message: { content: `Answer from ${cfg.model}` }, finish_reason: 'stop' }] })
      };
    }
  });
  router.initialize();
  router.applyPatch({
    enabled: true,
    mode: 'auto',
    simultaneousAnswers: true,
    endpoints: [
      { id: 'ep-1', name: '视觉一', enabled: true, baseUrl: 'http://127.0.0.1:9999/v1', model: 'vision-1', apiKey: 'k1' },
      { id: 'ep-2', name: '视觉二', enabled: true, baseUrl: 'http://127.0.0.1:9999/v1', model: 'vision-2', apiKey: 'k2' }
    ]
  });

  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const msgs = router.buildMessages({
    scene: 'written',
    writtenPrompt: '代码统一使用 C++17',
    history: [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: tinyPng } }, { type: 'text', text: '截图提问' }] },
      { role: 'assistant', content: '答案是 B' }
    ],
    question: '为什么不是 C？'
  }, 'answer');

  assert.match(msgs[0].content, /用户自定义笔试要求/);
  assert.match(msgs[0].content, /代码统一使用 C\+\+17/);
  assert.ok(Array.isArray(msgs[1].content), 'multimodal history image turn should be preserved');
  assert.equal(msgs[1].content[0].type, 'image_url');
  assert.equal(msgs[2].content, '答案是 B');
  assert.equal(msgs[3].content, '为什么不是 C？');

  // Single-model follow-up prioritizing ep-2
  const emitted = [];
  const reply = await router.chat(msgs, new AbortController().signal, () => {}, {
    answerMode: true,
    simultaneousAnswers: false,
    endpointId: 'ep-2',
    onResult: (r) => emitted.push(r)
  });
  assert.equal(reply, 'Answer from vision-2');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'vision-2');
  assert.equal(emitted[0].model, 'vision-2');
  assert.equal(typeof emitted[0].latencyMs, 'number');

  // Parallel fast-recognition mode
  calls.length = 0;
  emitted.length = 0;
  const parReply = await router.chat(msgs, new AbortController().signal, () => {}, {
    answerMode: true,
    simultaneousAnswers: true,
    onResult: (r) => emitted.push(r)
  });
  assert.equal(calls.length, 2);
  assert.match(parReply, /vision-1/);
  assert.match(parReply, /vision-2/);
  assert.ok(emitted.filter(r => r.status === 'done').every(r => typeof r.latencyMs === 'number'));
});

test('sessionModel buildWrittenHistory preserves screenshots and extracts primary model answer', async () => {
  const mod = await import(pathToFileURL(path.resolve(__dirname, '../meeting-copilot/ui/src/core/sessionModel.js')).href);
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let sess = mod.createEmptySession({ name: '笔试', scene: 'written' });
  sess = mod.addQuestionWithAttempt(sess, { requestId: 'r1', prompt: '截图提问', kind: 'shot', images: [tinyPng], forceSelect: true });
  sess = mod.applyLlmEvent(sess, { requestId: 'r1', kind: 'model', result: { id: 'ep1', index: 0, name: '主视觉', model: 'v1', status: 'done', text: 'def solve(): return 42' } });
  sess = mod.applyLlmEvent(sess, { requestId: 'r1', kind: 'model', result: { id: 'ep2', index: 1, name: '备视觉', model: 'v2', status: 'done', text: '42' } });
  sess = mod.applyLlmEvent(sess, { requestId: 'r1', kind: 'done', text: '【主视觉 · v1】\ndef solve(): return 42\n\n【备视觉 · v2】\n42' });

  const history = mod.buildWrittenHistory(sess);
  assert.equal(history.length, 2);
  assert.ok(Array.isArray(history[0].content));
  assert.equal(history[0].content[0].type, 'image_url');
  assert.equal(history[1].content, 'def solve(): return 42');
});

test('V3.2 static invariants: WrittenCompactView reuses GearPopover/CodingPrefsPopover/clickThrough without app-region drag', () => {
  const wf = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/components/WrittenCompactView.jsx'), 'utf8');
  const mainJsx = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/main.jsx'), 'utf8');
  const homeJsx = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/components/HomeView.jsx'), 'utf8');
  const tooltipJs = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/core/globalTooltip.js'), 'utf8');
  const sharedJsx = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/components/SharedWidgets.jsx'), 'utf8');
  const settingsJsx = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/components/SettingsView.jsx'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../meeting-copilot/ui/src/styles/app.css'), 'utf8');
  assert.ok(wf.includes('GearPopover'), 'WrittenCompactView must reuse GearPopover');
  assert.ok(wf.includes('CodingPrefsPopover'), 'WrittenCompactView must reuse CodingPrefsPopover');
  assert.ok(wf.includes('WorkbenchShortcutsModal'), 'WrittenCompactView must reuse WorkbenchShortcutsModal');
  assert.ok(wf.includes('VirtualCursor'), 'WrittenCompactView must reuse VirtualCursor');
  assert.ok(wf.includes('EyeContactToggle'), 'WrittenCompactView topbar must expose EyeContactToggle');
  assert.ok(wf.includes('hideFooterCopy'), 'WrittenCompactView cards must deduplicate bottom copy button via hideFooterCopy');
  assert.ok(wf.includes('startClickThroughPolling'), 'WrittenCompactView must reuse 80ms smart click-through polling');
  assert.equal(wf.includes('WebkitAppRegion'), false, 'WrittenCompactView must use JS pointer drag instead of -webkit-app-region');
  assert.ok(sharedJsx.includes('复制代码') && sharedJsx.includes('mc-code-copy-btn'), 'WrittenAnswerContent must render per-code-block copy button');
  assert.ok(css.includes('--wf-surface-bg') && css.includes('--wf-pill-bg'), 'Written floating window cards and floating pill footer must respect --mc-bg-alpha');
  assert.ok(settingsJsx.includes('recommendedHotkeyFix') && settingsJsx.includes('Control+Alt+A'), 'Settings must default region capture to low-conflict Control+Alt+A and offer 1-click conflict fix');
  assert.ok(mainJsx.includes('installGlobalTooltip'), 'main.jsx must mount SuiSi-style global custom tooltip');
  assert.ok(tooltipJs.includes('data-mc-tooltip') && tooltipJs.includes("removeAttribute('title')"), 'globalTooltip must strip native OS titles');
  assert.equal(homeJsx.includes('先配置回答模型，即可打字提问'), false, 'Home header must not show redundant dark model reminder CTA');
});
