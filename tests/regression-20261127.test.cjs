'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { createWorkbenchPrefs } = require('../cuedesk/tools/workbench-prefs.cjs');
const { createWorkbenchWindow } = require('../cuedesk/tools/workbench-window.cjs');
const { createMemoryStore } = require('../cuedesk/tools/memory-store.cjs');
const { createInterviewLibrary } = require('../cuedesk/v2/library.cjs');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuedesk-reg-20261127-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeFakeWin(initialBounds = { x: 100, y: 80, width: 1408, height: 941 }, opts = {}) {
  let bounds = { ...initialBounds };
  let normalBounds = { ...initialBounds };
  let maximized = false;
  let minimized = false;
  let visible = true;
  let focusable = true;
  let focused = true;
  let alwaysOnTop = false;
  let skipTaskbar = false;
  let ignoreMouse = false;
  const listeners = new Map();
  const counts = { setSkipTaskbar: 0, setFocusable: 0, showInactive: 0, show: 0, moveTop: 0, setAlwaysOnTop: 0 };

  const emit = (ev, ...args) => {
    for (const fn of listeners.get(ev) || []) fn(...args);
  };

  return {
    counts,
    on: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    emit,
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isMaximized: () => maximized,
    isFocusable: () => focusable,
    isFocused: () => focused,
    isAlwaysOnTop: () => alwaysOnTop,
    getBounds: () => ({ ...bounds }),
    getNormalBounds: () => ({ ...normalBounds }),
    setMinimumSize: () => {},
    setBounds: (b) => {
      if (opts.dpiSetBoundsBiasW || opts.dpiSetBoundsBiasH) {
        // Simulate real Windows 125% Electron frameless transparent setBounds upward DIP bias
        const biasW = opts.dpiSetBoundsBiasW || 0;
        const biasH = opts.dpiSetBoundsBiasH || 0;
        bounds = { ...b, width: b.width + biasW, height: b.height + biasH };
      } else {
        bounds = { ...b };
      }
      if (!maximized) normalBounds = { ...bounds };
    },
    setAlwaysOnTop: (on) => { counts.setAlwaysOnTop += 1; alwaysOnTop = !!on; },
    setSkipTaskbar: (skip) => { counts.setSkipTaskbar += 1; skipTaskbar = !!skip; },
    getSkipTaskbar: () => skipTaskbar,
    setContentProtection: () => {},
    setIgnoreMouseEvents: (ig) => { ignoreMouse = !!ig; },
    getIgnoreMouseEvents: () => ignoreMouse,
    blur: () => { focused = false; emit('blur'); },
    focus: () => { focused = true; },
    setFocusable: (f) => {
      counts.setFocusable += 1;
      focusable = !!f;
      if (!f) focused = false;
      if (opts.hideOnNonFocusable && !f) {
        visible = false;
      }
    },
    maximize: () => {
      maximized = true;
      bounds = { x: 0, y: 0, width: 1920, height: 1020 };
      emit('maximize');
    },
    unmaximize: () => {
      maximized = false;
      // Simulate Windows 125% fractional DPI upward rounding drift on native unmaximize
      const driftW = opts.dpiDriftW || 0;
      const driftH = opts.dpiDriftH || 0;
      normalBounds = {
        x: normalBounds.x,
        y: normalBounds.y,
        width: normalBounds.width + driftW,
        height: normalBounds.height + driftH
      };
      bounds = { ...normalBounds };
      emit('resize');
      emit('unmaximize');
    },
    minimize: () => { minimized = true; emit('minimize'); },
    restore: () => { minimized = false; visible = true; emit('restore'); },
    show: () => { counts.show += 1; visible = true; minimized = false; emit('show'); },
    showInactive: () => { counts.showInactive += 1; visible = true; minimized = false; },
    moveTop: () => { counts.moveTop += 1; },
    webContents: { getZoomFactor: () => 1 }
  };
}

function fakeScreen() {
  const disp = {
    id: 1,
    scaleFactor: 1.25,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1020 }
  };
  return {
    getPrimaryDisplay: () => disp,
    getDisplayMatching: () => disp,
    getAllDisplays: () => [disp],
    getCursorScreenPoint: () => ({ x: 300, y: 300 })
  };
}

