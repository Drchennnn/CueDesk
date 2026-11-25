'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { createTemplatesStore } = require('../meeting-copilot/tools/templates-store.cjs');
const { createWorkbenchPrefs } = require('../meeting-copilot/tools/workbench-prefs.cjs');
const { createWorkbenchWindow, HOME_MIN, WORKBENCH_MIN } = require('../meeting-copilot/tools/workbench-window.cjs');
const { createCaptureService } = require('../meeting-copilot/quiet-capture.cjs');
const { createInterviewLibrary } = require('../meeting-copilot/v2/library.cjs');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-wb-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeScreen(displays, cursorRef) {
  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getDisplayMatching: (rect) => displays.find(d => rect.x >= d.bounds.x && rect.x < d.bounds.x + d.bounds.width) || displays[0],
    getCursorScreenPoint: () => cursorRef.current
  };
}

function fakeWindow() {
  const listeners = new Map();
  let bounds = { x: 100, y: 100, width: 1120, height: 760 };
  let minSize = [380, 440];
  let visible = true;
  let minimized = false;
  let maximized = false;
  let alwaysOnTop = false;
  let focusable = true;
  let skipTaskbar = false;
  let contentProtection = false;
  let ignoreMouse = { ignore: false, forward: false };
  const calls = { ignoreMouse: [], focus: 0, contentProtection: [] };
  return {
    calls,
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isMaximized: () => maximized,
    getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...bounds }),
    setBounds: (b) => { bounds = { ...b }; },
    setMinimumSize: (w, h) => { minSize = [w, h]; },
    getMinimumSize: () => [...minSize],
    setAlwaysOnTop: (on) => { alwaysOnTop = !!on; },
    isAlwaysOnTop: () => alwaysOnTop,
    setFocusable: (f) => { focusable = !!f; },
    isFocusable: () => focusable,
    focus: () => { calls.focus++; },
    setSkipTaskbar: (s) => { skipTaskbar = !!s; },
    getSkipTaskbar: () => skipTaskbar,
    setContentProtection: (on) => { contentProtection = !!on; calls.contentProtection.push(!!on); },
    getContentProtection: () => contentProtection,
    setIgnoreMouseEvents: (ignore, opts) => {
      ignoreMouse = { ignore: !!ignore, forward: !!opts?.forward };
      calls.ignoreMouse.push({ ...ignoreMouse });
    },
    getIgnoreMouse: () => ({ ...ignoreMouse }),
    minimize: () => { minimized = true; emit('minimize'); },
    maximize: () => { maximized = true; emit('maximize'); },
    unmaximize: () => { maximized = false; emit('unmaximize'); },
    hide: () => { visible = false; emit('hide'); },
    show: () => { visible = true; minimized = false; emit('show'); },
    on: (ev, cb) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(cb);
    },
    emit
  };
  function emit(ev, ...args) {
    for (const cb of listeners.get(ev) || []) cb(...args);
  }
}

function fakeShortcuts() {
  const map = new Map();
  return {
    map,
    isRegistered: (k) => map.has(k),
    register: (k, cb) => { map.set(k, cb); return true; },
    unregister: (k) => { map.delete(k); },
    trigger: (k) => map.get(k)?.()
  };
}

test('templates-store seeds defaults, normalizes saves, and recovers from corrupt files', t => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'templates.json');
  const store = createTemplatesStore({ file });
  const seeded = store.load();
  assert.equal(seeded.groups.length, 1);
  assert.equal(seeded.templates.length, 2);
  assert.deepEqual(seeded.templates.map(x => x.audioSource), ['system', 'mic']);

  const saved = store.save({
    groups: [{ id: 'g1', name: '秋招技术面', order: 0 }],
    templates: [{ id: 't1', groupId: 'non-existent', name: '后端二面', audioSource: 'mic', answerLang: 'english', pinned: true }]
  });
  assert.equal(saved.templates[0].groupId, 'g1');
  assert.equal(saved.templates[0].answerLang, 'english');
  assert.equal(store.load().templates[0].name, '后端二面');

  fs.writeFileSync(file, '{corrupt json');
  assert.equal(store.load().templates.length, 2);
});

