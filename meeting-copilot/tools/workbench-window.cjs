'use strict';
const { execFile } = require('node:child_process');

const HOME_DEFAULT = Object.freeze({ width: 1120, height: 760 });
const HOME_MIN = Object.freeze([380, 440]);
const WORKBENCH_DEFAULT = Object.freeze({ width: 920, height: 464 });
const WORKBENCH_MIN = Object.freeze([220, 224]);

const SCREEN_RECORDER_PROCESSES = new Set([
  'obs64.exe',
  'obs32.exe',
  'obs.exe',
  'streamlabs obs.exe',
  'bandicam.exe',
  'camtasia.exe',
  'camrecorder.exe',
  'screenrec.exe',
  'sharex.exe',
  'snagit32.exe',
  'snagit64.exe',
  'xsplit.core.exe',
  'loom.exe',
  'action.exe',
  'evcapture.exe',
  'kkcapture.exe'
]);

const MEETING_APP_PROCESSES = new Set([
  'wemeetapp.exe',
  'zoom.exe',
  'teams.exe',
  'ms-teams.exe',
  'feishu.exe',
  'lark.exe',
  'dingtalk.exe',
  'discord.exe',
  'wechat.exe',
  'qq.exe'
]);

function parseWindowsTasklist(stdout) {
  const names = new Set();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^"([^"]+)"/);
    const name = (match ? match[1] : trimmed.split(',')[0]).trim().toLowerCase();
    if (name) names.add(name);
  }
  return [...names];
}

function defaultListProcesses() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise(resolve => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
      if (err) resolve([]);
      else resolve(parseWindowsTasklist(stdout));
    });
  });
}

function clampRectToWorkArea(rect, workArea, minW, minH) {
  const width = Math.min(workArea.width, Math.max(minW, Math.round(rect.width)));
  const height = Math.min(workArea.height, Math.max(minH, Math.round(rect.height)));
  const x = Math.round(Math.max(workArea.x, Math.min(rect.x, workArea.x + workArea.width - width)));
  const y = Math.round(Math.max(workArea.y, Math.min(rect.y, workArea.y + workArea.height - height)));
  return { x, y, width, height };
}