test('P0: setSkipTaskbar is idempotent, visibility drops self-heal, and recoverWindow restores cleanly', (t) => {
  const dir = tmpDir(t);
  const prefs = createWorkbenchPrefs({ file: path.join(dir, 'prefs.json') });
  const win = makeFakeWin({ x: 100, y: 80, width: 1120, height: 760 }, { hideOnNonFocusable: true });
  const traceLogPath = path.join(dir, 'window-trace.log');
  let stealth = false;
  const wb = createWorkbenchWindow({
    prefs,
    screen: fakeScreen(),
    shortcuts: { register: () => true, unregister: () => {}, isRegistered: () => false },
    getStealth: () => stealth,
    setStealth: (v) => { stealth = !!v; },
    traceLogPath
  });

  wb.attach(win);
  wb.enableSecurity({ scope: 'persistent' });
  const skipCallsAfterEnable = win.counts.setSkipTaskbar;

  // Entering workbench triggers setFocusable(false) -> simulated Win32 hide -> must self-heal immediately!
  wb.setMode('workbench');
  assert.equal(win.isVisible(), true, 'visibility drop on WS_EX_NOACTIVATE transition must self-heal');
  assert.ok(win.counts.showInactive >= 1, 'showInactive should be called to self-heal');
  assert.equal(win.counts.setSkipTaskbar, skipCallsAfterEnable, 'unchanged skipTaskbar must NOT be called again');

  // Repeated blur / tempFocus roundtrips must not spam setSkipTaskbar(true)
  wb.requestTempFocus(true);
  win.emit('blur');
  wb.requestTempFocus(true);
  win.emit('blur');
  assert.equal(win.counts.setSkipTaskbar, skipCallsAfterEnable, 'tempFocus/blur cycles must not redundantly call setSkipTaskbar');

  // Simulate hidden / click-through stuck window -> recoverWindow() rescues without losing mode
  wb.setClickThrough(true);
  assert.equal(wb.getWindowState().clickThrough, true);
  const st = wb.recoverWindow();
  assert.equal(st.clickThrough, false);
  assert.equal(win.getIgnoreMouseEvents(), false);
  assert.equal(win.isVisible(), true);
  assert.ok(wb.getTrace().some(e => e.event === 'visibility_self_healed'));
  assert.ok(wb.getTrace().some(e => e.event === 'recover_window'));
  assert.ok(fs.existsSync(traceLogPath));

  // Emergency exit security via tray recovery
  const exited = wb.recoverWindow({ exitSecurity: true });
  assert.equal(exited.securityMode.enabled, false);
  assert.equal(win.isFocusable(), true);
  wb.dispose();
});

test('P1-1: persistent home security mode is NEVER downgraded or turned off when a session ends', (t) => {
  const dir = tmpDir(t);
  const prefs = createWorkbenchPrefs({ file: path.join(dir, 'prefs.json') });
  const win = makeFakeWin();
  let stealth = false;
  const wb = createWorkbenchWindow({
    prefs,
    screen: fakeScreen(),
    shortcuts: { register: () => true, unregister: () => {}, isRegistered: () => false },
    getStealth: () => stealth,
    setStealth: (v) => { stealth = !!v; }
  });
  wb.attach(win);

  // Case 1: Global persistent ON -> session tries enableSecurity({scope:'session'}) -> session ends disableSecurity({scope:'session'})
  wb.enableSecurity({ scope: 'persistent' });
  assert.equal(wb.getWindowState().securityMode.scope, 'persistent');
  wb.enableSecurity({ scope: 'session' });
  assert.equal(wb.getWindowState().securityMode.scope, 'persistent', 'session call must not downgrade persistent scope');
  wb.setMode('workbench');
  wb.disableSecurity({ scope: 'session' });
  wb.setMode('home');
  assert.equal(wb.getWindowState().securityMode.enabled, true, 'persistent security must stay ON after session close');
  assert.equal(wb.getWindowState().securityMode.scope, 'persistent');

  // Case 2: Global OFF -> session-only ON -> session ends -> turns OFF
  wb.disableSecurity({ scope: 'persistent', clearAutoLaunch: true });
  assert.equal(wb.getWindowState().securityMode.enabled, false);
  wb.enableSecurity({ scope: 'session' });
  assert.equal(wb.getWindowState().securityMode.enabled, true);
  assert.equal(wb.getWindowState().securityMode.scope, 'session');
  wb.disableSecurity({ scope: 'session' });
  assert.equal(wb.getWindowState().securityMode.enabled, false);

  // Case 3: Global OFF -> session ends -> stays OFF
  wb.disableSecurity({ scope: 'session' });
  assert.equal(wb.getWindowState().securityMode.enabled, false);
  wb.dispose();
});

