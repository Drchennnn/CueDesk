'use strict';
const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_BINDINGS = Object.freeze({ left: 'Control+Alt+Left', right: 'Control+Alt+Right', up: 'Control+Alt+Up', down: 'Control+Alt+Down', grow: 'Control+Alt+PageUp', shrink: 'Control+Alt+PageDown', toggleBatch: 'Control+Alt+M', sendBatch: 'Control+Alt+S' });
const ACTIONS = Object.keys(DEFAULT_BINDINGS);
function accelerator(value) {
  if (typeof value !== 'string') throw new Error('快捷键必须是文本');
  if (!value.trim()) return '';
  const parts = value.trim().split('+').map(s => s.trim());
  const aliases = { ctrl: 'Control', control: 'Control', commandorcontrol: 'Control', cmdorctrl: 'Control', alt: 'Alt', shift: 'Shift', super: 'Super', win: 'Super', meta: 'Super' };
  const modifiers = parts.slice(0, -1).map(s => aliases[s.toLowerCase()]);
  if (modifiers.some(s => !s) || new Set(modifiers).size !== modifiers.length || !modifiers.length) throw new Error('快捷键需包含修饰键和一个按键，例如 Control+Alt+Left');
  const raw = parts.at(-1).toLowerCase();
  const keys = { left: 'Left', arrowleft: 'Left', right: 'Right', arrowright: 'Right', up: 'Up', arrowup: 'Up', down: 'Down', arrowdown: 'Down', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End', space: 'Space', insert: 'Insert', delete: 'Delete', plus: 'Plus', minus: '-', '-': '-', '=': '=', ',': ',', '.': '.' };
  const key = keys[raw] || (/^(?:[a-z0-9]|f(?:[1-9]|1\d|2[0-4]))$/.test(raw) ? raw.toUpperCase() : null);
  if (!key) throw new Error('不支持此快捷键按键');
  return ['Control', 'Alt', 'Shift', 'Super'].filter(s => modifiers.includes(s)).concat(key).join('+');
}
function createWindowControls({ file, screen, shortcuts, getWindow = () => null, onChange = () => {}, onAction = () => {}, getReservedShortcuts = () => [] }) {
  let state = { opacity: 1, zoomFactor: 1, moveStep: 20, bindings: { ...DEFAULT_BINDINGS } };
  let errors = [], status = '', attached = null, disposed = false;
  const owned = new Set();
  function validate(patch, base = state) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('窗口设置无效');
    if (patch.opacity !== undefined && (!Number.isFinite(patch.opacity) || patch.opacity < 0.2 || patch.opacity > 1)) throw new Error('窗口不透明度范围为 20%–100%');
    if (patch.zoomFactor !== undefined && (!Number.isFinite(patch.zoomFactor) || patch.zoomFactor < 0.5 || patch.zoomFactor > 2)) throw new Error('内容缩放范围为 50%–200%');
    if (patch.moveStep !== undefined && (!Number.isInteger(patch.moveStep) || patch.moveStep < 1 || patch.moveStep > 200)) throw new Error('移动步长范围为 1–200');
    if (patch.bindings !== undefined && (!patch.bindings || typeof patch.bindings !== 'object' || Array.isArray(patch.bindings))) throw new Error('快捷键设置无效');
    const bindings = { ...base.bindings };
    for (const [action, value] of Object.entries(patch.bindings || {})) {
      if (!ACTIONS.includes(action)) throw new Error('未知窗口操作');
      bindings[action] = accelerator(value);
    }
    const keys = Object.values(bindings).filter(Boolean);
    if (new Set(keys).size !== keys.length) throw new Error('窗口快捷键不能重复');
    return { opacity: patch.opacity ?? base.opacity, zoomFactor: patch.zoomFactor ?? base.zoomFactor, moveStep: patch.moveStep ?? base.moveStep, bindings };
  }
  try { if (fs.existsSync(file)) state = validate(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e) { errors = ['已使用默认窗口设置：' + e.message]; }
  function getPublic() { return { ...state, bindings: { ...state.bindings }, errors: [...errors], status }; }
  // A renderer disappearing must not undo a committed native shortcut transaction.
  function emit() { try { onChange(getPublic()); } catch {} }
  function window() { const w = getWindow() || attached; return w && !w.isDestroyed() ? w : null; }
  function applyVisual(w, opacity) {
    w.setOpacity(1);
    // Transparent frameless windows can ignore native opacity on some Windows
    // builds; mirror it in the document. In UI Next mode, expose as CSS token
    // so layered background/text/popover opacities stay independent.
    const script = `if(document.documentElement.dataset.uiNext==='1'){document.documentElement.style.setProperty('--mc-window-opacity',${JSON.stringify(String(opacity))});}else{document.documentElement.style.opacity=${JSON.stringify(opacity)};}`;
    const pending = w.webContents.executeJavaScript?.(script, false);
    pending?.catch?.(() => {}); // did-finish-load reapplies after navigation.
  }
  function save(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2));
    fs.renameSync(file + '.tmp', file);
  }
  function reserveKeys() {
    const raw = getReservedShortcuts() || [];
    return new Set((Array.isArray(raw) ? raw : Object.values(raw)).filter(Boolean).map(key => { try { return accelerator(key); } catch { return String(key); } }));
  }
  function stage(next) {
    const added = [];
    const keys = new Set(Object.values(next.bindings).filter(Boolean));
    const reserved = reserveKeys();
    try {
      for (const key of keys) {
        if (reserved.has(key)) throw new Error('快捷键与已有功能冲突：' + key);
        if (owned.has(key) && shortcuts.isRegistered(key)) continue;
        if (shortcuts.isRegistered(key)) throw new Error('快捷键已被占用：' + key);
        if (!shortcuts.register(key, () => {
          const action = ACTIONS.find(name => state.bindings[name] === key);
          if (action) run(action);
        })) throw new Error('无法注册快捷键（可能被其他程序占用）：' + key);
        added.push(key);
      }
    } catch (e) { for (const key of added) shortcuts.unregister(key); throw e; }
    return {
      rollback() { for (const key of added) shortcuts.unregister(key); },
      commit() {
        for (const key of owned) if (!keys.has(key)) shortcuts.unregister(key);
        owned.clear(); for (const key of keys) owned.add(key);
      }
    };
  }
  function register() {
    if (disposed) return getPublic();
    try { const transaction = stage(state); transaction.commit(); errors = []; }
    catch (e) { errors = [e.message]; }
    emit(); return getPublic();
  }
  function attach(w) {
    attached = w;
    if (!w || w.isDestroyed()) return;
    applyVisual(w, state.opacity);
    w.webContents.setZoomFactor(state.zoomFactor);
    // Chromium navigation can replace initial zoom preferences; reapply after load.
    w.webContents.on?.('did-finish-load', () => {
      if (!disposed && !w.isDestroyed()) {
        applyVisual(w, state.opacity);
        w.webContents.setZoomFactor(state.zoomFactor);
      }
    });
  }
  function applyPatch(patch) {
    if (disposed) throw new Error('窗口快捷键服务已关闭');
    let transaction = null;
    const w = window();
    try {
      const next = validate(patch);
      transaction = stage(next);
      if (w) { applyVisual(w, next.opacity); w.webContents.setZoomFactor(next.zoomFactor); }
      save(next);
      transaction.commit(); state = next; errors = []; status = ''; emit(); return getPublic();
    } catch (e) {
      transaction?.rollback();
      if (w) { try { applyVisual(w, state.opacity); w.webContents.setZoomFactor(state.zoomFactor); } catch {} }
      errors = [e.message]; emit(); throw e;
    }
  }
  function run(action) {
    if (action === 'toggleBatch' || action === 'sendBatch') { onAction(action); return; }
    const w = window();
    if (!w || !w.isVisible() || w.isMinimized() || w.isMaximized()) {
      status = '窗口隐藏、最小化或最大化时不移动/缩放'; emit(); return;
    }
    try {
      const b = w.getBounds(), next = { ...b };
      const delta = { left: [-state.moveStep, 0], right: [state.moveStep, 0], up: [0, -state.moveStep], down: [0, state.moveStep] }[action];
      let display, zoomFactor = state.zoomFactor;
      if (delta) {
        next.x += delta[0]; next.y += delta[1];
        // Choose the display at the leading edge so movement can cross adjoining monitors.
        const point = { x: delta[0] < 0 ? next.x : delta[0] > 0 ? next.x + next.width - 1 : next.x + Math.floor(next.width / 2), y: delta[1] < 0 ? next.y : delta[1] > 0 ? next.y + next.height - 1 : next.y + Math.floor(next.height / 2) };
        display = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint(point) : screen.getDisplayMatching(next);
      } else {
        display = screen.getDisplayMatching(b);
        const [minW, minH] = w.getMinimumSize();
        const lower = Math.max(minW / b.width, minH / b.height, 0.5 / state.zoomFactor);
        const upper = Math.min(display.workArea.width / b.width, display.workArea.height / b.height, 2 / state.zoomFactor);
        const factor = Math.max(lower, Math.min(upper, action === 'grow' ? 1.1 : 1 / 1.1));
        if (lower > upper || (action === 'grow' ? factor <= 1 : factor >= 1)) {
          status = '已达到窗口或内容缩放范围'; emit(); return;
        }
        next.width = Math.round(b.width * factor);
        next.height = Math.round(b.height * factor);
        if (next.width === b.width && next.height === b.height) return;
        zoomFactor = Math.max(0.5, Math.min(2, state.zoomFactor * factor));
        next.x = b.x + Math.round((b.width - next.width) / 2);
        next.y = b.y + Math.round((b.height - next.height) / 2);
      }
      const area = display.workArea;
      next.x = Math.max(area.x, Math.min(next.x, area.x + area.width - next.width));
      next.y = Math.max(area.y, Math.min(next.y, area.y + area.height - next.height));
      w.setBounds(next, false);
      if (!delta) {
        try {
          w.webContents.setZoomFactor(zoomFactor);
          const updated = { ...state, zoomFactor };
          save(updated); state = updated;
        } catch (e) {
          w.setBounds(b, false);
          w.webContents.setZoomFactor(state.zoomFactor);
          throw e;
        }
      }
      status = ''; emit();
    } catch (e) { status = e.message; emit(); }
  }
  function dispose() { for (const key of owned) shortcuts.unregister(key); owned.clear(); disposed = true; }
  return { getPublic, applyPatch, register, attach, dispose };
}
module.exports = { createWindowControls, DEFAULT_BINDINGS, accelerator };
