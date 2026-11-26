/**
 * Pure diff-patch builder for MeetingCopilot settings:set.
 * Ensures:
 * 1. Untouched API key slots are omitted (never overwritten with empty string).
 * 2. Modifying UI / font / text LLM does NOT include `asr` in the patch, so ASR never restarts unnecessarily.
 * 3. Saving one section (e.g. text LLM or UI) preserves unrelated unsaved drafts (e.g. multimodal endpoints).
 */
export function buildSettingsDiffPatch(baseline, current, {
  keys = {},
  includeSections = null
} = {}) {
  const patch = {};
  const allow = (name) => !includeSections || includeSections.includes(name);

  if (allow('llm')) {
    const llmDiff = {};
    if (current.baseUrl !== baseline.baseUrl) llmDiff.baseUrl = current.baseUrl.trim();
    if (current.model !== baseline.model) llmDiff.model = current.model.trim();
    if ((current.reasoningEffort ?? 'default') !== (baseline.reasoningEffort ?? 'default')) {
      llmDiff.reasoningEffort = current.reasoningEffort || 'default';
    }
    if (current.answerLang !== baseline.answerLang) llmDiff.answerLang = current.answerLang;
    if (current.llmProviderId && current.llmProviderId !== baseline.llmProviderId) {
      llmDiff.providerId = current.llmProviderId;
    }
    if (keys.llm !== undefined) llmDiff.apiKey = keys.llm;
    if (Object.keys(llmDiff).length > 0) patch.llm = llmDiff;
  }

  if (allow('vision')) {
    const visionDiff = {};
    if (current.visionBaseUrl !== baseline.visionBaseUrl) visionDiff.baseUrl = current.visionBaseUrl.trim();
    if (current.visionModel !== baseline.visionModel) visionDiff.model = current.visionModel.trim();
    if (current.visionProxy !== baseline.visionProxy) visionDiff.proxyUrl = current.visionProxy.trim();
    if (keys.vision !== undefined) visionDiff.apiKey = keys.vision;
    if (Object.keys(visionDiff).length > 0) patch.vision = visionDiff;
  }

  if (allow('multimodal') && current.multimodal && JSON.stringify(current.multimodal) !== JSON.stringify(baseline.multimodal)) {
    patch.multimodal = current.multimodal;
  }

  if (allow('asr')) {
    const asrDiff = {};
    if (current.language !== baseline.language) asrDiff.language = current.language;
    if (current.asrBackend !== baseline.asrBackend) asrDiff.backend = current.asrBackend;

    const cloudChanged = current.cloudBaseUrl !== baseline.cloudBaseUrl ||
      current.cloudModel !== baseline.cloudModel ||
      keys.cloud !== undefined;
    if (cloudChanged) {
      asrDiff.cloud = {
        baseUrl: current.cloudBaseUrl.trim(),
        model: current.cloudModel.trim(),
        ...(keys.cloud !== undefined ? { apiKey: keys.cloud } : {})
      };
    }

    const rtChanged = current.rtBaseUrl !== baseline.rtBaseUrl ||
      current.rtModel !== baseline.rtModel ||
      keys.realtime !== undefined;
    if (rtChanged) {
      asrDiff.realtime = {
        baseUrl: current.rtBaseUrl.trim(),
        model: current.rtModel.trim(),
        ...(keys.realtime !== undefined ? { apiKey: keys.realtime } : {})
      };
    }

    if (current.rtLocalModel !== baseline.rtLocalModel) {
      asrDiff.localRealtime = { model: current.rtLocalModel };
    }
    if (current.asrProviderId && (asrDiff.backend || asrDiff.cloud || asrDiff.realtime)) {
      asrDiff.providerId = current.asrProviderId;
    }
    if (Object.keys(asrDiff).length > 0) patch.asr = asrDiff;
  }

  if (allow('ui')) {
    const uiDiff = {};
    if (current.hotkey !== baseline.hotkey) uiDiff.hotkeyToggle = current.hotkey.trim();
    if (current.hotkeyShot !== baseline.hotkeyShot) uiDiff.hotkeyShot = current.hotkeyShot.trim();
    if (current.fontScale !== baseline.fontScale) uiDiff.fontScale = current.fontScale;
    if (current.theme !== baseline.theme) uiDiff.theme = current.theme;
    if (current.uiLang !== baseline.uiLang) uiDiff.lang = current.uiLang;
    if (current.autoLaunch !== baseline.autoLaunch) uiDiff.autoLaunch = Boolean(current.autoLaunch);
    if (Object.keys(uiDiff).length > 0) patch.ui = uiDiff;
  }

  if (allow('capture') && current.hotkeyRegion !== baseline.hotkeyRegion) {
    patch.capture = { hotkeyRegion: current.hotkeyRegion.trim() };
  }

  if (allow('audio')) {
    const audioDiff = {};
    if (current.themDeviceId !== baseline.themDeviceId) audioDiff.themDeviceId = current.themDeviceId || undefined;
    if (current.micDeviceId !== baseline.micDeviceId) audioDiff.micDeviceId = current.micDeviceId || undefined;
    if (Object.keys(audioDiff).length > 0) patch.audio = audioDiff;
  }

  if (allow('modelPrompts') && current.interviewPrompt !== baseline.interviewPrompt) {
    patch.modelPrompts = { interview: current.interviewPrompt };
  }

  return patch;
}