test('P1-2: imperative SQL task right after self-intro never returns intro script, while 30s follow-up still hits intro', async (t) => {
  const dir = tmpDir(t);
  const kbRoot = path.join(dir, 'kb');
  fs.mkdirSync(path.join(kbRoot, '通用问答'), { recursive: true });
  fs.writeFileSync(
    path.join(kbRoot, '通用问答', '自我介绍.md'),
    '# 自我介绍\n\n## 约2分钟\n你好，我是测试候选人，这是两分钟自我介绍原稿。\n\n## 约30秒\n你好，我是测试候选人，这是三十秒精简自我介绍。\n',
    'utf8'
  );
  const lib = createInterviewLibrary({ file: path.join(dir, 'library.json') });
  const saved = await lib.save({ enabled: true, root: kbRoot, role: '' });
  const introDoc = saved.documents.find(d => d.file_path.endsWith('自我介绍.md'));
  assert.ok(introDoc);
  await lib.save({
    enabled: true,
    root: kbRoot,
    role: '',
    intro_script: { enabled: true, document_id: introDoc.document_id, heading: '约2分钟' }
  });

  const sqlQ = '写一条 SQL，按 user_id 分组，统计 created_at 在过去七天的记录数。';

  // Turn 1: SQL
  const r1 = await lib.build({ sessionId: 's1', mode: 'free', freeQuestion: sqlQ }, []);
  assert.ok(!r1.directAnswer, 'Turn 1 SQL must go through LLM, not direct intro');
  assert.ok(r1.some(m => m.content.includes('user_id') && m.content.includes('created_at')));

  // Turn 2: Self intro
  const r2 = await lib.build({ sessionId: 's1', mode: 'free', freeQuestion: '请做一个自我介绍', dialogueState: r1.dialogueState }, []);
  assert.match(r2.directAnswer || '', /两分钟自我介绍原稿/);

  // Turn 3: Same SQL right after self intro (repro of 17:01 regression!)
  const r3 = await lib.build({ sessionId: 's1', mode: 'free', freeQuestion: sqlQ, dialogueState: r2.dialogueState }, []);
  assert.ok(!r3.directAnswer, 'Turn 3 SQL after self-intro must NOT return self-intro script');
  assert.equal(r3.dialogueState.intents.includes('intro'), false, 'Turn 3 must not inherit intro intent');
  assert.ok(r3.some(m => m.content.includes('user_id') && m.content.includes('created_at')), 'Turn 3 prompt must preserve user_id and created_at');

  // Turn 4: Genuine intro follow-up ("再缩短到 30 秒") right after intro still works!
  const r4 = await lib.build({ sessionId: 's1', mode: 'free', freeQuestion: '再缩短到 30 秒', dialogueState: r2.dialogueState }, []);
  assert.match(r4.directAnswer || '', /三十秒精简自我介绍/);
});

