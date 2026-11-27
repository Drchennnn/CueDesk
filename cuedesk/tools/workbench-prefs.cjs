'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SIDE_PANE_TABS = ['evidence', 'transcript', 'translate', 'knowledge', 'launcher'];
const TRANSCRIPTION_MODES = ['auto', 'manual', 'transcript-only'];
const CODING_MODES = ['normal', 'coding'];
const CODING_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'typescript', 'go', 'sql', 'other'];
const CODING_FORMATS = ['auto', 'acm', 'core'];
const CODING_EXPLAIN_MODES = ['concise', 'detailed', 'code-only'];
const TRANSLATION_LANGUAGES = ['zh-CN', 'en', 'ja', 'ko'];
const SECURITY_SCOPES = ['session', 'persistent'];
const WRITTEN_MODES = ['fast', 'followup'];
const WRITTEN_SIMULTANEOUS_MODES = ['inherit', 'parallel', 'single'];

const WORKBENCH_HOTKEY_ACTIONS = Object.freeze([
  'questionPrev',
  'questionNext',
  'scrollUp',
  'scrollDown',
  'toggleAudioCapture',
  'manualSend',
  'clearTranscript',
  'toggleKnowledge',
  'toggleAlwaysOnTop',
  'togglePreventFocus',
  'toggleClickThrough',
  'toggleHoverReveal',
  'toggleHotkeys',
  'closeWithoutSave'
]);

const DEFAULT_WORKBENCH_HOTKEYS = Object.freeze({
  questionPrev: '',
  questionNext: '',
  scrollUp: '',
  scrollDown: '',
  toggleAudioCapture: '',
  manualSend: '',
  clearTranscript: '',
  toggleKnowledge: '',
  toggleAlwaysOnTop: '',
  togglePreventFocus: 'Control+Shift+8',
  toggleClickThrough: 'Control+Shift+9',
  toggleHoverReveal: '',
  toggleHotkeys: '',
  closeWithoutSave: ''
});

const DEFAULT_PREFS = Object.freeze({
  version: 2,
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
  sidePaneTabs: Object.freeze(['evidence']),
  sidePaneWidth: 320,
  transcriptionMode: 'auto',
  translationTargetLang: 'zh-CN',
  dialogueThinking: false,
  autoSaveOnClose: true,
  recordingDir: '',
  memoryRecallEnabled: true,
  memoryMaxChars: 1600,
  memoryAutoRemind: true,
  workbenchHotkeysEnabled: true,
  workbenchHotkeys: DEFAULT_WORKBENCH_HOTKEYS,
  codingPrefs: Object.freeze({
    mode: 'normal',
    language: 'python',
    codeFormat: 'auto',
    explainMode: 'concise',
    includeComplexity: true,
    includeEdgeCases: true,
    extraInstruction: ''
  }),
  securityMode: Object.freeze({
    enabled: false,
    scope: 'session',
    autoEnableOnLaunch: false,
    hideCursor: true,
    savedPreventFocus: null,
    savedAllowCapture: null
  }),
  hotkeys: Object.freeze({
    togglePreventFocus: 'Control+Shift+8',
    toggleClickThrough: 'Control+Shift+9'
  }),
  writtenConfig: Object.freeze({
    mode: 'fast',
    compactMini: false,
    systemPrompt: '',
    skipPreCheck: false,
    preferredEndpointId: '',
    simultaneousMode: 'inherit',
    autoSecurity: false,
    miniFontSize: 24,
    showModelNames: true
  }),
  homeBounds: null,
  workbenchBounds: null,
  writtenBounds: null,
  writtenMiniBounds: null
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
    codeFormat: CODING_FORMATS.includes(src.codeFormat) ? src.codeFormat : (base.codeFormat || 'auto'),
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
    hideCursor: typeof src.hideCursor === 'boolean' ? src.hideCursor : (base.hideCursor !== false),
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

function cleanKey(val) {
  return typeof val === 'string' ? val.trim().replace(/\s*\+\s*/g, '+').slice(0, 48) : '';
}

function normalizeWorkbenchHotkeys(raw, legacyHotkeys, base = DEFAULT_WORKBENCH_HOTKEYS) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const legacy = legacyHotkeys && typeof legacyHotkeys === 'object' && !Array.isArray(legacyHotkeys) ? legacyHotkeys : {};
  const out = {};
  for (const action of WORKBENCH_HOTKEY_ACTIONS) {
    if (src[action] !== undefined) out[action] = cleanKey(src[action]);
    else if (legacy[action] !== undefined) out[action] = cleanKey(legacy[action]);
    else out[action] = cleanKey(base[action] ?? DEFAULT_WORKBENCH_HOTKEYS[action]);
  }
  return out;
}

function normalizeSidePaneTabs(raw, activeTab, base = DEFAULT_PREFS.sidePaneTabs) {
  const list = Array.isArray(raw) ? raw : base;
  const deduped = [];
  for (const t of list) {
    if (SIDE_PANE_TABS.includes(t) && !deduped.includes(t)) deduped.push(t);
  }
  if (!deduped.length) deduped.push(SIDE_PANE_TABS.includes(activeTab) ? activeTab : 'evidence');
  if (SIDE_PANE_TABS.includes(activeTab) && !deduped.includes(activeTab)) deduped.push(activeTab);
  return deduped;
}

function normalizeWrittenConfig(raw, base = DEFAULT_PREFS.writtenConfig) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const fb = base || DEFAULT_PREFS.writtenConfig;
  return {
    mode: WRITTEN_MODES.includes(src.mode) ? src.mode : fb.mode,
    compactMini: typeof src.compactMini === 'boolean' ? src.compactMini : Boolean(fb.compactMini),
    systemPrompt: src.systemPrompt !== undefined ? String(src.systemPrompt || '').slice(0, 2000) : (fb.systemPrompt || ''),
    skipPreCheck: typeof src.skipPreCheck === 'boolean' ? src.skipPreCheck : Boolean(fb.skipPreCheck),
    preferredEndpointId: src.preferredEndpointId !== undefined ? String(src.preferredEndpointId || '').trim().slice(0, 80) : (fb.preferredEndpointId || ''),
    simultaneousMode: WRITTEN_SIMULTANEOUS_MODES.includes(src.simultaneousMode) ? src.simultaneousMode : (fb.simultaneousMode || 'inherit'),
    autoSecurity: typeof src.autoSecurity === 'boolean' ? src.autoSecurity : Boolean(fb.autoSecurity),
    miniFontSize: clampInt(src.miniFontSize, 12, 64, fb.miniFontSize ?? 24),
    showModelNames: typeof src.showModelNames === 'boolean' ? src.showModelNames : (fb.showModelNames !== false)
  };
}

