'use strict';
const { execFile } = require('node:child_process');
const { DEFAULT_WORKBENCH_HOTKEYS, WORKBENCH_HOTKEY_ACTIONS } = require('./workbench-prefs.cjs');

const HOME_DEFAULT = Object.freeze({ width: 1120, height: 760 });
const HOME_MIN = Object.freeze([380, 440]);
const WORKBENCH_DEFAULT = Object.freeze({ width: 920, height: 464 });
const WORKBENCH_MIN = Object.freeze([220, 224]);
const WRITTEN_DEFAULT = Object.freeze({ width: 440, height: 560 });
const WRITTEN_MIN = Object.freeze([320, 200]);
const WRITTEN_MINI_DEFAULT = Object.freeze({ width: 280, height: 188 });
const WRITTEN_MINI_MIN = Object.freeze([210, 108]);
const FLOATING_MODES = new Set(['workbench', 'written', 'written-mini']);
const ALL_WINDOW_MODES = new Set(['home', 'workbench', 'written', 'written-mini']);

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
  onHotkeyAction = () => {},
  onHotkeysChanged = () => {},
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
  let hoverBlocked = false;
  let hoverHidden = false;
  let hoverTimer = null;
  let boundsTimer = null;
  let dragStart = null;
  let hotkeyErrors = [];
  let disposed = false;
  const ownedHotkeys = new Set();

  function activeWin() {
    return win && !win.isDestroyed() ? win : null;
  }

  function isSecurityActive() {
    return !!prefs.getPublic().securityMode.enabled;
  }

  function isFloatingMode(m = mode) {
    return FLOATING_MODES.has(m);
  }

  // Prevent-focus policy is ONLY applied in floating modes (workbench / written / written-mini; never locks Home on startup or return).
  function effectivePreventFocus() {
    const p = prefs.getPublic();
    return isFloatingMode() && (!!p.securityMode.enabled || !!p.preventFocus);
  }

  // Match SuiSi: only hide taskbar icon during security mode or legacy written compact mode so OS focus & interaction stay reliable.
  function shouldSkipTaskbar() {
    return isWrittenCompact() || isSecurityActive();
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
      hoverHidden,
      hotkeys: { ...p.hotkeys },
      workbenchHotkeysEnabled: p.workbenchHotkeysEnabled !== false,
      workbenchHotkeys: { ...p.workbenchHotkeys },
      hotkeyErrors: [...hotkeyErrors]
    };
  }

  function emitState() {
    try { onStateChange(getWindowState()); } catch {}
  }

  function syncAlwaysOnTop() {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const p = prefs.getPublic();
    const topmost = isFloatingMode() ? !!p.alwaysOnTop : isSecurityActive();
    try {
      if (topmost) w.setAlwaysOnTop(true, 'screen-saver');
      else w.setAlwaysOnTop(false);
    } catch {}
  }

  function syncFocusAndTaskbar() {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    // Home mode is ALWAYS focusable so restart/return never locks the main UI.
    const focusable = !isFloatingMode()
      ? true
      : (tempFocus || (!effectivePreventFocus() && !clickThrough));
    try {
      const current = typeof w.isFocusable === 'function' ? w.isFocusable() : undefined;
      if (current === undefined || current !== focusable) {
        w.setFocusable(focusable);
      }
    } catch {}
    try { w.setSkipTaskbar(shouldSkipTaskbar()); } catch {}
    // Critical Windows fix (matching SuiSi applyFocusPreference):
    // setFocusable(false) drops z-order via Focus(false), so re-assert alwaysOnTop right after.
    if (!focusable) {
      syncAlwaysOnTop();
    }
  }

  // Unified SuiSi-style mouse passthrough state machine:
  // ignores pointer when hidden by hover-reveal OR when clickThrough is ON outside interactive regions.
  function syncMousePassthrough() {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const shouldIgnore = isFloatingMode() && (hoverHidden || (clickThrough && !mouseInteractive));
    try {
      if (shouldIgnore) w.setIgnoreMouseEvents(true, { forward: true });
      else w.setIgnoreMouseEvents(false);
    } catch {}
  }

  function setHoverHiddenNative(nextHidden) {
    const next = !!nextHidden && isFloatingMode() && !hoverBlocked;
    if (next === hoverHidden) return;
    hoverHidden = next;
    syncMousePassthrough();
  }

  function stopHoverPolling() {
    if (hoverTimer) {
      clearInterval(hoverTimer);
      hoverTimer = null;
    }
  }

  function checkHoverOnce(forceEmit = false) {
    const w = activeWin();
    if (!w || !w.isVisible?.() || w.isMinimized?.()) return;
    const pt = screen.getCursorScreenPoint?.();
    if (!pt) return;
    const b = w.getBounds();
    const inside = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
    const p = prefs.getPublic();
    if (inside !== hoverInside || forceEmit) {
      hoverInside = inside;
      setHoverHiddenNative(!!p.hoverReveal && !inside && !hoverBlocked);
      try { onHoverChange(inside); } catch {}
    } else if (p.hoverReveal && !inside && !hoverBlocked && !hoverHidden) {
      setHoverHiddenNative(true);
    }
  }

  function syncHoverPolling() {
    const w = activeWin();
    const p = prefs.getPublic();
    const wantPoll = !disposed && !!w && isFloatingMode() && !isWrittenCompact() &&
      !hoverBlocked &&
      (p.hoverReveal || p.autoCollapseChrome) &&
      (w.isVisible ? w.isVisible() : true) &&
      !(w.isMinimized && w.isMinimized());
    if (!wantPoll) {
      stopHoverPolling();
      setHoverHiddenNative(false);
      if (!hoverInside) {
        hoverInside = true;
        try { onHoverChange(true); } catch {}
      }
      return;
    }
    if (!hoverTimer) {
      checkHoverOnce(true);
      hoverTimer = setInterval(() => checkHoverOnce(false), pollIntervalMs);
      hoverTimer.unref?.();
    } else {
      checkHoverOnce(false);
    }
  }

  function setHoverBlocked(blocked) {
    const next = !!blocked;
    if (next === hoverBlocked) return getWindowState();
    hoverBlocked = next;
    syncHoverPolling();
    return getWindowState();
  }

  // Exact SuiSi `window:cursor-in-content` logic for reliable 80ms click-through hit-testing on Windows.
  function getCursorInContent() {
    const w = activeWin();
    if (!w || !w.isVisible?.() || w.isMinimized?.()) return null;
    const pt = screen.getCursorScreenPoint?.();
    if (!pt) return null;
    const b = typeof w.getContentBounds === 'function' ? w.getContentBounds() : w.getBounds();
    const rawZoom = typeof w.webContents?.getZoomFactor === 'function' ? w.webContents.getZoomFactor() : 1;
    const zoom = Number.isFinite(rawZoom) && rawZoom > 0 ? rawZoom : 1;
    const x = (pt.x - b.x) / zoom;
    const y = (pt.y - b.y) / zoom;
    const inside = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
    return { x, y, inside };
  }

  // SuiSi JS window dragging (avoids `-webkit-app-region: drag` conflicts with click-through & non-focusable windows).
  // Reads live DIP coordinates from screen.getCursorScreenPoint() when caller omits coords (DPI-proof across monitors).
  function resolveDragPoint(cursorX, cursorY) {
    if (cursorX != null && cursorY != null) {
      const sx = Number(cursorX);
      const sy = Number(cursorY);
      if (Number.isFinite(sx) && Number.isFinite(sy)) return { x: sx, y: sy };
    }
    const pt = screen.getCursorScreenPoint?.();
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) return { x: pt.x, y: pt.y };
    return null;
  }

  function beginDrag(cursorX, cursorY) {
    const w = activeWin();
    if (!w || clickThrough || w.isMaximized?.()) return false;
    const pt = resolveDragPoint(cursorX, cursorY);
    if (!pt) return false;
    const b = w.getBounds();
    dragStart = {
      cursorX: pt.x,
      cursorY: pt.y,
      windowX: b.x,
      windowY: b.y,
      windowWidth: b.width,
      windowHeight: b.height,
      lastX: b.x,
      lastY: b.y
    };
    return true;
  }

  function dragTo(cursorX, cursorY) {
    const w = activeWin();
    if (!w || !dragStart || clickThrough) return false;
    const pt = resolveDragPoint(cursorX, cursorY);
    if (!pt) return false;
    const nx = dragStart.windowX + Math.round(pt.x - dragStart.cursorX);
    const ny = dragStart.windowY + Math.round(pt.y - dragStart.cursorY);
    if (nx === dragStart.lastX && ny === dragStart.lastY) return false;
    try {
      w.setBounds({ x: nx, y: ny, width: dragStart.windowWidth, height: dragStart.windowHeight }, false);
      dragStart.lastX = nx;
      dragStart.lastY = ny;
      return true;
    } catch {
      return false;
    }
  }

  function endDrag() {
    if (dragStart) {
      dragStart = null;
      scheduleBoundsSave();
    }
    return true;
  }

  function modeBoundsSpec(targetMode) {
    if (targetMode === 'home') return { key: 'homeBounds', def: HOME_DEFAULT, min: HOME_MIN };
    if (targetMode === 'written') return { key: 'writtenBounds', def: WRITTEN_DEFAULT, min: WRITTEN_MIN };
    if (targetMode === 'written-mini') return { key: 'writtenMiniBounds', def: WRITTEN_MINI_DEFAULT, min: WRITTEN_MINI_MIN };
    return { key: 'workbenchBounds', def: WORKBENCH_DEFAULT, min: WORKBENCH_MIN };
  }

  function saveCurrentModeBounds() {
    const w = activeWin();
    if (!w || applyingBounds || isWrittenCompact() || w.isMinimized?.()) return;
    const raw = w.getNormalBounds ? w.getNormalBounds() : w.getBounds();
    if (!raw || raw.width < 120 || raw.height < 80) return;
    const { key } = modeBoundsSpec(mode);
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
    const { key, def, min } = modeBoundsSpec(targetMode);
    const saved = p[key];
    const [minW, minH] = min;
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
    if (targetMode === 'written' || targetMode === 'written-mini') {
      const x = work.x + Math.max(16, work.width - width - 36);
      const y = work.y + Math.max(24, Math.round((work.height - height) * 0.14));
      return { x, y, width, height };
    }
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
      alwaysOnTop: isSecurityActive(),
      focusable: true,
      skipTaskbar: isSecurityActive()
    };
  }

  function applyModeLayout(targetMode) {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const { min: [minW, minH] } = modeBoundsSpec(targetMode);
    const bounds = targetBoundsFor(targetMode);
    applyingBounds = true;
    try {
      if (isFloatingMode(targetMode) && w.isMaximized?.()) {
        w.unmaximize();
      }
      w.setMinimumSize(minW, minH);
      w.setBounds(bounds, false);
    } finally {
      applyingBounds = false;
    }
  }

  function setMode(nextMode) {
    if (!ALL_WINDOW_MODES.has(nextMode)) {
      throw new Error('未知窗口模式：' + nextMode);
    }
    const changed = mode !== nextMode;
    if (changed) saveCurrentModeBounds();
    dragStart = null;
    mode = nextMode;
    if (mode === 'home') {
      tempFocus = false;
      clickThrough = false;
      mouseInteractive = false;
      hoverHidden = false;
      hoverBlocked = false;
      prefs.applyPatch({ clickThrough: false }, { silent: true, save: false });
    }
    if (!isWrittenCompact()) {
      applyModeLayout(mode);
      syncAlwaysOnTop();
      syncFocusAndTaskbar();
      syncMousePassthrough();
      if (changed && mode === 'home') {
        const active = activeWin();
        try { active?.focus(); } catch {}
      }
    }
    syncHoverPolling();
    emitState();
    return getWindowState();
  }

  function setAlwaysOnTop(on) {
    const next = !!on;
    prefs.applyPatch({ alwaysOnTop: next }, { silent: false });
    // Turning off always-on-top automatically turns off click-through (matches SuiSi)
    // so a click-through window cannot sink behind other apps permanently.
    if (!next && clickThrough) {
      clickThrough = false;
      mouseInteractive = false;
      prefs.applyPatch({ clickThrough: false }, { silent: false, save: false });
      syncMousePassthrough();
      syncFocusAndTaskbar();
    }
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
    const next = !!active && (effectivePreventFocus() || clickThrough);
    tempFocus = next;
    syncFocusAndTaskbar();
    if (next) {
      try { w.focus(); } catch {}
    }
    emitState();
    return getWindowState();
  }

  function setClickThrough(on) {
    const next = !!on && isFloatingMode() && !isWrittenCompact();
    if (next && !prefs.getPublic().alwaysOnTop) {
      prefs.applyPatch({ alwaysOnTop: true }, { silent: false });
    }
    clickThrough = next;
    mouseInteractive = false;
    if (next) dragStart = null;
    prefs.applyPatch({ clickThrough: next }, { silent: false, save: false });
    syncAlwaysOnTop();
    syncMousePassthrough();
    syncFocusAndTaskbar();
    emitState();
    return getWindowState();
  }

  function setMouseInteractive(interactive) {
    if (!clickThrough || !isFloatingMode() || isWrittenCompact()) return false;
    const next = !!interactive;
    if (next === mouseInteractive) return mouseInteractive;
    mouseInteractive = next;
    syncMousePassthrough();
    return mouseInteractive;
  }

  function setHoverTracking(on) {
    if (typeof on === 'boolean' && !on) {
      stopHoverPolling();
      setHoverHiddenNative(false);
    }
    syncHoverPolling();
    return getWindowState();
  }

  function minimize() {
    const w = activeWin();
    if (!w) return false;
    stopHoverPolling();
    setHoverHiddenNative(false);
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
    syncAlwaysOnTop();
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
    syncAlwaysOnTop();
    syncFocusAndTaskbar();
    emitState();
    return getWindowState();
  }

  function setSecurityPrefs(patch = {}) {
    const current = prefs.getPublic();
    const nextAuto = typeof patch.autoEnableOnLaunch === 'boolean'
      ? patch.autoEnableOnLaunch
      : current.securityMode.autoEnableOnLaunch;
    const nextHideCursor = typeof patch.hideCursor === 'boolean'
      ? patch.hideCursor
      : (current.securityMode.hideCursor !== false);
    prefs.applyPatch({
      securityMode: {
        autoEnableOnLaunch: nextAuto,
        hideCursor: nextHideCursor,
        scope: nextAuto && current.securityMode.enabled ? 'persistent' : current.securityMode.scope
      }
    });
    emitState();
    return getWindowState();
  }

  function reapplyContentProtection() {
    const w = activeWin();
    if (!w || typeof w.setContentProtection !== 'function') return false;
    try {
      w.setContentProtection(!!getStealth());
      return true;
    } catch {
      return false;
    }
  }

  async function checkEnvironment() {
    const w = activeWin();
    const stealthNow = !!getStealth();
    let contentProtectionSupported = false;
    const warnings = [];
    if (w && typeof w.setContentProtection === 'function') {
      try {
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

  function dispatchHotkeyAction(action) {
    if (action === 'togglePreventFocus') {
      if (isSecurityActive()) { emitState(); return; }
      try { setPreventFocus(!prefs.getPublic().preventFocus); } catch {}
      return;
    }
    if (action === 'toggleClickThrough') {
      if (clickThrough) setClickThrough(false);
      else if (isFloatingMode()) setClickThrough(true);
      return;
    }
    if (action === 'toggleHotkeys') {
      const nextEnabled = !(prefs.getPublic().workbenchHotkeysEnabled !== false);
      prefs.applyPatch({ workbenchHotkeysEnabled: nextEnabled });
      registerHotkeys();
      return;
    }
    if (!isFloatingMode()) return;
    if (action === 'toggleAlwaysOnTop') {
      setAlwaysOnTop(!prefs.getPublic().alwaysOnTop);
      return;
    }
    if (action === 'toggleHoverReveal') {
      prefs.applyPatch({ hoverReveal: !prefs.getPublic().hoverReveal });
      syncHoverPolling();
      emitState();
      return;
    }
    try { onHotkeyAction(action); } catch {}
  }

  function unregisterHotkeys() {
    for (const key of ownedHotkeys) {
      try { shortcuts?.unregister?.(key); } catch {}
    }
    ownedHotkeys.clear();
  }

  function getMouseBindings() {
    const pub = prefs.getPublic();
    const enabled = pub.workbenchHotkeysEnabled !== false;
    const map = pub.workbenchHotkeys || DEFAULT_WORKBENCH_HOTKEYS;
    const activeActions = enabled
      ? WORKBENCH_HOTKEY_ACTIONS
      : ['togglePreventFocus', 'toggleClickThrough', 'toggleHotkeys'];
    const out = [];
    for (const action of activeActions) {
      const key = String(map[action] || '').trim();
      if (/^Mouse[45]$/.test(key)) out.push({ action, key });
    }
    return out;
  }

  function registerHotkeys() {
    if (disposed || !shortcuts) return [];
    unregisterHotkeys();
    hotkeyErrors = [];
    const pub = prefs.getPublic();
    const enabled = pub.workbenchHotkeysEnabled !== false;
    const map = pub.workbenchHotkeys || DEFAULT_WORKBENCH_HOTKEYS;

    // Even when workbench hotkeys are toggled off, keep safety unlocks & toggleHotkeys active.
    const activeActions = enabled
      ? WORKBENCH_HOTKEY_ACTIONS
      : ['togglePreventFocus', 'toggleClickThrough', 'toggleHotkeys'];

    const seenKeys = new Set();
    for (const action of activeActions) {
      const key = String(map[action] || '').trim();
      if (!key) continue;
      if (seenKeys.has(key)) {
        hotkeyErrors.push(`快捷键 ${key}（${action}）重复`);
        continue;
      }
      seenKeys.add(key);
      // Mouse4/Mouse5 are registered via QuietCapture --mouse-watch inside shortcutRuntime
      if (/^Mouse[45]$/.test(key)) continue;
      if (shortcuts.isRegistered?.(key)) {
        hotkeyErrors.push(`快捷键 ${key}（${action}）已被占用`);
        continue;
      }
      try {
        const ok = shortcuts.register(key, () => dispatchHotkeyAction(action));
        if (ok) ownedHotkeys.add(key);
        else hotkeyErrors.push(`无法注册快捷键 ${key}（${action}）`);
      } catch {
        hotkeyErrors.push(`快捷键 ${key}（${action}）格式无效`);
      }
    }
    emitState();
    return [...hotkeyErrors];
  }

  function setWorkbenchHotkeys(patch = {}) {
    const prev = prefs.getPublic();
    const nextPatch = {};
    if (typeof patch.enabled === 'boolean') nextPatch.workbenchHotkeysEnabled = patch.enabled;
    if (patch.bindings && typeof patch.bindings === 'object') {
      const merged = { ...prev.workbenchHotkeys };
      for (const [k, v] of Object.entries(patch.bindings)) {
        if (WORKBENCH_HOTKEY_ACTIONS.includes(k)) merged[k] = String(v || '').trim();
      }
      const nonEmpty = Object.values(merged).filter(Boolean);
      if (new Set(nonEmpty).size !== nonEmpty.length) {
        throw new Error('工作台快捷键存在重复按键，请更换后重试');
      }
      nextPatch.workbenchHotkeys = merged;
    }
    prefs.applyPatch(nextPatch);
    const errs = registerHotkeys();
    if (errs.length && patch.bindings) {
      prefs.applyPatch({
        workbenchHotkeysEnabled: prev.workbenchHotkeysEnabled,
        workbenchHotkeys: prev.workbenchHotkeys
      });
      registerHotkeys();
      throw new Error(errs[0]);
    }
    try { onHotkeysChanged(); } catch {}
    return getWindowState();
  }

  function resetWorkbenchHotkeys() {
    prefs.applyPatch({
      workbenchHotkeysEnabled: true,
      workbenchHotkeys: { ...DEFAULT_WORKBENCH_HOTKEYS }
    });
    registerHotkeys();
    try { onHotkeysChanged(); } catch {}
    return getWindowState();
  }

  function attach(window) {
    win = window;
    if (!win) return;

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
    win.on('minimize', () => { stopHoverPolling(); setHoverHiddenNative(false); emitState(); });
    win.on('restore', () => { syncAlwaysOnTop(); syncFocusAndTaskbar(); syncMousePassthrough(); syncHoverPolling(); emitState(); });
    win.on('show', () => { syncAlwaysOnTop(); syncFocusAndTaskbar(); syncMousePassthrough(); syncHoverPolling(); emitState(); });
    win.on('hide', () => { stopHoverPolling(); setHoverHiddenNative(false); emitState(); });
    win.on('blur', () => {
      if (tempFocus) {
        tempFocus = false;
        syncFocusAndTaskbar();
        emitState();
      } else if (isFloatingMode()) {
        syncAlwaysOnTop();
      }
    });
    win.on('closed', () => {
      stopHoverPolling();
      clearTimeout(boundsTimer);
      boundsTimer = null;
      dragStart = null;
      win = null;
    });

    if (!isWrittenCompact()) {
      syncAlwaysOnTop();
      syncFocusAndTaskbar();
      syncMousePassthrough();
    }
    syncHoverPolling();
    emitState();
  }

  function onWrittenCompactChanged(enabled) {
    if (!enabled) {
      applyModeLayout(mode);
      syncAlwaysOnTop();
      syncFocusAndTaskbar();
      syncMousePassthrough();
      syncHoverPolling();
      emitState();
    } else {
      stopHoverPolling();
      setHoverHiddenNative(false);
    }
  }

  function dispose() {
    disposed = true;
    stopHoverPolling();
    clearTimeout(boundsTimer);
    boundsTimer = null;
    dragStart = null;
    unregisterHotkeys();
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
    setHoverBlocked,
    getCursorInContent,
    beginDrag,
    dragTo,
    endDrag,
    setAllowCapture,
    enableSecurity,
    disableSecurity,
    setSecurityPrefs,
    checkEnvironment,
    getDisplays,
    resolveCaptureRect,
    registerHotkeys,
    setWorkbenchHotkeys,
    resetWorkbenchHotkeys,
    getMouseBindings,
    dispatchHotkeyAction,
    reapplyContentProtection,
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
  WRITTEN_DEFAULT,
  WRITTEN_MIN,
  WRITTEN_MINI_DEFAULT,
  WRITTEN_MINI_MIN,
  parseWindowsTasklist
};
