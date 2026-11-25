'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SIDE_PANE_TABS = ['evidence', 'transcript', 'translate'];
const TRANSCRIPTION_MODES = ['auto', 'manual', 'transcript-only'];
const CODING_MODES = ['normal', 'coding'];
const CODING_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'typescript', 'go', 'sql', 'other'];
const CODING_EXPLAIN_MODES = ['concise', 'detailed', 'code-only'];
const SECURITY_SCOPES = ['session', 'persistent'];

const DEFAULT_PREFS = Object.freeze({
  version: 1,
  fontSize: 14,
  bgOpacity: 82,
  iconTextOpacity: 100,
  answerTextOpacity: 100,
  hoverOpacity: 8,
  hoverReveal: false,
  autoCollapseChrome: false,
  preventFocus: false,
  clickThrough: false,
  alwaysOnTop: true,
  captureDisplayId: '',
  leftPaneRatio: 0.5,
  leftPaneCollapsed: false,
  sidePaneOpen: false,
  sidePaneTab: 'evidence',
  sidePaneWidth: 300,
  transcriptionMode: 'auto',
  autoSaveOnClose: true,
  codingPrefs: Object.freeze({
    mode: 'normal',
    language: 'python',
    explainMode: 'concise',
    includeComplexity: true,
    includeEdgeCases: true,
    extraInstruction: ''
  }),
  securityMode: Object.freeze({
    enabled: false,
    scope: 'session',
    autoEnableOnLaunch: false,
    savedPreventFocus: null,
    savedAllowCapture: null
  }),
  hotkeys: Object.freeze({
    togglePreventFocus: 'Control+Shift+8',
    toggleClickThrough: 'Control+Shift+9'
  }),
  homeBounds: null,
  workbenchBounds: null
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  if (width < 120 || height < 80) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function normalizeCodingPrefs(raw, base = DEFAULT_PREFS.codingPrefs) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    mode: CODING_MODES.includes(src.mode) ? src.mode : base.mode,
    language: CODING_LANGUAGES.includes(src.language) ? src.language : base.language,
    explainMode: CODING_EXPLAIN_MODES.includes(src.explainMode) ? src.explainMode : base.explainMode,
    includeComplexity: typeof src.includeComplexity === 'boolean' ? src.includeComplexity : base.includeComplexity,
    includeEdgeCases: typeof src.includeEdgeCases === 'boolean' ? src.includeEdgeCases : base.includeEdgeCases,
    extraInstruction: src.extraInstruction !== undefined ? String(src.extraInstruction).slice(0, 600) : base.extraInstruction
  };
}

function normalizeSecurityMode(raw, base = DEFAULT_PREFS.securityMode) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : base.enabled,
    scope: SECURITY_SCOPES.includes(src.scope) ? src.scope : base.scope,
    autoEnableOnLaunch: typeof src.autoEnableOnLaunch === 'boolean' ? src.autoEnableOnLaunch : base.autoEnableOnLaunch,
    savedPreventFocus: typeof src.savedPreventFocus === 'boolean'
      ? src.savedPreventFocus
      : src.savedPreventFocus === null
        ? null
        : base.savedPreventFocus,
    savedAllowCapture: typeof src.savedAllowCapture === 'boolean'
      ? src.savedAllowCapture
      : src.savedAllowCapture === null
        ? null
        : base.savedAllowCapture
  };
}

function normalizeHotkeys(raw, base = DEFAULT_PREFS.hotkeys) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    togglePreventFocus: src.togglePreventFocus !== undefined ? String(src.togglePreventFocus).trim().slice(0, 40) : base.togglePreventFocus,
    toggleClickThrough: src.toggleClickThrough !== undefined ? String(src.toggleClickThrough).trim().slice(0, 40) : base.toggleClickThrough
  };
}

function clonePrefs(state) {
  return {
    ...state,
    codingPrefs: { ...state.codingPrefs },
    securityMode: { ...state.securityMode },
    hotkeys: { ...state.hotkeys },
    homeBounds: state.homeBounds ? { ...state.homeBounds } : null,
    workbenchBounds: state.workbenchBounds ? { ...state.workbenchBounds } : null
  };
}