function clonePrefs(state) {
  return {
    ...state,
    sidePaneTabs: [...(state.sidePaneTabs || ['evidence'])],
    workbenchHotkeys: { ...(state.workbenchHotkeys || DEFAULT_WORKBENCH_HOTKEYS) },
    codingPrefs: { ...state.codingPrefs },
    securityMode: { ...state.securityMode },
    hotkeys: { ...state.hotkeys },
    writtenConfig: { ...(state.writtenConfig || DEFAULT_PREFS.writtenConfig) },
    homeBounds: state.homeBounds ? { ...state.homeBounds } : null,
    workbenchBounds: state.workbenchBounds ? { ...state.workbenchBounds } : null,
    writtenBounds: state.writtenBounds ? { ...state.writtenBounds } : null,
    writtenMiniBounds: state.writtenMiniBounds ? { ...state.writtenMiniBounds } : null
  };
}

function normalizePrefs(raw, base = DEFAULT_PREFS) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const sidePaneTab = SIDE_PANE_TABS.includes(src.sidePaneTab) ? src.sidePaneTab : base.sidePaneTab;
  const wbHotkeys = normalizeWorkbenchHotkeys(src.workbenchHotkeys, src.hotkeys, base.workbenchHotkeys || DEFAULT_WORKBENCH_HOTKEYS);
  return {
    version: 2,
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
    sidePaneTab,
    sidePaneTabs: normalizeSidePaneTabs(src.sidePaneTabs, sidePaneTab, base.sidePaneTabs),
    sidePaneWidth: clampInt(src.sidePaneWidth, 180, 560, base.sidePaneWidth),
    transcriptionMode: TRANSCRIPTION_MODES.includes(src.transcriptionMode) ? src.transcriptionMode : base.transcriptionMode,
    translationTargetLang: TRANSLATION_LANGUAGES.includes(src.translationTargetLang) ? src.translationTargetLang : (base.translationTargetLang || 'zh-CN'),
    dialogueThinking: typeof src.dialogueThinking === 'boolean' ? src.dialogueThinking : Boolean(base.dialogueThinking),
    autoSaveOnClose: typeof src.autoSaveOnClose === 'boolean' ? src.autoSaveOnClose : base.autoSaveOnClose,
    recordingDir: src.recordingDir !== undefined ? String(src.recordingDir || '').trim().slice(0, 400) : (base.recordingDir || ''),
    memoryRecallEnabled: typeof src.memoryRecallEnabled === 'boolean' ? src.memoryRecallEnabled : (base.memoryRecallEnabled !== false),
    memoryMaxChars: clampInt(src.memoryMaxChars, 200, 3000, base.memoryMaxChars ?? 1600),
    memoryAutoRemind: typeof src.memoryAutoRemind === 'boolean' ? src.memoryAutoRemind : (base.memoryAutoRemind !== false),
    workbenchHotkeysEnabled: typeof src.workbenchHotkeysEnabled === 'boolean' ? src.workbenchHotkeysEnabled : (base.workbenchHotkeysEnabled !== false),
    workbenchHotkeys: wbHotkeys,
    codingPrefs: normalizeCodingPrefs(src.codingPrefs, base.codingPrefs),
    securityMode: normalizeSecurityMode(src.securityMode, base.securityMode),
    hotkeys: {
      togglePreventFocus: wbHotkeys.togglePreventFocus,
      toggleClickThrough: wbHotkeys.toggleClickThrough
    },
    writtenConfig: normalizeWrittenConfig(src.writtenConfig, base.writtenConfig),
    homeBounds: src.homeBounds === null ? null : (src.homeBounds !== undefined ? normalizeBounds(src.homeBounds) : base.homeBounds),
    workbenchBounds: src.workbenchBounds === null ? null : (src.workbenchBounds !== undefined ? normalizeBounds(src.workbenchBounds) : base.workbenchBounds),
    writtenBounds: src.writtenBounds === null ? null : (src.writtenBounds !== undefined ? normalizeBounds(src.writtenBounds) : base.writtenBounds),
    writtenMiniBounds: src.writtenMiniBounds === null ? null : (src.writtenMiniBounds !== undefined ? normalizeBounds(src.writtenMiniBounds) : base.writtenMiniBounds)
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
  DEFAULT_PREFS,
  DEFAULT_WORKBENCH_HOTKEYS,
  WORKBENCH_HOTKEY_ACTIONS
};
