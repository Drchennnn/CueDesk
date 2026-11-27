'use strict';
const fs = require('node:fs');
const path = require('node:path');
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
  pollIntervalMs = 60,
  traceLogPath = '',
  winNative = null
}) {
  let win = null;
  let mode = 'home';
  let applyingBounds = false;
  let boundsSaveSuppressUntil = 0;
  let pseudoMaximized = false;
  let restoreBounds = null;
  let preMaximizeBounds = null;
  let preMaximizePhysRect = null;
  let stableNormalBounds = null;
  let stableNormalPhysRect = null;
  let lastNormalBounds = null;
  let lastRestoredBounds = null;
  let lastRestoredPhysRect = null;
  const modePhysRects = new Map();
  let unmaximizeSettleTimers = [];
  let renderEnsureTimers = [];
  let pendingHideSource = null;
  let pendingShowSource = null;
  let inRecoverShow = false;
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
  let syncingFocus = false;
  let lastSkipTaskbar = null;
  let lastAlwaysOnTop = null;
  let lastIgnoreMouse = null;
  const ownedHotkeys = new Set();
  const traceRing = [];
  const TRACE_LIMIT = 240;

  function activeWin() {
    return win && !win.isDestroyed() ? win : null;
  }

  function resetNativeStyleCache() {
    lastSkipTaskbar = null;
    lastAlwaysOnTop = null;
    lastIgnoreMouse = null;
  }

  function traceEvent(event, extra = {}) {
    const w = activeWin();
    let bounds = null;
    try { bounds = w?.getBounds?.() || null; } catch {}
    const entry = {
      ts: new Date().toISOString(),
      event,
      mode,
      security: isSecurityActive(),
      focusable: typeof w?.isFocusable === 'function' ? w.isFocusable() : undefined,
      visible: typeof w?.isVisible === 'function' ? w.isVisible() : undefined,
      minimized: typeof w?.isMinimized === 'function' ? w.isMinimized() : undefined,
      maximized: isWindowMaximized(w),
      topmost: typeof w?.isAlwaysOnTop === 'function' ? w.isAlwaysOnTop() : undefined,
      skipTaskbar: lastSkipTaskbar,
      ignoreMouse: lastIgnoreMouse,
      tempFocus,
      clickThrough,
      hoverInside,
      hoverHidden,
      bounds,
      ...extra
    };
    traceRing.push(entry);
    if (traceRing.length > TRACE_LIMIT) traceRing.shift();
    if (traceLogPath) {
      try {
        fs.mkdirSync(path.dirname(traceLogPath), { recursive: true });
        if (fs.existsSync(traceLogPath) && fs.statSync(traceLogPath).size > 262144) {
          const tail = fs.readFileSync(traceLogPath, 'utf8').split(/\r?\n/).slice(-120).join('\n');
          fs.writeFileSync(traceLogPath, tail ? tail + '\n' : '', 'utf8');
        }
        fs.appendFileSync(traceLogPath, JSON.stringify(entry) + '\n', 'utf8');
      } catch {}
    }
  }

  function getTrace() {
    return traceRing.slice();
  }

  function recordHideRequest(source = 'unknown') {
    pendingHideSource = { source: String(source || 'unknown'), at: Date.now() };
    traceEvent('hide_request', { source: pendingHideSource.source });
  }

  function recordShowRequest(source = 'unknown') {
    pendingShowSource = { source: String(source || 'unknown'), at: Date.now() };
    traceEvent('show_request', { source: pendingShowSource.source });
  }

  function consumePendingSource(kind) {
    const slot = kind === 'hide' ? pendingHideSource : pendingShowSource;
    if (kind === 'hide') pendingHideSource = null;
    else pendingShowSource = null;
    if (slot && Date.now() - slot.at <= 1500) return slot.source;
    return 'external_or_os';
  }

  function clearUnmaximizeSettleTimers() {
    for (const id of unmaximizeSettleTimers) clearTimeout(id);
    unmaximizeSettleTimers = [];
  }

  function clearRenderEnsureTimers() {
    for (const id of renderEnsureTimers) clearTimeout(id);
    renderEnsureTimers = [];
  }

  function ensureRenderHostVisible(source = 'show', { raiseTopmost = false } = {}) {
    const w = activeWin();
    if (!w || !winNative || typeof winNative.ensureRenderVisible !== 'function') return null;
    if (typeof w.isVisible === 'function' && !w.isVisible()) return null;
    if (typeof w.isMinimized === 'function' && w.isMinimized()) return null;
    const handleResult = (result) => {
      if (!result) return null;
      traceEvent('ensure_render_visible', { source, ...result });
      if (result.repaired > 0) {
        try { activeWin()?.webContents?.invalidate?.(); } catch {}
      }
      return result;
    };
    const res = winNative.ensureRenderVisible(w, { raiseTopmost });
    if (res && typeof res.then === 'function') {
      return res.then(handleResult).catch(() => null);
    }
    return handleResult(res);
  }

  function scheduleEnsureRenderHostVisible(source = 'show', opts = {}) {
    clearRenderEnsureTimers();
    ensureRenderHostVisible(source, opts);
    const id = setTimeout(() => {
      renderEnsureTimers = renderEnsureTimers.filter(t => t !== id);
      ensureRenderHostVisible(`${source}_settle`, { raiseTopmost: false });
    }, 95);
    id.unref?.();
    renderEnsureTimers.push(id);
  }

  function boundsNearlyEqual(a, b, tol = 6) {
    if (!a || !b) return false;
    return (
      Math.abs(a.x - b.x) <= tol &&
      Math.abs(a.y - b.y) <= tol &&
      Math.abs(a.width - b.width) <= tol &&
      Math.abs(a.height - b.height) <= tol
    );
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

  function isWindowMaximized(w = activeWin()) {
    return Boolean(pseudoMaximized || w?.isMaximized?.());
  }

  function clearPseudoMaximize() {
    pseudoMaximized = false;
    restoreBounds = null;
  }

  function getWindowState() {
    const w = activeWin();
    const p = prefs.getPublic();
    return {
      mode,
      maximized: isWindowMaximized(w),
      minimized: !!w?.isMinimized?.(),
      visible: !!w?.isVisible?.(),
      alwaysOnTop: isFloatingMode() ? (!!p.alwaysOnTop || isSecurityActive()) : !!p.alwaysOnTop,
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

  function syncAlwaysOnTop(force = false) {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const p = prefs.getPublic();
    // Security mode ALWAYS enforces topmost so a non-focusable + skipTaskbar window can never sink behind other apps and lock up.
    const topmost = isFloatingMode() ? (!!p.alwaysOnTop || isSecurityActive()) : isSecurityActive();
    const nativeTop = typeof w.isAlwaysOnTop === 'function' ? !!w.isAlwaysOnTop() : null;
    if (!force && lastAlwaysOnTop === topmost && (nativeTop === null || nativeTop === topmost)) {
      return;
    }
    try {
      if (topmost) w.setAlwaysOnTop(true, 'screen-saver');
      else w.setAlwaysOnTop(false);
      lastAlwaysOnTop = topmost;
      traceEvent('sync_topmost', { targetTopmost: topmost, force });
    } catch {}
  }

  function syncFocusAndTaskbar(force = false) {
    const w = activeWin();
    if (!w || isWrittenCompact() || syncingFocus) return;
    syncingFocus = true;
    try {
      const wasVisible = typeof w.isVisible === 'function' ? !!w.isVisible() : true;
      const wasMinimized = typeof w.isMinimized === 'function' ? !!w.isMinimized() : false;
      // Home mode is ALWAYS focusable so restart/return never locks the main UI.
      const focusable = !isFloatingMode()
        ? true
        : (tempFocus || (!effectivePreventFocus() && !clickThrough));
      let focusChanged = false;
      try {
        const current = typeof w.isFocusable === 'function' ? w.isFocusable() : undefined;
        // CRITICAL Windows fix: Electron's setFocusable(false) calls Chromium HWNDMessageHandler::Deactivate(),
        // which walks GW_HWNDNEXT and calls SetForegroundWindow(nextTopmostHwnd) — stealing foreground focus
        // from the user's active editor! NEVER call setFocusable(false) when the window is already non-focusable.
        const needFocusChange = current === undefined
          ? (force || !focusable)
          : (current !== focusable);
        if (needFocusChange) {
          // Release active Win32 focus cleanly once before switching WS_EX_NOACTIVATE, guarded by syncingFocus against blur re-entrancy.
          if (!focusable && typeof w.blur === 'function' && (typeof w.isFocused !== 'function' || w.isFocused())) {
            try { w.blur(); } catch {}
          }
          w.setFocusable(focusable);
          focusChanged = true;
          traceEvent('sync_focusable', { targetFocusable: focusable, prevFocusable: current });
        }
      } catch {}

      const nextSkip = !!shouldSkipTaskbar();
      if (force || lastSkipTaskbar !== nextSkip) {
        try {
          w.setSkipTaskbar(nextSkip);
          lastSkipTaskbar = nextSkip;
          traceEvent('sync_skip_taskbar', { targetSkipTaskbar: nextSkip });
        } catch {}
      }

      // Critical Windows fix:
      // 1) setFocusable(false) drops z-order via Focus(false), so re-assert alwaysOnTop and mouse interactivity right after.
      // 2) If Win32 style mutation (WS_EX_TOOLWINDOW / WS_EX_NOACTIVATE) unexpectedly hides an active non-minimized window, self-heal immediately.
      if (focusChanged && !focusable) {
        syncAlwaysOnTop(true);
        syncMousePassthrough(true);
      }
      if (wasVisible && !wasMinimized && typeof w.isVisible === 'function' && !w.isVisible()) {
        try {
          if (focusable && typeof w.show === 'function') w.show();
          else if (typeof w.showInactive === 'function') w.showInactive();
          else if (typeof w.show === 'function') w.show();
          syncAlwaysOnTop(true);
          syncMousePassthrough(true);
          scheduleEnsureRenderHostVisible('visibility_self_healed');
          traceEvent('visibility_self_healed', { targetFocusable: focusable });
        } catch {}
      }
    } finally {
      syncingFocus = false;
    }
  }

  // Unified SuiSi-style mouse passthrough state machine:
  // ignores pointer when hidden by hover-reveal OR when clickThrough is ON outside interactive regions.
  function syncMousePassthrough(force = false) {
    const w = activeWin();
    if (!w || isWrittenCompact()) return;
    const shouldIgnore = isFloatingMode() && (hoverHidden || (clickThrough && !mouseInteractive));
    if (!force && lastIgnoreMouse === shouldIgnore) return;
    try {
      if (shouldIgnore) w.setIgnoreMouseEvents(true, { forward: true });
      else w.setIgnoreMouseEvents(false);
      lastIgnoreMouse = shouldIgnore;
      traceEvent('sync_mouse_passthrough', { shouldIgnore, force });
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
      const prevInside = hoverInside;
      hoverInside = inside;
      setHoverHiddenNative(!!p.hoverReveal && !inside && !hoverBlocked);
      if (inside !== prevInside) {
        traceEvent('hover_change', { inside, cursor: pt });
      }
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
    if (!w || clickThrough || isWindowMaximized(w)) return false;
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
      lastRestoredBounds = null;
      lastRestoredPhysRect = null;
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

  function saveCurrentModeBounds({ explicit = false } = {}) {
    const w = activeWin();
    if (!w || applyingBounds || (!explicit && Date.now() < boundsSaveSuppressUntil) || isWrittenCompact() || w.isMinimized?.() || isWindowMaximized(w)) return;
    const raw = w.getNormalBounds ? w.getNormalBounds() : w.getBounds();
    if (!raw || raw.width < 120 || raw.height < 80) return;
    const clean = { x: Math.round(raw.x), y: Math.round(raw.y), width: Math.round(raw.width), height: Math.round(raw.height) };
    const phys = typeof winNative?.getPhysicalRect === 'function' ? winNative.getPhysicalRect(w) : null;
    if (phys) {
      if (lastRestoredPhysRect && boundsNearlyEqual(phys, lastRestoredPhysRect, 1) && stableNormalPhysRect && boundsNearlyEqual(phys, stableNormalPhysRect, 1)) {
        return;
      }
      lastRestoredPhysRect = null;
      stableNormalPhysRect = { ...phys };
      modePhysRects.set(mode, { ...phys });
    } else if (lastRestoredBounds && boundsNearlyEqual(clean, lastRestoredBounds, 4) && stableNormalBounds && boundsNearlyEqual(clean, stableNormalBounds, 6)) {
      // Ignore fractional-DPI post-unmaximize rounding jitter near the restored snapshot so it never overwrites the true normal baseline.
      return;
    }
    lastRestoredBounds = null;
    lastNormalBounds = { ...clean };
    stableNormalBounds = { ...clean };
    const { key } = modeBoundsSpec(mode);
    try {
      prefs.applyPatch({ [key]: clean }, { silent: true });
    } catch {}
  }

  function scheduleBoundsSave() {
    if (applyingBounds || Date.now() < boundsSaveSuppressUntil || isWrittenCompact()) return;
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      saveCurrentModeBounds();
    }, 180);
    boundsTimer.unref?.();
  }

  function boundsErrorScore(actual, target) {
    if (!actual || !target) return Infinity;
    return (
      Math.abs(actual.x - target.x) +
      Math.abs(actual.y - target.y) +
      Math.abs(actual.width - target.width) +
      Math.abs(actual.height - target.height)
    );
  }

  function restoreExactBounds(target, label = 'restore_exact_bounds', targetPhys = null) {
    const w = activeWin();
    if (!w || (!target && !targetPhys)) return;
    const { min: [minW, minH] } = modeBoundsSpec(mode);
    const clean = target ? {
      x: Math.round(target.x),
      y: Math.round(target.y),
      width: Math.max(minW, Math.round(target.width)),
      height: Math.max(minH, Math.round(target.height))
    } : null;
    applyingBounds = true;
    boundsSaveSuppressUntil = Date.now() + 650;
    try {
      let actual = null;
      let bestCmd = clean;
      let compensated = false;
      if (clean) {
        w.setBounds(clean, false);
        actual = typeof w.getBounds === 'function' ? w.getBounds() : null;
        let bestScore = boundsErrorScore(actual, clean);

        // Windows fractional DPI (e.g. 125% / 150%) on frameless transparent BrowserWindow can round
        // setBounds(W, H) upward by +1..+4 DIP on every cycle. Probe compensated DIP inputs to cancel
        // the upward bias and keep the final physical size anchored to the original baseline.
        if (actual && bestScore > 0) {
          const errW = actual.width - clean.width;
          const errH = actual.height - clean.height;
          const probes = [];
          if ((errW !== 0 && Math.abs(errW) <= 6) || (errH !== 0 && Math.abs(errH) <= 6)) {
            probes.push({
              x: clean.x,
              y: clean.y,
              width: Math.max(minW, clean.width - (Math.abs(errW) <= 6 ? errW : 0)),
              height: Math.max(minH, clean.height - (Math.abs(errH) <= 6 ? errH : 0))
            });
            if (Math.abs(errW) >= 2 || Math.abs(errH) >= 2) {
              probes.push({
                x: clean.x,
                y: clean.y,
                width: Math.max(minW, clean.width - Math.trunc(errW / 2)),
                height: Math.max(minH, clean.height - Math.trunc(errH / 2))
              });
            }
          }
          for (const candidate of probes) {
            w.setBounds(candidate, false);
            const got = typeof w.getBounds === 'function' ? w.getBounds() : null;
            const score = boundsErrorScore(got, clean);
            if (score < bestScore) {
              bestScore = score;
              bestCmd = candidate;
              actual = got;
              compensated = true;
              if (score === 0) break;
            }
          }
          if (compensated) {
            const cur = typeof w.getBounds === 'function' ? w.getBounds() : null;
            if (boundsErrorScore(cur, clean) > bestScore) {
              w.setBounds(bestCmd, false);
              actual = typeof w.getBounds === 'function' ? w.getBounds() : actual;
            }
          } else if (actual) {
            const cur = typeof w.getBounds === 'function' ? w.getBounds() : null;
            if (boundsErrorScore(cur, clean) > bestScore) {
              w.setBounds(clean, false);
              actual = typeof w.getBounds === 'function' ? w.getBounds() : actual;
            }
          }
        }
      }

      // On Windows fractional DPI, physical pixel sizes like 1382x922 cannot be represented losslessly
      // in integer DIPs; apply exact Win32 SetWindowPos physical rect when available.
      const applyMode = mode;
      const applyPhysResult = (actualPhys) => {
        if (!actualPhys || mode !== applyMode) return;
        lastRestoredPhysRect = { ...actualPhys };
        stableNormalPhysRect = { ...targetPhys };
        modePhysRects.set(applyMode, { ...targetPhys });
        boundsSaveSuppressUntil = Math.max(boundsSaveSuppressUntil, Date.now() + 650);
        const curDip = typeof activeWin()?.getBounds === 'function' ? activeWin().getBounds() : null;
        if (curDip) lastRestoredBounds = { ...curDip };
        traceEvent(`${label}_phys`, { targetPhys, actualPhys });
      };

      let actualPhys = null;
      if (targetPhys && typeof winNative?.setPhysicalRect === 'function') {
        const resPhys = winNative.setPhysicalRect(w, targetPhys);
        if (resPhys && typeof resPhys.then === 'function') {
          boundsSaveSuppressUntil = Date.now() + 900;
          lastRestoredPhysRect = { ...targetPhys };
          stableNormalPhysRect = { ...targetPhys };
          modePhysRects.set(applyMode, { ...targetPhys });
          resPhys.then((got) => {
            if (got && mode === applyMode && activeWin() && !isWindowMaximized(activeWin()) && !activeWin().isMinimized?.()) {
              applyPhysResult(got);
            }
          }).catch(() => {});
        } else if (resPhys) {
          actualPhys = resPhys;
          applyPhysResult(resPhys);
          actual = typeof w.getBounds === 'function' ? w.getBounds() : actual;
        }
      }

      if (clean) lastNormalBounds = { ...clean };
      lastRestoredBounds = actual ? { ...actual } : (clean ? { ...clean } : null);
      traceEvent(label, { targetBounds: clean, appliedCmd: bestCmd, actualBounds: actual, compensated, targetPhys, actualPhys });
    } catch {} finally {
      applyingBounds = false;
    }
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
    const savedPhys = modePhysRects.get(targetMode) || null;
    applyingBounds = true;
    try {
      if (isFloatingMode(targetMode) && w.isMaximized?.()) {
        w.unmaximize();
      }
      w.setMinimumSize(minW, minH);
    } finally {
      applyingBounds = false;
    }
    restoreExactBounds(bounds, 'apply_mode_layout', savedPhys);
    stableNormalBounds = { ...bounds };
    if (!savedPhys && typeof winNative?.getPhysicalRect === 'function') {
      const livePhys = winNative.getPhysicalRect(w);
      if (livePhys) {
        stableNormalPhysRect = { ...livePhys };
        modePhysRects.set(targetMode, { ...livePhys });
      }
    }
  }

  function setMode(nextMode) {
    if (!ALL_WINDOW_MODES.has(nextMode)) {
      throw new Error('未知窗口模式：' + nextMode);
    }
    const prevMode = mode;
    const changed = mode !== nextMode;
    if (changed) {
      const w = activeWin();
      if (w && !isWrittenCompact() && !w.isMinimized?.() && !isWindowMaximized(w) && typeof winNative?.getPhysicalRect === 'function') {
        const livePhys = winNative.getPhysicalRect(w);
        if (livePhys && (!lastRestoredPhysRect || !boundsNearlyEqual(livePhys, lastRestoredPhysRect, 1) || !modePhysRects.has(prevMode))) {
          modePhysRects.set(prevMode, { ...livePhys });
        }
      }
      saveCurrentModeBounds({ explicit: true });
    }
    dragStart = null;
    if (changed) {
      clearPseudoMaximize();
      clearUnmaximizeSettleTimers();
      preMaximizeBounds = null;
      preMaximizePhysRect = null;
      stableNormalBounds = null;
      stableNormalPhysRect = null;
      lastRestoredBounds = null;
      lastRestoredPhysRect = null;
    }
    mode = nextMode;
    hoverHidden = false;
    if (mode === 'home') {
      tempFocus = false;
      clickThrough = false;
      mouseInteractive = false;
      hoverBlocked = false;
      prefs.applyPatch({ clickThrough: false }, { silent: true, save: false });
    } else if (changed) {
      // Entering a floating window starts expanded & interactive until hover polling explicitly sees the cursor leave.
      hoverInside = true;
      try { onHoverChange(true); } catch {}
    }
    if (!isWrittenCompact()) {
      applyModeLayout(mode);
      syncAlwaysOnTop();
      syncFocusAndTaskbar();
      syncMousePassthrough(true);
      if (changed && mode === 'home') {
        const active = activeWin();
        try { active?.focus(); } catch {}
      }
    }
    syncHoverPolling();
    traceEvent('set_mode', { prevMode, nextMode: mode, changed });
    emitState();
    return getWindowState();
  }

  function setAlwaysOnTop(on) {
    const next = !!on;
    if (isSecurityActive() && !next) {
      throw new Error('安全模式已开启，窗口置顶已锁定');
    }
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
    // On Windows, transparent frameless windows with screen-saver topmost + skipTaskbar can silently ignore SW_MINIMIZE.
    // Temporarily release topmost & skipTaskbar before minimizing; restore/show handlers re-sync them automatically.
    try {
      if (isSecurityActive() || shouldSkipTaskbar() || w.isAlwaysOnTop?.()) {
        w.setAlwaysOnTop(false);
        w.setSkipTaskbar(false);
        lastAlwaysOnTop = false;
        lastSkipTaskbar = false;
      }
    } catch {}
    w.minimize();
    traceEvent('minimize');
    emitState();
    return true;
  }

  function scheduleUnmaximizeSettle(target, targetPhys = null) {
    clearUnmaximizeSettleTimers();
    if (!target && !targetPhys) return;
    for (const delay of [120, 260]) {
      const id = setTimeout(() => {
        unmaximizeSettleTimers = unmaximizeSettleTimers.filter(t => t !== id);
        const active = activeWin();
        if (!active || isWindowMaximized(active) || active.isMinimized?.()) return;
        if (targetPhys && typeof winNative?.getPhysicalRect === 'function') {
          const nowPhys = winNative.getPhysicalRect(active);
          if (nowPhys && (nowPhys.width !== targetPhys.width || nowPhys.height !== targetPhys.height || nowPhys.x !== targetPhys.x || nowPhys.y !== targetPhys.y)) {
            restoreExactBounds(target, 'native_unmaximize_settle', targetPhys);
          }
          return;
        }
        const nowB = active.getBounds?.();
        if (target && nowB && (nowB.width !== target.width || nowB.height !== target.height || nowB.x !== target.x || nowB.y !== target.y)) {
          restoreExactBounds(target, 'native_unmaximize_settle', targetPhys);
        }
      }, delay);
      id.unref?.();
      unmaximizeSettleTimers.push(id);
    }
  }

  function toggleMaximize() {
    const w = activeWin();
    if (!w) return false;
    clearUnmaximizeSettleTimers();

    if (pseudoMaximized) {
      const target = restoreBounds || preMaximizeBounds || stableNormalBounds || lastNormalBounds || targetBoundsFor(mode);
      const targetPhys = preMaximizePhysRect || stableNormalPhysRect || modePhysRects.get(mode) || null;
      clearPseudoMaximize();
      preMaximizeBounds = null;
      preMaximizePhysRect = null;
      restoreExactBounds(target, 'pseudo_unmaximize', targetPhys);
      emitState();
      return false;
    }
    if (w.isMaximized?.()) {
      const target = preMaximizeBounds || stableNormalBounds || lastNormalBounds || targetBoundsFor(mode);
      const targetPhys = preMaximizePhysRect || stableNormalPhysRect || modePhysRects.get(mode) || null;
      applyingBounds = true;
      boundsSaveSuppressUntil = Date.now() + 650;
      try {
        w.unmaximize();
      } finally {
        applyingBounds = false;
      }
      if (target || targetPhys) {
        // Windows 125%/150% fractional DPI rounds native unmaximize bounds upward by 1–3px per cycle; clamp back to exact snapshot.
        restoreExactBounds(target, 'native_unmaximize_clamp', targetPhys);
        scheduleUnmaximizeSettle(target, targetPhys);
      }
      preMaximizeBounds = null;
      preMaximizePhysRect = null;
      emitState();
      return false;
    }
    const rawPrev = typeof w.getNormalBounds === 'function' ? w.getNormalBounds() : w.getBounds();
    const measuredPrev = rawPrev
      ? { x: Math.round(rawPrev.x), y: Math.round(rawPrev.y), width: Math.round(rawPrev.width), height: Math.round(rawPrev.height) }
      : (lastNormalBounds || targetBoundsFor(mode));
    const livePhys = typeof winNative?.getPhysicalRect === 'function' ? winNative.getPhysicalRect(w) : null;
    if (livePhys) {
      const chosenPhys = (stableNormalPhysRect && lastRestoredPhysRect && boundsNearlyEqual(livePhys, lastRestoredPhysRect, 1))
        ? { ...stableNormalPhysRect }
        : { ...livePhys };
      preMaximizePhysRect = { ...chosenPhys };
      stableNormalPhysRect = { ...chosenPhys };
      modePhysRects.set(mode, { ...chosenPhys });
    } else {
      preMaximizePhysRect = stableNormalPhysRect ? { ...stableNormalPhysRect } : null;
    }
    // Reuse the true normal-state anchor if the measured bounds only differ by fractional-DPI rounding from the last restore.
    const prevBounds = (stableNormalBounds && lastRestoredBounds && boundsNearlyEqual(measuredPrev, lastRestoredBounds, 4) && (!livePhys || !stableNormalPhysRect || boundsNearlyEqual(livePhys, stableNormalPhysRect, 2)))
      ? { ...stableNormalBounds }
      : measuredPrev;
    preMaximizeBounds = prevBounds ? { ...prevBounds } : null;
    if (prevBounds) {
      lastNormalBounds = { ...prevBounds };
      stableNormalBounds = { ...prevBounds };
    }

    try { w.maximize(); } catch {}
    // Fallback for Windows transparent frameless BrowserWindow where native maximize() is silently ignored.
    if (!w.isMaximized?.()) {
      const display = screen.getDisplayMatching ? screen.getDisplayMatching(prevBounds) : screen.getPrimaryDisplay();
      const work = display?.workArea;
      if (work && work.width >= 320 && work.height >= 240) {
        restoreBounds = { ...prevBounds };
        pseudoMaximized = true;
        applyingBounds = true;
        boundsSaveSuppressUntil = Date.now() + 300;
        try {
          w.setBounds({ x: work.x, y: work.y, width: work.width, height: work.height }, false);
        } finally {
          applyingBounds = false;
        }
      }
    }
    traceEvent('maximize', { preMaximizeBounds, preMaximizePhysRect, measuredPrev, pseudoMaximized });
    emitState();
    return isWindowMaximized(w);
  }

  function recoverWindow({ exitSecurity = false, source = 'recover_window' } = {}) {
    const w = activeWin();
    if (!w) return getWindowState();
    recordShowRequest(source);
    if (exitSecurity && isSecurityActive()) {
      disableSecurity({ scope: 'persistent', clearAutoLaunch: false });
    }
    clickThrough = false;
    mouseInteractive = false;
    hoverHidden = false;
    hoverInside = true;
    const focusable = !isFloatingMode() || (!effectivePreventFocus() && !clickThrough);
    const wantTopmost = isFloatingMode() ? (!!prefs.getPublic().alwaysOnTop || isSecurityActive()) : isSecurityActive();
    if (focusable) {
      resetNativeStyleCache();
    } else {
      // Keep lastSkipTaskbar / lastAlwaysOnTop caches intact so non-focusable recover does NOT re-trigger
      // redundant Win32 style mutations or Deactivate() that steal foreground focus from external editors.
      lastIgnoreMouse = null;
    }
    inRecoverShow = true;
    try {
      if (w.isMinimized?.()) w.restore();
      if (focusable) {
        w.show?.();
        w.focus?.();
        w.moveTop?.();
      } else if (typeof w.showInactive === 'function') {
        w.showInactive();
      } else {
        w.show?.();
      }
    } catch {} finally {
      inRecoverShow = false;
    }
    syncAlwaysOnTop(false);
    syncFocusAndTaskbar(false);
    syncMousePassthrough(false);
    scheduleEnsureRenderHostVisible(source, { raiseTopmost: !focusable && wantTopmost });
    syncHoverPolling();
    try { onHoverChange(true); } catch {}
    traceEvent('recover_window', { exitSecurity, source, focusable });
    emitState();
    return getWindowState();
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
    const requestedScope = options.scope === 'persistent' ? 'persistent' : 'session';
    const current = prefs.getPublic();
    const wasEnabled = current.securityMode.enabled;
    // Never downgrade an active persistent security scope when a session starts!
    const scope = (wasEnabled && current.securityMode.scope === 'persistent') ? 'persistent' : requestedScope;
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
    syncAlwaysOnTop(true);
    syncFocusAndTaskbar();
    traceEvent('enable_security', { requestedScope, effectiveScope: scope, wasEnabled });
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
      if (isSecurityActive()) { emitState(); return; }
      try { setAlwaysOnTop(!prefs.getPublic().alwaysOnTop); } catch {}
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
    const errs = registerHotkeys();
    try { onHotkeysChanged(); } catch {}
    const finalState = getWindowState();
    return {
      ...finalState,
      hotkeyErrors: finalState.hotkeyErrors?.length ? finalState.hotkeyErrors : errs
    };
  }

  function attach(window) {
    win = window;
    if (!win) return;
    resetNativeStyleCache();

    const recovered = prefs.consumeRecoveredSessionSecurity?.();
    if (recovered && typeof recovered.savedAllowCapture === 'boolean') {
      setStealth(!recovered.savedAllowCapture);
    } else if (isSecurityActive()) {
      setStealth(true);
    }

    win.on('resize', scheduleBoundsSave);
    win.on('move', scheduleBoundsSave);
    if (!win.isMaximized?.() && !win.isMinimized?.()) {
      const initRaw = typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds?.();
      if (initRaw && initRaw.width >= 120 && initRaw.height >= 80) {
        const initClean = {
          x: Math.round(initRaw.x),
          y: Math.round(initRaw.y),
          width: Math.round(initRaw.width),
          height: Math.round(initRaw.height)
        };
        lastNormalBounds = { ...initClean };
        stableNormalBounds = { ...initClean };
      }
      const initPhys = typeof winNative?.getPhysicalRect === 'function' ? winNative.getPhysicalRect(win) : null;
      if (initPhys) {
        stableNormalPhysRect = { ...initPhys };
        modePhysRects.set(mode, { ...initPhys });
      }
    }
    win.on('maximize', () => {
      if (!preMaximizeBounds && (stableNormalBounds || lastNormalBounds)) {
        preMaximizeBounds = { ...(stableNormalBounds || lastNormalBounds) };
      }
      if (!preMaximizePhysRect && (stableNormalPhysRect || modePhysRects.get(mode))) {
        preMaximizePhysRect = { ...(stableNormalPhysRect || modePhysRects.get(mode)) };
      }
      traceEvent('win_maximize');
      emitState();
    });
    win.on('unmaximize', () => {
      traceEvent('win_unmaximize');
      const target = preMaximizeBounds || stableNormalBounds;
      const targetPhys = preMaximizePhysRect || stableNormalPhysRect || modePhysRects.get(mode) || null;
      if ((target || targetPhys) && !applyingBounds) {
        preMaximizeBounds = null;
        preMaximizePhysRect = null;
        restoreExactBounds(target, 'win_unmaximize_clamp', targetPhys);
        scheduleUnmaximizeSettle(target, targetPhys);
      }
      emitState();
    });
    win.on('minimize', () => { stopHoverPolling(); setHoverHiddenNative(false); traceEvent('win_minimize'); emitState(); });
    win.on('restore', () => {
      const focusable = !isFloatingMode() || (!effectivePreventFocus() && !clickThrough);
      const wantTopmost = isFloatingMode() ? (!!prefs.getPublic().alwaysOnTop || isSecurityActive()) : isSecurityActive();
      if (focusable) resetNativeStyleCache();
      else lastIgnoreMouse = null;
      syncAlwaysOnTop(false);
      syncFocusAndTaskbar(false);
      syncMousePassthrough(false);
      if (!inRecoverShow) scheduleEnsureRenderHostVisible('win_restore', { raiseTopmost: !focusable && wantTopmost });
      syncHoverPolling();
      traceEvent('win_restore');
      emitState();
    });
    win.on('show', () => {
      const showSrc = consumePendingSource('show');
      const focusable = !isFloatingMode() || (!effectivePreventFocus() && !clickThrough);
      const wantTopmost = isFloatingMode() ? (!!prefs.getPublic().alwaysOnTop || isSecurityActive()) : isSecurityActive();
      if (focusable) resetNativeStyleCache();
      else lastIgnoreMouse = null;
      syncAlwaysOnTop(false);
      syncFocusAndTaskbar(false);
      syncMousePassthrough(false);
      if (!inRecoverShow) scheduleEnsureRenderHostVisible(showSrc, { raiseTopmost: !focusable && wantTopmost });
      syncHoverPolling();
      traceEvent('win_show', { source: showSrc });
      emitState();
    });
    win.on('hide', () => {
      clearRenderEnsureTimers();
      stopHoverPolling();
      setHoverHiddenNative(false);
      traceEvent('win_hide', { source: consumePendingSource('hide') });
      emitState();
    });
    win.on('blur', () => {
      if (syncingFocus) return;
      if (tempFocus) {
        tempFocus = false;
        syncFocusAndTaskbar();
        traceEvent('win_blur_temp_focus');
        emitState();
      } else if (isFloatingMode()) {
        syncAlwaysOnTop();
      }
    });
    win.on('closed', () => {
      stopHoverPolling();
      clearTimeout(boundsTimer);
      boundsTimer = null;
      clearUnmaximizeSettleTimers();
      clearRenderEnsureTimers();
      dragStart = null;
      resetNativeStyleCache();
      win = null;
    });

    if (!isWrittenCompact()) {
      syncAlwaysOnTop(true);
      syncFocusAndTaskbar(true);
      syncMousePassthrough(true);
    }
    syncHoverPolling();
    traceEvent('attach');
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
    clearUnmaximizeSettleTimers();
    clearRenderEnsureTimers();
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
    recoverWindow,
    recordHideRequest,
    recordShowRequest,
    traceEvent,
    getTrace,
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