test('workbench-prefs never boots with clickThrough=true and recovers crashed session security', t => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'workbench-prefs.json');
  fs.writeFileSync(file, JSON.stringify({
    fontSize: 99,
    hoverOpacity: 80,
    clickThrough: true,
    preventFocus: true,
    securityMode: {
      enabled: true,
      scope: 'session',
      autoEnableOnLaunch: false,
      savedPreventFocus: false,
      savedAllowCapture: true
    }
  }));

  const prefs = createWorkbenchPrefs({ file });
  const pub = prefs.getPublic();
  assert.equal(pub.fontSize, 24);
  assert.equal(pub.hoverOpacity, 50);
  assert.equal(pub.clickThrough, false);
  assert.equal(pub.securityMode.enabled, false);
  assert.equal(pub.preventFocus, false);
  assert.deepEqual(prefs.consumeRecoveredSessionSecurity(), { savedPreventFocus: false, savedAllowCapture: true });
});

test('workbench-window switches home/workbench modes, smart click-through, hover polling, displays, and security mode', async t => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'workbench-prefs.json');
  const prefs = createWorkbenchPrefs({ file });
  const displays = [
    { id: 101, scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 680 } },
    { id: 202, scaleFactor: 1, bounds: { x: 1280, y: 0, width: 1920, height: 1080 }, workArea: { x: 1280, y: 0, width: 1920, height: 1040 } }
  ];
  const cursor = { current: { x: 500, y: 300 } };
  const scr = fakeScreen(displays, cursor);
  const shortcuts = fakeShortcuts();
  const win = fakeWindow();
  let stealth = false;
  const hoverEvents = [];

  const wb = createWorkbenchWindow({
    prefs,
    screen: scr,
    shortcuts,
    getStealth: () => stealth,
    setStealth: (on) => { stealth = !!on; win.setContentProtection(stealth); },
    onHoverChange: (inside) => hoverEvents.push(inside),
    listProcesses: async () => ['obs64.exe', 'wemeetapp.exe'],
    pollIntervalMs: 25
  });
  wb.attach(win);
  wb.registerHotkeys();

  // Initial mode is home
  assert.equal(wb.getWindowState().mode, 'home');
  assert.equal(win.isAlwaysOnTop(), false);

  // Switch to workbench
  wb.setMode('workbench');
  assert.deepEqual(win.getMinimumSize(), [...WORKBENCH_MIN]);
  assert.equal(win.isAlwaysOnTop(), true);
  // SuiSi parity: skipTaskbar stays false in normal workbench (only true in security/written-compact mode)
  assert.equal(win.getSkipTaskbar(), false);

  // Smart click-through transitions
  wb.setClickThrough(true);
  assert.deepEqual(win.getIgnoreMouse(), { ignore: true, forward: true });
  assert.equal(win.isFocusable(), false);
  wb.setMouseInteractive(true);
  assert.deepEqual(win.getIgnoreMouse(), { ignore: false, forward: false });
  wb.setMouseInteractive(false);
  assert.deepEqual(win.getIgnoreMouse(), { ignore: true, forward: true });
  // Turning off alwaysOnTop automatically disables clickThrough so window cannot get trapped behind other apps
  wb.setAlwaysOnTop(false);
  assert.equal(wb.getWindowState().clickThrough, false);
  assert.deepEqual(win.getIgnoreMouse(), { ignore: false, forward: false });
  wb.setAlwaysOnTop(true);

  // Global hotkey Ctrl+Shift+9 turns click-through on and off
  shortcuts.trigger('Control+Shift+9');
  assert.equal(wb.getWindowState().clickThrough, true);
  shortcuts.trigger('Control+Shift+9');
  assert.equal(wb.getWindowState().clickThrough, false);
  assert.deepEqual(win.getIgnoreMouse(), { ignore: false, forward: false });

  // Prevent focus + temp focus restores on blur; Home mode ALWAYS remains focusable!
  wb.setPreventFocus(true);
  assert.equal(win.isFocusable(), false);
  assert.equal(win.isAlwaysOnTop(), true);
  wb.requestTempFocus(true);
  assert.equal(win.isFocusable(), true);
  assert.equal(win.calls.focus, 1);
  win.emit('blur');
  assert.equal(win.isFocusable(), false);
  wb.setMode('home');
  assert.equal(win.isFocusable(), true, 'Home mode must ALWAYS stay focusable even when preventFocus pref is true');
  wb.setMode('workbench');
  assert.equal(win.isFocusable(), false);
  wb.setPreventFocus(false);
  assert.equal(win.isFocusable(), true);

  // Security mode truth table: locks allowCapture=false & preventFocus=true, restores on disable
  wb.enableSecurity({ scope: 'session' });
  assert.equal(stealth, true);
  assert.equal(win.isFocusable(), false);
  assert.throws(() => wb.setAllowCapture(true), /安全模式已开启/);
  assert.throws(() => wb.setPreventFocus(false), /安全模式已开启/);

  // Read-only environment check does NOT mutate stealth state and detects OBS
  const env = await wb.checkEnvironment();
  assert.equal(env.contentProtectionSupported, true);
  assert.equal(env.contentProtectionActive, true);
  assert.deepEqual(env.screenRecorders, ['obs64.exe']);
  assert.deepEqual(env.meetingApps, ['wemeetapp.exe']);
  assert.equal(stealth, true);

  wb.disableSecurity({ scope: 'session' });
  assert.equal(stealth, false);
  assert.equal(win.isFocusable(), true);

  // Persistent security survives session-scoped disable
  wb.enableSecurity({ scope: 'persistent' });
  wb.disableSecurity({ scope: 'session' });
  assert.equal(wb.getWindowState().securityMode.enabled, true);
  wb.disableSecurity({ scope: 'persistent' });
  assert.equal(wb.getWindowState().securityMode.enabled, false);

  // Display rect resolution & fallback
  const list = wb.getDisplays();
  assert.equal(list.length, 2);
  assert.deepEqual(wb.resolveCaptureRect('101').rect, { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(wb.resolveCaptureRect('202').rect, { x: 1280, y: 0, width: 1920, height: 1080 });
  assert.equal(wb.resolveCaptureRect('missing-display').fallback, true);
  assert.equal(wb.resolveCaptureRect('missing-display').rect, null);

  // Hover polling fires on outside transition, engages native passthrough, and respects setHoverBlocked
  prefs.applyPatch({ hoverReveal: true });
  wb.syncHoverPolling();
  cursor.current = { x: 9999, y: 9999 };
  await new Promise(r => setTimeout(r, 70));
  assert.ok(hoverEvents.includes(false));
  assert.deepEqual(win.getIgnoreMouse(), { ignore: true, forward: true }, 'hoverReveal hidden state must pass clicks through');
  wb.setHoverBlocked(true);
  assert.deepEqual(win.getIgnoreMouse(), { ignore: false, forward: false }, 'hoverBlocked restores interactivity immediately');
  wb.setHoverBlocked(false);

  // Cursor-in-content DIP coordinate helper + JS drag
  win.getContentBounds = () => ({ x: 100, y: 100, width: 920, height: 464 });
  win.webContents = { getZoomFactor: () => 1.25 };
  cursor.current = { x: 225, y: 150 };
  const pt = wb.getCursorInContent();
  assert.deepEqual(pt, { x: 100, y: 40, inside: true });
  const beforeDrag = win.getBounds();
  assert.equal(wb.beginDrag(300, 200), true);
  assert.equal(wb.dragTo(350, 230), true);
  assert.equal(win.getBounds().x, beforeDrag.x + 50);
  assert.equal(win.getBounds().y, beforeDrag.y + 30);
  wb.endDrag();

  // Workbench editable hotkeys + Mouse4/5 bindings + conflict rollback
  wb.setWorkbenchHotkeys({ bindings: { questionPrev: 'Control+Alt+1', toggleHoverReveal: 'Mouse4' } });
  assert.equal(wb.getWindowState().workbenchHotkeys.questionPrev, 'Control+Alt+1');
  assert.deepEqual(wb.getMouseBindings(), [{ action: 'toggleHoverReveal', key: 'Mouse4' }]);
  assert.throws(() => wb.setWorkbenchHotkeys({ bindings: { questionNext: 'Control+Alt+1' } }), /重复/);
  wb.resetWorkbenchHotkeys();
  assert.equal(wb.getWindowState().workbenchHotkeys.questionPrev, '');
  assert.equal(wb.getWindowState().workbenchHotkeys.toggleClickThrough, 'Control+Shift+9');

  wb.setMode('home');
  assert.deepEqual(win.getMinimumSize(), [...HOME_MIN]);
  assert.equal(win.isAlwaysOnTop(), false);
  wb.dispose();
});