test('P1-3: archiving two distinct sessions on same role/date/round creates independent folders without overwriting', (t) => {
  const dir = tmpDir(t);
  const kbRoot = path.join(dir, 'kb');
  fs.mkdirSync(path.join(kbRoot, '岗位档案', '测试公司-测开'), { recursive: true });
  const store = createMemoryStore({
    getRoot: () => kbRoot,
    snapshotDir: path.join(dir, 'snaps')
  });

  const ts = new Date('2026-11-27T16:00:00+08:00').getTime();
  const sessA = {
    id: 'sess-alpha',
    name: '场次 A',
    audioSource: 'system',
    createdAt: ts,
    updatedAt: ts,
    segments: [{ id: 1, speaker: 'them', text: '这是会话 A 的专属问题', startTs: ts, endTs: ts }],
    questions: []
  };
  const sessB = {
    id: 'sess-beta',
    name: '场次 B',
    audioSource: 'system',
    createdAt: ts + 60000,
    updatedAt: ts + 60000,
    segments: [{ id: 1, speaker: 'them', text: '这是会话 B 的专属问题', startTs: ts, endTs: ts }],
    questions: []
  };

  const resA = store.archiveSessionToRole({ session: sessA, roleDirectory: '测试公司-测开', roundLabel: '一面' });
  assert.equal(resA.updated, false);
  assert.equal(resA.collisionResolved, false);
  assert.equal(resA.roundFolder, '2026-11-27-一面');

  const resB = store.archiveSessionToRole({ session: sessB, roleDirectory: '测试公司-测开', roundLabel: '一面' });
  assert.equal(resB.updated, false);
  assert.equal(resB.collisionResolved, true);
  assert.equal(resB.roundFolder, '2026-11-27-一面-2');
  assert.notEqual(resA.archiveDir, resB.archiveDir);

  const mdA = fs.readFileSync(resA.rawMdPath, 'utf8');
  const mdB = fs.readFileSync(resB.rawMdPath, 'utf8');
  assert.match(mdA, /会话 A 的专属问题/);
  assert.doesNotMatch(mdA, /会话 B 的专属问题/);
  assert.match(mdB, /会话 B 的专属问题/);
  assert.doesNotMatch(mdB, /会话 A 的专属问题/);

  // Re-archiving session B updates its own folder cleanly without touching A or creating -3
  const resB2 = store.archiveSessionToRole({
    session: { ...sessB, segments: [{ id: 1, speaker: 'them', text: '会话 B 更新版', startTs: ts, endTs: ts }] },
    roleDirectory: '测试公司-测开',
    roundLabel: '一面'
  });
  assert.equal(resB2.updated, true);
  assert.equal(resB2.roundFolder, '2026-11-27-一面-2');
  assert.match(fs.readFileSync(resB2.rawMdPath, 'utf8'), /会话 B 更新版/);
  assert.match(fs.readFileSync(resA.rawMdPath, 'utf8'), /会话 A 的专属问题/);
});

test('P2-1: 10 maximize/restore cycles under 125% fractional DPI drift AND setBounds upward bias return to exact starting bounds', (t) => {
  const dir = tmpDir(t);
  const prefs = createWorkbenchPrefs({ file: path.join(dir, 'prefs.json') });
  // Matches real-machine trace: start 1154x775 DIP; native unmaximize drifts +1..+2 and setBounds itself inflates +2/+1 DIP!
  const startBounds = { x: 147, y: 44, width: 1154, height: 775 };
  const win = makeFakeWin(startBounds, { dpiDriftW: 2, dpiDriftH: 1, dpiSetBoundsBiasW: 2, dpiSetBoundsBiasH: 1 });
  const wb = createWorkbenchWindow({
    prefs,
    screen: fakeScreen(),
    shortcuts: { register: () => true, unregister: () => {}, isRegistered: () => false }
  });
  wb.attach(win);

  for (let i = 0; i < 10; i++) {
    assert.equal(wb.toggleMaximize(), true, `cycle ${i + 1} maximize`);
    assert.equal(wb.toggleMaximize(), false, `cycle ${i + 1} restore`);
    assert.deepEqual(win.getBounds(), startBounds, `cycle ${i + 1} must cancel fractional-DPI setBounds bias with zero cumulative growth`);
  }
  wb.dispose();
});

test('P0-R2: security mode locks alwaysOnTop without corrupting prefs, and hide/show trace records exact trigger source', (t) => {
  const dir = tmpDir(t);
  const prefs = createWorkbenchPrefs({ file: path.join(dir, 'prefs.json') });
  const win = makeFakeWin({ x: 147, y: 44, width: 1154, height: 775 });
  let stealth = false;
  const wb = createWorkbenchWindow({
    prefs,
    screen: fakeScreen(),
    shortcuts: { register: () => true, unregister: () => {}, isRegistered: () => false },
    getStealth: () => stealth,
    setStealth: (v) => { stealth = !!v; }
  });
  wb.attach(win);
  wb.setAlwaysOnTop(true);
  wb.enableSecurity({ scope: 'persistent' });
  wb.setMode('workbench');

  // Pin unlock attempt in security mode must reject cleanly without corrupting saved alwaysOnTop pref
  assert.throws(() => wb.setAlwaysOnTop(false), /窗口置顶已锁定/);
  assert.equal(prefs.getPublic().alwaysOnTop, true);
  assert.equal(wb.getWindowState().alwaysOnTop, true);

  // Explicit hide source is attached to win_hide trace event
  wb.recordHideRequest('hotkey_toggle');
  win.emit('hide');
  const lastHide1 = wb.getTrace().filter(e => e.event === 'win_hide').at(-1);
  assert.equal(lastHide1.source, 'hotkey_toggle');

  // Unattributed external hide is clearly tagged external_or_os
  win.emit('hide');
  const lastHide2 = wb.getTrace().filter(e => e.event === 'win_hide').at(-1);
  assert.equal(lastHide2.source, 'external_or_os');

  // Recover via Ctrl+B tags show & recover_window with hotkey_toggle
  wb.recoverWindow({ source: 'hotkey_toggle' });
  const lastRecover = wb.getTrace().filter(e => e.event === 'recover_window').at(-1);
  assert.equal(lastRecover.source, 'hotkey_toggle');

  // After exiting security mode, alwaysOnTop can be toggled off normally
  wb.disableSecurity({ scope: 'persistent', clearAutoLaunch: true });
  const stAfter = wb.setAlwaysOnTop(false);
  assert.equal(stAfter.alwaysOnTop, false);
  wb.dispose();
});