function createWorkbenchWindow({
  prefs,
  screen,
  shortcuts,
  getStealth = () => false,
  setStealth = () => {},
  isWrittenCompact = () => false,
  onStateChange = () => {},
  onHoverChange = () => {},
  listProcesses = defaultListProcesses,
  pollIntervalMs = 60
}) {
  let win = null;
  let mode = 'home';
  let applyingBounds = false;
  let tempFocus = false;
  let clickThrough = false;
  let mouseInteractive = false;
  let hoverInside = true;
  let hoverTimer = null;
  let boundsTimer = null;
  let hotkeyErrors = [];
  let disposed = false;
  const ownedHotkeys = new Set();

  function activeWin() {
    return win && !win.isDestroyed() ? win : null;
  }

  function isSecurityActive() {
    return !!prefs.getPublic().securityMode.enabled;
  }

  function effectivePreventFocus() {
    const p = prefs.getPublic();
    return !!p.securityMode.enabled || !!p.preventFocus;
  }

  function shouldSkipTaskbar() {
    return isWrittenCompact() || mode === 'workbench' || effectivePreventFocus() || isSecurityActive();
  }

  function getWindowState() {
    const w = activeWin();
    const p = prefs.getPublic();
    return {
      mode,
      maximized: !!w?.isMaximized?.(),
      minimized: !!w?.isMinimized?.(),
      visible: !!w?.isVisible?.(),
      alwaysOnTop: !!p.alwaysOnTop,
      preventFocus: effectivePreventFocus(),
      rawPreventFocus: !!p.preventFocus,
      tempFocus,
      clickThrough,
      allowCapture: !getStealth(),
      securityMode: { ...p.securityMode },
      hoverReveal: !!p.hoverReveal,
      autoCollapseChrome: !!p.autoCollapseChrome,
      hoverInside,
      hotkeys: { ...p.hotkeys },
      hotkeyErrors: [...hotkeyErrors]
    };
  }

  function emitState() {
    try { onStateChange(getWindowState()); } catch {}
  }

  function syncFocusAndTaskbar() {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const focusable = tempFocus || !effectivePreventFocus();
    try { w.setFocusable(focusable); } catch {}
    try { w.setSkipTaskbar(shouldSkipTaskbar()); } catch {}
  }

  function syncAlwaysOnTop() {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const p = prefs.getPublic();
    const topmost = mode === 'workbench' ? !!p.alwaysOnTop : false;
    try {
      if (topmost) w.setAlwaysOnTop(true, 'screen-saver');
      else w.setAlwaysOnTop(false);
    } catch {}
  }

  function syncClickThroughNative() {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const shouldIgnore = mode === 'workbench' && clickThrough && !mouseInteractive;
    try {
      if (shouldIgnore) w.setIgnoreMouseEvents(true, { forward: true });
      else w.setIgnoreMouseEvents(false);
    } catch {}
  }

  function stopHoverPolling() {
    if (hoverTimer) {
      clearInterval(hoverTimer);
      hoverTimer = null;
    }
  }

  function checkHoverOnce() {
    const w = activeWin();
    if (!w || !w.isVisible?.() || w.isMinimized?.()) return;
    const pt = screen.getCursorScreenPoint?.();
    if (!pt) return;
    const b = w.getBounds();
    const inside = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
    if (inside !== hoverInside) {
      hoverInside = inside;
      try { onHoverChange(inside); } catch {}
    }
  }

  function syncHoverPolling() {
    const w = activeWin();
    const p = prefs.getPublic();
    const wantPoll = !disposed && !!w && mode === 'workbench' && !isWrittenCompact() &&
      (p.hoverReveal || p.autoCollapseChrome) &&
      (w.isVisible ? w.isVisible() : true) &&
      !(w.isMinimized && w.isMinimized());
    if (!wantPoll) {
      stopHoverPolling();
      if (!hoverInside) {
        hoverInside = true;
        try { onHoverChange(true); } catch {}
      }
      return;
    }
    if (!hoverTimer) {
      checkHoverOnce();
      hoverTimer = setInterval(checkHoverOnce, pollIntervalMs);
      hoverTimer.unref?.();
    }
  }

  function saveCurrentModeBounds() {
    const w = activeWin();
    if (!w || applyingBounds || isWrittenCompact() || w.isMinimized?.()) return;
    const raw = w.getNormalBounds ? w.getNormalBounds() : w.getBounds();
    if (!raw || raw.width < 120 || raw.height < 80) return;
    const key = mode === 'home' ? 'homeBounds' : 'workbenchBounds';
    try {
      prefs.applyPatch({ [key]: { x: raw.x, y: raw.y, width: raw.width, height: raw.height } }, { silent: true });
    } catch {}
  }

  function scheduleBoundsSave() {
    if (applyingBounds || isWrittenCompact()) return;
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      saveCurrentModeBounds();
    }, 180);
    boundsTimer.unref?.();
  }

  function targetBoundsFor(targetMode) {
    const p = prefs.getPublic();
    const saved = targetMode === 'home' ? p.homeBounds : p.workbenchBounds;
    const def = targetMode === 'home' ? HOME_DEFAULT : WORKBENCH_DEFAULT;
    const [minW, minH] = targetMode === 'home' ? HOME_MIN : WORKBENCH_MIN;
    const w = activeWin();
    let display;
    if (saved) {
      display = screen.getDisplayMatching(saved);
    } else if (w) {
      display = screen.getDisplayMatching(w.getBounds());
    } else {
      display = screen.getPrimaryDisplay();
    }
    const work = display.workArea;
    if (saved) {
      return clampRectToWorkArea(saved, work, minW, minH);
    }
    const width = Math.min(work.width, def.width);
    const height = Math.min(work.height, def.height);
    const x = work.x + Math.round((work.width - width) / 2);
    const y = targetMode === 'home'
      ? work.y + Math.round((work.height - height) / 2)
      : work.y + Math.max(24, Math.round((work.height - height) * 0.16));
    return { x, y, width, height };
  }

  function initialOptions() {
    if (isWrittenCompact()) return {};
    const bounds = targetBoundsFor('home');
    return {
      ...bounds,
      minWidth: HOME_MIN[0],
      minHeight: HOME_MIN[1],
      alwaysOnTop: false,
      skipTaskbar: effectivePreventFocus() || isSecurityActive()
    };
  }

  function applyModeLayout(targetMode) {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const [minW, minH] = targetMode === 'home' ? HOME_MIN : WORKBENCH_MIN;
    const bounds = targetBoundsFor(targetMode);
    applyingBounds = true;
    try {
      if (targetMode === 'workbench' && w.isMaximized?.()) {
        w.unmaximize();
      }
      w.setMinimumSize(minW, minH);
      w.setBounds(bounds, false);
    } finally {
      applyingBounds = false;
    }
  }

  function setMode(nextMode) {
    if (nextMode !== 'home' && nextMode !== 'workbench') {
      throw new Error('未知窗口模式：' + nextMode);
    }
    const changed = mode !== nextMode;
    if (changed) saveCurrentModeBounds();
    mode = nextMode;
    if (mode === 'home') {
      tempFocus = false;
      clickThrough = false;
      mouseInteractive = false;
      prefs.applyPatch({ clickThrough: false }, { silent: true, save: false });
    }
    if (!isWrittenCompact()) {
      applyModeLayout(mode);
      syncAlwaysOnTop();
      syncFocusAndTaskbar();
      syncClickThroughNative();
    }
    syncHoverPolling();
    emitState();
    return getWindowState();
  }

  function setAlwaysOnTop(on) {
    prefs.applyPatch({ alwaysOnTop: !!on }, { silent: false });
    syncAlwaysOnTop();
    emitState();
    return getWindowState();
  }

  function setPreventFocus(on) {
    const next = !!on;
    if (isSecurityActive() && !next) {
      throw new Error('安全模式已开启，不抢焦点已锁定');
    }
    prefs.applyPatch({ preventFocus: next }, { silent: false });
    if (!next) tempFocus = false;
    syncFocusAndTaskbar();
    emitState();
    return getWindowState();
  }

  function requestTempFocus(active) {
    const w = activeWin();
    if (!w || isWrittenCompact()) return getWindowState();
    const next = !!active && effectivePreventFocus();
    tempFocus = next;
    syncFocusAndTaskbar();
    if (next) {
      try { w.focus(); } catch {}
    }
    emitState();
    return getWindowState();
  }

  function setClickThrough(on) {
    const next = !!on && mode === 'workbench' && !isWrittenCompact();
    clickThrough = next;
    mouseInteractive = false;
    prefs.applyPatch({ clickThrough: next }, { silent: false, save: false });
    syncClickThroughNative();
    emitState();
    return getWindowState();
  }

  function setMouseInteractive(interactive) {
    if (!clickThrough || mode !== 'workbench' || isWrittenCompact()) return false;
    const next = !!interactive;
    if (next === mouseInteractive) return mouseInteractive;
    mouseInteractive = next;
    syncClickThroughNative();
    return mouseInteractive;
  }

  function setHoverTracking(on) {
    if (typeof on === 'boolean') {
      // Explicit refresh; actual polling obeys hoverReveal || autoCollapseChrome.
      if (!on) stopHoverPolling();
    }
    syncHoverPolling();
    return getWindowState();
  }

  function minimize() {
    const w = activeWin();
    if (!w) return false;
    stopHoverPolling();
    w.minimize();
    emitState();
    return true;
  }

  function toggleMaximize() {
    const w = activeWin();
    if (!w) return false;
    if (w.isMaximized?.()) w.unmaximize();
    else w.maximize();
    emitState();
    return !!w.isMaximized?.();
  }

  function setAllowCapture(allow) {
    const nextAllow = !!allow;
    if (isSecurityActive() && nextAllow) {
      throw new Error('安全模式已开启，已强制禁止出现在截图中');
    }
    setStealth(!nextAllow);
    emitState();
    return getWindowState();
  }

  function enableSecurity(options = {}) {
    const scope = options.scope === 'persistent' ? 'persistent' : 'session';
    const current = prefs.getPublic();
    const wasEnabled = current.securityMode.enabled;
    const savedPreventFocus = wasEnabled ? current.securityMode.savedPreventFocus : !!current.preventFocus;
    const savedAllowCapture = wasEnabled ? current.securityMode.savedAllowCapture : !getStealth();
    const autoEnableOnLaunch = typeof options.autoEnableOnLaunch === 'boolean'
      ? options.autoEnableOnLaunch
      : (scope === 'persistent' ? true : current.securityMode.autoEnableOnLaunch);

    prefs.applyPatch({
      securityMode: {
        enabled: true,
        scope,
        autoEnableOnLaunch,
        savedPreventFocus,
        savedAllowCapture
      }
    });
    setStealth(true);
    syncFocusAndTaskbar();
    emitState();
    return getWindowState();
  }

  function disableSecurity(options = {}) {
    const current = prefs.getPublic();
    if (!current.securityMode.enabled) {
      if (typeof options.autoEnableOnLaunch === 'boolean') {
        prefs.applyPatch({ securityMode: { autoEnableOnLaunch: options.autoEnableOnLaunch } });
        emitState();
      }
      return getWindowState();
    }
    // Ending an interview session should only clear session-scoped security mode.
    if (options.scope === 'session' && current.securityMode.scope === 'persistent') {
      return getWindowState();
    }
    const restorePreventFocus = typeof current.securityMode.savedPreventFocus === 'boolean'
      ? current.securityMode.savedPreventFocus
      : false;
    const restoreAllowCapture = typeof current.securityMode.savedAllowCapture === 'boolean'
      ? current.securityMode.savedAllowCapture
      : true;
    const nextAutoLaunch = options.scope === 'persistent' || options.clearAutoLaunch
      ? false
      : (typeof options.autoEnableOnLaunch === 'boolean' ? options.autoEnableOnLaunch : current.securityMode.autoEnableOnLaunch);

    prefs.applyPatch({
      preventFocus: restorePreventFocus,
      securityMode: {
        enabled: false,
        scope: 'session',
        autoEnableOnLaunch: nextAutoLaunch,
        savedPreventFocus: null,
        savedAllowCapture: null
      }
    });
    setStealth(!restoreAllowCapture);
    if (!restorePreventFocus) tempFocus = false;
    syncFocusAndTaskbar();
    emitState();
    return getWindowState();
  }

  function setSecurityPrefs(patch = {}) {
    const current = prefs.getPublic();
    const nextAuto = typeof patch.autoEnableOnLaunch === 'boolean'
      ? patch.autoEnableOnLaunch
      : current.securityMode.autoEnableOnLaunch;
    prefs.applyPatch({
      securityMode: {
        autoEnableOnLaunch: nextAuto,
        scope: nextAuto && current.securityMode.enabled ? 'persistent' : current.securityMode.scope
      }
    });
    emitState();
    return getWindowState();
  }

  async function checkEnvironment() {
    const w = activeWin();
    const stealthNow = !!getStealth();
    let contentProtectionSupported = false;
    const warnings = [];
    if (w && typeof w.setContentProtection === 'function') {
      try {
        // Re-apply current state without changing user settings to verify native affinity call.
        w.setContentProtection(stealthNow);
        contentProtectionSupported = true;
      } catch (e) {
        warnings.push('系统窗口防截屏接口调用失败：' + e.message);
      }
    } else {
      warnings.push('当前窗口尚未就绪，无法验证防截屏能力');
    }

    const processes = await listProcesses().catch(() => []);
    const screenRecorders = processes.filter(p => SCREEN_RECORDER_PROCESSES.has(p));
    const meetingApps = processes.filter(p => MEETING_APP_PROCESSES.has(p));
    if (screenRecorders.length) {
      warnings.push('检测到录屏/截屏软件正在运行：' + screenRecorders.join('、'));
    }
    if (!stealthNow) {
      warnings.push('当前允许出现在截图中；如需防截屏隐藏，请开启安全模式或关闭“允许出现在截图中”。');
    }

    return {
      ok: contentProtectionSupported && screenRecorders.length === 0,
      checkedAt: Date.now(),
      contentProtectionSupported,
      contentProtectionActive: stealthNow,
      securityModeActive: isSecurityActive(),
      preventFocusActive: effectivePreventFocus(),
      clickThroughActive: clickThrough,
      screenRecorders,
      meetingApps,
      warnings
    };
  }

  function getDisplays() {
    const displays = screen.getAllDisplays ? screen.getAllDisplays() : [];
    const primary = screen.getPrimaryDisplay ? screen.getPrimaryDisplay() : null;
    const primaryId = primary ? String(primary.id) : '';
    return displays.map((d, index) => {
      const id = String(d.id);
      const isPrimary = id === primaryId;
      const scale = Number(d.scaleFactor) || 1;
      const physicalBounds = screen.dipToScreenRect
        ? screen.dipToScreenRect(null, d.bounds)
        : {
            x: Math.round(d.bounds.x * scale),
            y: Math.round(d.bounds.y * scale),
            width: Math.round(d.bounds.width * scale),
            height: Math.round(d.bounds.height * scale)
          };
      const baseName = isPrimary ? '主屏幕' : `显示器 ${index + 1}`;
      return {
        id,
        label: `${baseName} (${physicalBounds.width}×${physicalBounds.height})`,
        isPrimary,
        scaleFactor: scale,
        bounds: { ...d.bounds },
        workArea: { ...d.workArea },
        physicalBounds
      };
    });
  }

  function resolveCaptureRect(displayId) {
    const requested = displayId !== undefined ? String(displayId || '').trim() : prefs.getPublic().captureDisplayId;
    if (!requested || requested === 'all' || requested === 'default') {
      return { rect: null, display: null, fallback: false };
    }
    const found = getDisplays().find(d => d.id === requested);
    if (!found) {
      return { rect: null, display: null, fallback: true };
    }
    return { rect: { ...found.physicalBounds }, display: found, fallback: false };
  }

  function unregisterHotkeys() {
    for (const key of ownedHotkeys) {
      try { shortcuts?.unregister?.(key); } catch {}
    }
    ownedHotkeys.clear();
  }

  function registerHotkeys() {
    if (disposed || !shortcuts) return [];
    unregisterHotkeys();
    hotkeyErrors = [];
    const { togglePreventFocus, toggleClickThrough } = prefs.getPublic().hotkeys;

    const pairs = [
      ['togglePreventFocus', togglePreventFocus, () => {
        if (isSecurityActive()) {
          emitState();
          return;
        }
        try { setPreventFocus(!prefs.getPublic().preventFocus); } catch {}
      }],
      ['toggleClickThrough', toggleClickThrough, () => {
        if (clickThrough) setClickThrough(false);
        else if (mode === 'workbench') setClickThrough(true);
      }]
    ];

    for (const [name, key, handler] of pairs) {
      if (!key) continue;
      if (shortcuts.isRegistered?.(key)) {
        hotkeyErrors.push(`快捷键 ${key}（${name}）已被占用`);
        continue;
      }
      try {
        const ok = shortcuts.register(key, handler);
        if (ok) ownedHotkeys.add(key);
        else hotkeyErrors.push(`无法注册快捷键 ${key}（${name}）`);
      } catch {
        hotkeyErrors.push(`快捷键 ${key}（${name}）格式无效`);
      }
    }
    emitState();
    return [...hotkeyErrors];
  }

  function attach(window) {
    win = window;
    if (!win) return;

    // Apply startup security recovery / auto-enable on launch.
    const recovered = prefs.consumeRecoveredSessionSecurity?.();
    if (recovered && typeof recovered.savedAllowCapture === 'boolean') {
      setStealth(!recovered.savedAllowCapture);
    } else if (isSecurityActive()) {
      setStealth(true);
    }

    win.on('resize', scheduleBoundsSave);
    win.on('move', scheduleBoundsSave);
    win.on('maximize', () => emitState());
    win.on('unmaximize', () => emitState());
    win.on('minimize', () => { stopHoverPolling(); emitState(); });
    win.on('restore', () => { syncFocusAndTaskbar(); syncHoverPolling(); emitState(); });
    win.on('show', () => { syncFocusAndTaskbar(); syncAlwaysOnTop(); syncHoverPolling(); emitState(); });
    win.on('hide', () => { stopHoverPolling(); emitState(); });
    win.on('blur', () => {
      if (tempFocus) {
        tempFocus = false;
        syncFocusAndTaskbar();
        emitState();
      }
    });
    win.on('closed', () => {
      stopHoverPolling();
      clearTimeout(boundsTimer);
      boundsTimer = null;
      win = null;
    });

    if (!isWrittenCompact()) {
      syncAlwaysOnTop();
      syncFocusAndTaskbar();
    }
    syncHoverPolling();
    emitState();
  }

  function onWrittenCompactChanged(enabled) {
    if (!enabled) {
      applyModeLayout(mode);
      syncAlwaysOnTop();
      syncFocusAndTaskbar();
      syncClickThroughNative();
      syncHoverPolling();
      emitState();
    } else {
      stopHoverPolling();
    }
  }

  function dispose() {
    disposed = true;
    stopHoverPolling();
    clearTimeout(boundsTimer);
    boundsTimer = null;
    unregisterHotkeys();
    // Cleanly restore session-scoped security mode on normal quit.
    try { disableSecurity({ scope: 'session' }); } catch {}
  }

  return {
    initialOptions,
    attach,
    setMode,
    getWindowState,
    minimize,
    toggleMaximize,
    setAlwaysOnTop,
    setPreventFocus,
    requestTempFocus,
    setClickThrough,
    setMouseInteractive,
    setHoverTracking,
    setAllowCapture,
    enableSecurity,
    disableSecurity,
    setSecurityPrefs,
    checkEnvironment,
    getDisplays,
    resolveCaptureRect,
    registerHotkeys,
    onWrittenCompactChanged,
    syncHoverPolling,
    dispose
  };
}

module.exports = {
  createWorkbenchWindow,
  HOME_DEFAULT,
  HOME_MIN,
  WORKBENCH_DEFAULT,
  WORKBENCH_MIN,
  parseWindowsTasklist
};