test('v2 library readDocument reads files inside root and rejects invalid ids', async t => {
  const dir = tmpDir(t);
  const libRoot = path.join(dir, 'kb');
  fs.mkdirSync(path.join(libRoot, '项目资料'), { recursive: true });
  fs.writeFileSync(path.join(libRoot, '项目资料', '架构笔记.md'), '# 架构设计\n使用 Redis 与本地缓存二级分层。');
  const lib = createInterviewLibrary({ file: path.join(dir, 'interview-library.json') });
  const pub = await lib.save({ enabled: true, root: libRoot, role: '' });
  assert.ok(pub.documents.length >= 1);
  const doc = pub.documents[0];
  assert.ok(doc.file_path);
  const loaded = await lib.readDocument({ document_id: doc.document_id });
  assert.match(loaded.content, /二级分层/);
  await assert.rejects(() => lib.readDocument({ document_id: 'missing-doc' }), /未找到可用文档/);
});

test('written-window does not hijack alwaysOnTop or focusable when disabled', t => {
  const { createWrittenWindow } = require('../meeting-copilot/written-window.cjs');
  const dir = tmpDir(t);
  const scr = { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) };
  const host = createWrittenWindow({ file: path.join(dir, 'written.json'), screen: scr });
  const win = fakeWindow();
  win.setAlwaysOnTop(false);
  win.setSkipTaskbar(false);
  host.attach(win);
  win.emit('show');
  win.emit('blur');
  assert.equal(win.isAlwaysOnTop(), false, 'disabled written-window must not force alwaysOnTop on Home');
  assert.equal(win.getSkipTaskbar(), false, 'disabled written-window must not force skipTaskbar on Home');
  win.emit('closed');
});