test('P3-R2: RecordsView isolates date-group expansion keys per navSection (interview-records vs written-records)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../cuedesk/ui/src/components/RecordsView.jsx'), 'utf8');
  assert.match(src, /const groupStateKey = `\$\{navSection\}:\$\{grp\.key\}`;/);
  assert.match(src, /expandedDateGroups\[groupStateKey\]/);
  assert.match(src, /<details key=\{groupStateKey\}/);
});

test('P0-R3 & P2-R3: winNative repairs Chrome_RenderWidgetHostHWND on Ctrl+B recover, preserves dragged 1382x922 / 1410x940 physical rect, and keeps Home width stable across 10 workbench roundtrips', (t) => {
  const dir = tmpDir(t);
  const prefs = createWorkbenchPrefs({ file: path.join(dir, 'prefs.json') });
  let physRect = { x: 184, y: 50, width: 1462, height: 970 };
  let rwhVisible = true;
  let ensureCalls = 0;
  let lastEnsureOpts = null;

  // Fake window that models Windows 125% fractional DPI:
  // - integer DIP getBounds/setBounds CANNOT represent 922px (922/1.25=737.6 -> 738 DIP -> 923px)
  // - raw setBounds inflates width by +2px on every Home <-> Workbench return
  // - hide() clears Chrome_RenderWidgetHostHWND visibility; showInactive() leaves it hidden!
  const win = makeFakeWin({ x: 147, y: 40, width: 1170, height: 776 }, { dpiDriftW: 2, dpiDriftH: 1, dpiSetBoundsBiasW: 2, dpiSetBoundsBiasH: 1 });
  const origHide = win.hide;
  win.hide = () => { rwhVisible = false; win.emit('hide'); if (origHide) origHide(); };
  const origShowInactive = win.showInactive;
  win.showInactive = () => { origShowInactive(); win.emit('show'); };
  const origSetBounds = win.setBounds;
  win.setBounds = (b) => {
    origSetBounds(b);
    // Simulate integer DIP -> 1.25x physical rounding (cannot represent 922px, rounds to 923px!)
    physRect = {
      x: Math.round(b.x * 1.25),
      y: Math.round(b.y * 1.25),
      width: Math.round((b.width + 2) * 1.25),
      height: Math.round((b.height + 1) * 1.25)
    };
  };

  const winNative = {
    isAvailable: () => true,
    ensureRenderVisible: (_w, opts) => {
      ensureCalls += 1;
      lastEnsureOpts = opts || null;
      const repaired = rwhVisible ? 0 : 1;
      rwhVisible = true;
      return { found: 1, repaired, visible: true, topmost: !!opts?.raiseTopmost };
    },
    getPhysicalRect: () => ({ ...physRect }),
    setPhysicalRect: (_w, rect) => {
      physRect = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      return { ...physRect };
    }
  };

  let stealth = false;
  const wb = createWorkbenchWindow({
    prefs,
    screen: fakeScreen(),
    shortcuts: { register: () => true, unregister: () => {}, isRegistered: () => false },
    getStealth: () => stealth,
    setStealth: (v) => { stealth = !!v; },
    winNative
  });
  wb.attach(win);

  // 1) P0-R3 & P0-R4: Security mode Ctrl+B hide -> recover must:
  //    a) repair Chrome_RenderWidgetHostHWND to visible=true with raiseTopmost=true (single deduplicated call)
  //    b) NEVER call redundant setFocusable(false), setSkipTaskbar(true), setAlwaysOnTop(), or moveTop()
  //       which would invoke Chromium HWNDMessageHandler::Deactivate() and steal foreground focus from external editors!
  wb.enableSecurity({ scope: 'persistent' });
  wb.setMode('workbench');
  const beforeRecoverCounts = { ...win.counts };
  const beforeEnsureCalls = ensureCalls;
  wb.recordHideRequest('hotkey_toggle');
  win.hide();
  assert.equal(rwhVisible, false, 'simulated hide clears Chrome_RenderWidgetHostHWND WS_VISIBLE');
  wb.recoverWindow({ source: 'hotkey_toggle' });
  assert.equal(rwhVisible, true, 'recoverWindow must repair Chrome_RenderWidgetHostHWND visibility via winNative');
  assert.equal(ensureCalls - beforeEnsureCalls, 1, 'ensureRenderVisible must fire once (not duplicated by win.on(show))');
  assert.equal(lastEnsureOpts?.raiseTopmost, true, 'non-focusable recover delegates topmost raise to SWP_NOACTIVATE helper');
  assert.equal(win.counts.setFocusable, beforeRecoverCounts.setFocusable, 'must NEVER redundantly call setFocusable(false) -> Deactivate() on recover');
  assert.equal(win.counts.setSkipTaskbar, beforeRecoverCounts.setSkipTaskbar, 'must NEVER redundantly call setSkipTaskbar(true) on recover');
  assert.equal(win.counts.moveTop, beforeRecoverCounts.moveTop, 'must NEVER call moveTop() during non-focusable recover');
  assert.equal(win.counts.setAlwaysOnTop, beforeRecoverCounts.setAlwaysOnTop, 'must NEVER redundantly call setAlwaysOnTop() when already topmost');
  assert.ok(wb.getTrace().some(e => e.event === 'ensure_render_visible' && e.repaired === 1));

  // 2) P2-B: 10 Home <-> Workbench roundtrips must keep Home exact physical pixels 1462x970 with 0px growth!
  wb.disableSecurity({ scope: 'persistent', clearAutoLaunch: true });
  wb.setMode('home');
  assert.deepEqual(physRect, { x: 184, y: 50, width: 1462, height: 970 });
  for (let i = 0; i < 10; i++) {
    wb.setMode('workbench');
    wb.setMode('home');
    assert.deepEqual(physRect, { x: 184, y: 50, width: 1462, height: 970 }, `roundtrip ${i + 1} must not widen Home`);
  }

  // 3) P2-A: Manually dragged non-multiple-of-1.25 sizes (1382x922, 1410x940, 1401x943) restore with 0px error across 10 cycles!
  for (const dragged of [
    { x: 184, y: 50, width: 1382, height: 922 },
    { x: 184, y: 50, width: 1401, height: 943 },
    { x: 184, y: 50, width: 1410, height: 940 }
  ]) {
    physRect = { ...dragged };
    for (let i = 0; i < 10; i++) {
      assert.equal(wb.toggleMaximize(), true);
      assert.equal(wb.toggleMaximize(), false);
      assert.deepEqual(physRect, dragged, `dragged ${dragged.width}x${dragged.height} cycle ${i + 1} must restore with 0px error`);
    }
  }
  wb.dispose();
});