function normalizePrefs(raw, base = DEFAULT_PREFS) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    version: 1,
    fontSize: clampInt(src.fontSize, 10, 24, base.fontSize),
    bgOpacity: clampInt(src.bgOpacity, 0, 100, base.bgOpacity),
    iconTextOpacity: clampInt(src.iconTextOpacity, 0, 100, base.iconTextOpacity),
    answerTextOpacity: clampInt(src.answerTextOpacity, 0, 100, base.answerTextOpacity),
    hoverOpacity: clampInt(src.hoverOpacity, 0, 50, base.hoverOpacity),
    hoverReveal: typeof src.hoverReveal === 'boolean' ? src.hoverReveal : base.hoverReveal,
    autoCollapseChrome: typeof src.autoCollapseChrome === 'boolean' ? src.autoCollapseChrome : base.autoCollapseChrome,
    preventFocus: typeof src.preventFocus === 'boolean' ? src.preventFocus : base.preventFocus,
    clickThrough: typeof src.clickThrough === 'boolean' ? src.clickThrough : base.clickThrough,
    alwaysOnTop: typeof src.alwaysOnTop === 'boolean' ? src.alwaysOnTop : base.alwaysOnTop,
    captureDisplayId: src.captureDisplayId !== undefined ? String(src.captureDisplayId).trim().slice(0, 64) : base.captureDisplayId,
    leftPaneRatio: clampFloat(src.leftPaneRatio, 0.28, 0.72, base.leftPaneRatio),
    leftPaneCollapsed: typeof src.leftPaneCollapsed === 'boolean' ? src.leftPaneCollapsed : base.leftPaneCollapsed,
    sidePaneOpen: typeof src.sidePaneOpen === 'boolean' ? src.sidePaneOpen : base.sidePaneOpen,
    sidePaneTab: SIDE_PANE_TABS.includes(src.sidePaneTab) ? src.sidePaneTab : base.sidePaneTab,
    sidePaneWidth: clampInt(src.sidePaneWidth, 180, 560, base.sidePaneWidth),
    transcriptionMode: TRANSCRIPTION_MODES.includes(src.transcriptionMode) ? src.transcriptionMode : base.transcriptionMode,
    autoSaveOnClose: typeof src.autoSaveOnClose === 'boolean' ? src.autoSaveOnClose : base.autoSaveOnClose,
    codingPrefs: normalizeCodingPrefs(src.codingPrefs, base.codingPrefs),
    securityMode: normalizeSecurityMode(src.securityMode, base.securityMode),
    hotkeys: normalizeHotkeys(src.hotkeys, base.hotkeys),
    homeBounds: src.homeBounds === null ? null : (src.homeBounds !== undefined ? normalizeBounds(src.homeBounds) : base.homeBounds),
    workbenchBounds: src.workbenchBounds === null ? null : (src.workbenchBounds !== undefined ? normalizeBounds(src.workbenchBounds) : base.workbenchBounds)
  };
}

function createWorkbenchPrefs({ file, onChange = () => {} }) {
  let state = clonePrefs(DEFAULT_PREFS);
  let recoveredSessionSecurity = null;

  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = normalizePrefs(parsed, DEFAULT_PREFS);
    }
  } catch {
    state = clonePrefs(DEFAULT_PREFS);
  }

  // Click-through is strictly transient; a restart always restores pointer interaction.
  state.clickThrough = false;

  // Recover cleanly if a previous session exited unexpectedly with session-scoped security mode on.
  if (state.securityMode.autoEnableOnLaunch) {
    state.securityMode.enabled = true;
    state.securityMode.scope = 'persistent';
  } else if (state.securityMode.enabled && state.securityMode.scope === 'session') {
    recoveredSessionSecurity = {
      savedPreventFocus: state.securityMode.savedPreventFocus,
      savedAllowCapture: state.securityMode.savedAllowCapture
    };
    if (typeof state.securityMode.savedPreventFocus === 'boolean') {
      state.preventFocus = state.securityMode.savedPreventFocus;
    }
    state.securityMode.enabled = false;
    state.securityMode.savedPreventFocus = null;
    state.securityMode.savedAllowCapture = null;
  }

  function persist(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const toDisk = clonePrefs(next);
    toDisk.clickThrough = false;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(toDisk, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function getPublic() {
    return clonePrefs(state);
  }

  function consumeRecoveredSessionSecurity() {
    const out = recoveredSessionSecurity;
    recoveredSessionSecurity = null;
    return out;
  }

  function applyPatch(patch, { silent = false, save = true } = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('工作台偏好参数无效');
    }
    const next = normalizePrefs(patch, state);
    if (save) persist(next);
    state = next;
    const pub = getPublic();
    if (!silent) {
      try { onChange(pub); } catch {}
    }
    return pub;
  }

  return {
    getPublic,
    applyPatch,
    consumeRecoveredSessionSecurity
  };
}

module.exports = {
  createWorkbenchPrefs,
  normalizePrefs,
  DEFAULT_PREFS
};