test('quiet-capture passes --capture-rect when display rect is supplied', async t => {
  const dir = tmpDir(t);
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const svc = createCaptureService({
    helperPath: 'QuietCapture.exe',
    tempRoot: dir,
    execFile: (exe, args, opts, cb) => {
      calls.push({ exe, args, opts });
      const outPath = args[args.length - 1];
      setImmediate(() => { fs.writeFileSync(outPath, png); cb(null); });
      return { kill: () => {} };
    }
  });
  const dataUrl = await svc.capture('full', { x: 1920, y: 0, width: 2560, height: 1440 });
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
  assert.equal(calls[0].args[0], '--capture-rect');
  assert.equal(calls[0].args[1], '1920,0,2560,1440');
});

test('v2 library honors request-level libraryOverride without mutating global config', async t => {
  const dir = tmpDir(t);
  const libRoot = path.join(dir, 'kb');
  fs.mkdirSync(path.join(libRoot, '岗位档案', '后端开发'), { recursive: true });
  fs.mkdirSync(path.join(libRoot, '岗位档案', '前端开发'), { recursive: true });
  fs.writeFileSync(path.join(libRoot, '岗位档案', '后端开发', '简历.md'), '# 后端简历\n我负责过分布式限流网关优化，P99 从 120ms 降到 28ms。');
  fs.writeFileSync(path.join(libRoot, '岗位档案', '前端开发', '简历.md'), '# 前端简历\n我负责过微前端架构拆包，首屏加载时间缩短 45%。');
  const lib = createInterviewLibrary({ file: path.join(dir, 'interview-library.json') });
  await lib.save({ enabled: true, root: libRoot, role: '后端开发' });

  // Override enabled=false for one request
  const disabledMsgs = await lib.build({
    question: '讲讲你的限流网关项目',
    libraryOverride: { enabled: false }
  }, [{ role: 'user', content: 'fallback' }]);
  assert.equal(disabledMsgs.evidence.length, 0);

  // Override role for one request without mutating global config
  await lib.build({
    question: '介绍一下你的简历背景',
    libraryOverride: { role: '前端开发' }
  }, []);
  const pub = await lib.getPublic();
  assert.equal(pub.enabled, true);
  assert.equal(pub.role, '后端开发');
  assert.equal(pub.last.role, '前端开发');
});