test('P2-2: icon_util.py builds valid CueDesk VS_VERSION_INFO and patch_baseline.py enables Win32 tray + AppUserModelId', (t) => {
  const iconUtilPath = path.resolve(__dirname, '../cuedesk/release/icon_util.py').replace(/\\/g, '\\\\');
  const out = cp.execFileSync('python', [
    '-c',
    `import importlib.util; s=importlib.util.spec_from_file_location('iu', r'${iconUtilPath}'); iu=importlib.util.module_from_spec(s); s.loader.exec_module(iu); b=iu.build_vs_version_info(); txt=b.decode('utf-16-le', errors='ignore'); assert 'CueDesk' in txt and 'CueDesk.exe' in txt and 'MeetingCopilot' not in txt; print(len(b))`
  ], { encoding: 'utf8' });
  assert.ok(Number(out.trim()) > 200);

  const baselineAsar = path.resolve(__dirname, '../releases/MeetingCopilot/app/resources/app.asar');
  if (!fs.existsSync(baselineAsar)) return;
  const pbPath = path.resolve(__dirname, '../cuedesk/release/patch_baseline.py').replace(/\\/g, '\\\\');
  const asarPath = path.resolve(__dirname, '../cuedesk/release/asar_util.py').replace(/\\/g, '\\\\');
  const mainJs = cp.execFileSync('python', [
    '-c',
    `import importlib.util, pathlib, sys
s1=importlib.util.spec_from_file_location('pb', r'${pbPath}'); pb=importlib.util.module_from_spec(s1); s1.loader.exec_module(pb)
s2=importlib.util.spec_from_file_location('au', r'${asarPath}'); au=importlib.util.module_from_spec(s2); s2.loader.exec_module(au)
raw=pathlib.Path(r'${baselineAsar.replace(/\\/g, '\\\\')}').read_bytes()
hdr, off = au.read_header(raw)
sys.stdout.buffer.write(pb.patch_main(au.read_member(raw, hdr, off, 'out/main/index.js')))`
  ], { maxBuffer: 20 * 1024 * 1024 }).toString('utf8');

  assert.match(mainJs, /setAppUserModelId\("com\.cuedesk\.app"\)/);
  assert.match(mainJs, /setAppDetails\(/);
  assert.match(mainJs, /relaunchDisplayName:\s*"CueDesk"/);
  assert.doesNotMatch(mainJs, /if \(process\.platform === "win32"\) return false;/);
  assert.match(mainJs, /syncTrayForSecurity/);
  assert.match(mainJs, /tray_hidden_security/);
  assert.match(mainJs, /toggleWindow\("hotkey_toggle"\)/);
  assert.match(mainJs, /recordHideRequest\?\.\("ipc_win_hide"\)/);
  assert.match(mainJs, /recover-window/);
  assert.match(mainJs, /exit-security-recover/);
  assert.match(mainJs, /window-trace\.log/);
  assert.match(mainJs, /guide:open-url/);

  // Ensure zero duplicate ipcMain.handle() registrations (including IPC.* constants)
  const ipcConstMap = new Map();
  for (const m of mainJs.matchAll(/(\w+):\s*"([a-z0-9-]+:[a-z0-9-]+)"/gi)) {
    ipcConstMap.set(m[1], m[2]);
  }
  const seenChannels = new Set();
  for (const m of mainJs.matchAll(/ipcMain\.handle\(\s*(?:"([^"]+)"|IPC\.(\w+))/g)) {
    const ch = m[1] || ipcConstMap.get(m[2]) || `IPC.${m[2]}`;
    assert.equal(seenChannels.has(ch), false, `duplicate ipcMain.handle channel detected: ${ch}`);
    seenChannels.add(ch);
  }
});

test('v2 Store.retireMissing clears missing-source warnings cleanly and auto-retires deleted archived logs', async (t) => {
  const { Store } = require('../cuedesk/v2/store.cjs');
  const dir = tmpDir(t);
  const root = path.join(dir, 'kb');
  const idxDir = path.join(dir, 'idx');
  fs.mkdirSync(path.join(root, '岗位档案', '测试-测开', '面试记录', '2026-11-27-测试'), { recursive: true });
  fs.writeFileSync(path.join(root, '简历速查.md'), '# 速查\n内容', 'utf8');
  fs.writeFileSync(path.join(root, '岗位档案', '测试-测开', '面试记录', '2026-11-27-测试', '原始转录与AI参考.md'), '# 原始转录\n内容', 'utf8');

  const store = new Store({ root, dir: idxDir });
  await store.refresh();

  // Delete both files outside CueDesk
  fs.unlinkSync(path.join(root, '简历速查.md'));
  fs.unlinkSync(path.join(root, '岗位档案', '测试-测开', '面试记录', '2026-11-27-测试', '原始转录与AI参考.md'));
  await store.refresh();

  // Archived interview log auto-retires silently; regular deleted file warns until user confirms cleanup
  assert.equal(store.diagnostics.length, 1);
  assert.match(store.diagnostics[0], /简历速查\.md/);

  const res = await store.retireMissing();
  assert.equal(res.retired, 1);
  assert.equal(store.diagnostics.length, 0);
  const retiredDoc = store.manifest.documents.find(d => d.file_path === '简历速查.md');
  assert.equal(retiredDoc.status, 'retired');
});