test('patch_baseline.py patches baseline main and preload cleanly with valid JS syntax', t => {
  const baselineAsar = path.resolve(__dirname, '../releases/MeetingCopilot/app/resources/app.asar');
  if (!fs.existsSync(baselineAsar)) {
    t.skip('Read-only baseline releases/MeetingCopilot/app/resources/app.asar not present');
    return;
  }
  const dir = tmpDir(t);
  const mainOut = path.join(dir, 'main.cjs');
  const preloadOut = path.join(dir, 'preload.cjs');
  const pyCode = `
import importlib.util
from pathlib import Path
spec_pb = importlib.util.spec_from_file_location("pb", r"${path.resolve(__dirname, '../meeting-copilot/release/patch_baseline.py').replace(/\\/g, '\\\\')}")
pb = importlib.util.module_from_spec(spec_pb)
spec_pb.loader.exec_module(pb)
spec_asar = importlib.util.spec_from_file_location("asar_util", r"${path.resolve(__dirname, '../meeting-copilot/release/asar_util.py').replace(/\\/g, '\\\\')}")
asar_util = importlib.util.module_from_spec(spec_asar)
spec_asar.loader.exec_module(asar_util)
raw = Path(r"${baselineAsar.replace(/\\/g, '\\\\')}").read_bytes()
header, offset = asar_util.read_header(raw)
Path(r"${mainOut.replace(/\\/g, '\\\\')}").write_bytes(pb.patch_main(asar_util.read_member(raw, header, offset, "out/main/index.js")))
Path(r"${preloadOut.replace(/\\/g, '\\\\')}").write_bytes(pb.patch_preload(asar_util.read_member(raw, header, offset, "out/preload/index.js")))
`;
  cp.execFileSync('python', ['-c', pyCode], { stdio: 'pipe' });
  cp.execFileSync('node', ['--check', mainOut], { stdio: 'pipe' });
  cp.execFileSync('node', ['--check', preloadOut], { stdio: 'pipe' });

  const mainText = fs.readFileSync(mainOut, 'utf8');
  const preloadText = fs.readFileSync(preloadOut, 'utf8');
  assert.match(mainText, /sessions:save-sync/);
  assert.match(mainText, /interview-library:pick-root/);
  assert.match(mainText, /win:set-mode/);
  assert.match(mainText, /security:check-env/);
  assert.match(mainText, /appendCodingDirective/);
  assert.match(preloadText, /saveSessionsSync/);
  assert.match(preloadText, /setMouseInteractive/);
  assert.match(preloadText, /checkSecurityEnvironment/);
});
