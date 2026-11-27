import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LoopbackCapture, MicCapture } from '@mc/runtime';
import {
  addQuestionWithAttempt,
  appendSegment,
  applyLlmEvent,
  buildLlmHistory,
  buildWrittenHistory,
  cancelAttempt,
  createEmptySession,
  createId,
  getSelectedQuestion,
  jumpToLatestQuestion,
  mergeQuestions,
  migrateSessionsFile,
  regenerateQuestion,
  reviseQuestionWithAttempt,
  selectAttempt,
  selectQuestion,
  serializeSessionsForDisk,
  setAttemptTranslation,
  setSegmentTranslation
} from './core/sessionModel.js';
import {
  appendManualDraft,
  clearManualDraft,
  commitManualDraft,
  createManualDraftState,
  createTurnAggregator,
  handleAudioSourceSwitch,
  isEchoOfRecentThem
} from './core/turnPolicy.js';
import { createAudioController } from './core/audioController.js';
import { installGlobalTooltip } from './core/globalTooltip.js';
import { AppShell } from './components/AppShell.jsx';
import { HomeView } from './components/HomeView.jsx';
import { KnowledgeView } from './components/KnowledgeView.jsx';
import { RecordsView } from './components/RecordsView.jsx';
import { SettingsView } from './components/SettingsView.jsx';
import { WrittenCompactView } from './components/WrittenCompactView.jsx';
import { WorkbenchView } from './components/WorkbenchView.jsx';
import {
  DiagnosticsModal,
  ErrorBoundary,
  HelpModal,
  QuickStartModal,
  ServiceHealthModal
} from './components/SharedWidgets.jsx';

// Signal to main-process window-controls.cjs that UI Next manages layered opacity tokens.
document.documentElement.dataset.uiNext = '1';

function percentile(values, p) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function createScreenshotBatch({ capture, send, isWritten, getSession, onChange }) {
  let state = { enabled: false, images: [], question: '', busy: false, message: '' };
  let msgTimer = null;
  const snapshot = () => ({ ...state, images: [...state.images] });
  const update = (patch, { autoClearMs = 0 } = {}) => {
    if (patch.message !== undefined) clearTimeout(msgTimer);
    state = { ...state, ...patch };
    onChange(snapshot());
    if (autoClearMs > 0 && state.message) {
      msgTimer = setTimeout(() => {
        state = { ...state, message: '' };
        onChange(snapshot());
      }, autoClearMs);
    }
  };
  function toggle() {
    if (state.busy) return update({ message: '截图中，请完成或取消框选后再切换模式' }, { autoClearMs: 2600 });
    if (!isWritten()) return update({ message: '请先切换到笔试模式' }, { autoClearMs: 2600 });
    update({ enabled: !state.enabled, message: state.enabled ? '已关闭多图；暂存截图保留，不会自动发送' : '多图已开启：按截图键逐张暂存，再统一发送' }, { autoClearMs: 2400 });
  }
  async function take(mode = 'full', question = '', displayId, sceneOverride) {
    if (state.busy) return false;
    const batch = state.enabled && (sceneOverride === 'written' || isWritten());
    const session = getSession(sceneOverride);
    if (batch && state.images.length >= 12) { update({ message: '已暂存 12 张，请先发送或移除截图' }, { autoClearMs: 3000 }); return false; }
    update({ busy: true, message: '' });
    try {
      const dataUrl = await capture(mode, displayId);
      if (!dataUrl) return false;
      if (batch) {
        if (state.images.reduce((n, img) => n + img.dataUrl.length, dataUrl.length) > 64 * 1024 * 1024) {
          throw new Error('截图已保存本地，但暂存总量超过 48 MiB');
        }
        update({
          images: [...state.images, { dataUrl, name: `${mode === 'region' ? '框选' : '全屏'} ${new Date().toLocaleTimeString()}` }],
          question: question || state.question,
          message: '截图已暂存，尚未发送'
        }, { autoClearMs: 2200 });
      } else {
        if (!session || session !== getSession(sceneOverride)) throw new Error('会话已变化，请重新截图');
        send(question, dataUrl, undefined, { scene: sceneOverride });
      }
      return true;
    } catch (e) {
      update({ message: e.message });
      return false;
    } finally {
      update({ busy: false });
    }
  }
  function sendBatch() {
    if (state.busy) return update({ message: '截图中，请先完成框选' }, { autoClearMs: 2400 });
    if (!isWritten()) return update({ message: '请先切换到笔试模式再发送暂存截图' }, { autoClearMs: 2400 });
    if (!state.images.length) return update({ message: '没有暂存截图' }, { autoClearMs: 2200 });
    if (!getSession('written')) return update({ message: '会话尚未就绪' }, { autoClearMs: 2200 });
    try {
      send(state.question, undefined, state.images.map(img => img.dataUrl), { scene: 'written' });
      update({ images: [], question: '', message: '全部暂存截图已提交' }, { autoClearMs: 2000 });
    } catch (e) {
      update({ message: '发送失败：' + e.message });
    }
  }
  function addImage(dataUrl, name) {
    if (!dataUrl || typeof dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,/.test(dataUrl)) return false;
    if (state.images.length >= 12) { update({ message: '已暂存 12 张，请先发送或移除截图' }); return false; }
    if (state.images.reduce((n, img) => n + img.dataUrl.length, dataUrl.length) > 64 * 1024 * 1024) {
      update({ message: '暂存图片总量超过 48 MiB，请先移除部分截图' });
      return false;
    }
    update({
      images: [...state.images, { dataUrl, name: name || `图片 ${state.images.length + 1}` }],
      message: ''
    });
    return true;
  }
  return {
    snapshot,
    take,
    toggle,
    sendBatch,
    addImage,
    question: (value) => update({ question: value }),
    remove: (idx) => { if (!state.busy) update({ images: state.images.filter((_, i) => i !== idx) }); },
    clear: () => { if (!state.busy) update({ images: [], message: '' }); }
  };
}

function App() {
  const [settings, setSettings] = useState(null);
  const [library, setLibrary] = useState(null);
  const [templatesStore, setTemplatesStore] = useState(null);
  const [workbenchPrefs, setWorkbenchPrefs] = useState(null);
  const [windowState, setWindowState] = useState(null);
  const [hoverInside, setHoverInside] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null); // Strictly interview workbench session
  const [writtenSessionId, setWrittenSessionId] = useState(null); // Strictly isolated written-exam session (M02)
  const [route, setRoute] = useState('home'); // 'home' | 'knowledge' | 'records' | 'settings' | 'workbench'
  const [homeTab, setHomeTab] = useState('interview'); // Lifted so returning from written compact restores tab (M12)
  const [settingsTab, setSettingsTab] = useState('models');
  const [settingsFocus, setSettingsFocus] = useState(null); // { section, seq } for M13/M14/M21 deep-links
  const [asr, setAsr] = useState({ phase: 'loading', workerState: 'loading' });
  const [hud, setHud] = useState({ count: 0 });
  const [capturing, setCapturing] = useState(false);
  const [secondaryMicActive, setSecondaryMicActive] = useState(false);
  const [recordingState, setRecordingState] = useState({ active: false, durationSec: 0, themBytes: 0, meBytes: 0 });
  const [partials, setPartials] = useState({});
  const [pendingTurnText, setPendingTurnText] = useState('');
  const [manualDraft, setManualDraft] = useState(createManualDraftState);
  const [modal, setModal] = useState(null); // 'health' | 'quickstart' | 'diagnostics' | 'help' | null
  const [writtenError, setWrittenError] = useState('');
  const [batch, setBatch] = useState({ enabled: false, images: [], question: '', busy: false, message: '' });

  const loadedRef = useRef(false);
  const settingsRef = useRef(null);
  const sessionsRef = useRef([]);
  const activeSessionIdRef = useRef(null);
  const writtenSessionIdRef = useRef(null);
  const routeRef = useRef('home');
  const homeTabRef = useRef('interview');
  const writtenOriginRef = useRef({ route: 'home', homeTab: 'written' });
  const workbenchPrefsRef = useRef(null);
  const settingsCloseRef = useRef(null);
  const audioRef = useRef(null);
  const e2eSamplesRef = useRef([]);
  const memoChainRef = useRef(new Map());
  const turnAggregatorRef = useRef(null);
  const focusSeqRef = useRef(0);
  const actionsRef = useRef({});

  settingsRef.current = settings;
  sessionsRef.current = sessions;
  activeSessionIdRef.current = activeSessionId;
  writtenSessionIdRef.current = writtenSessionId;
  routeRef.current = route;
  homeTabRef.current = homeTab;
  workbenchPrefsRef.current = workbenchPrefs;

  if (!audioRef.current) {
    audioRef.current = createAudioController({
      LoopbackCapture,
      MicCapture,
      platform: window.mc.platform,
      sendPcm: (buf, ts, ch) => window.mc.sendPcm(buf, ts, ch),
      notifyStarted: () => window.mc.captureStarted(),
      notifyStopped: () => window.mc.captureStopped(),
      onError: (msg) => setAsr(prev => ({ ...prev, lastError: msg }))
    });
  }

  const activeSession = useMemo(
    () => (activeSessionId ? sessions.find(s => s.id === activeSessionId) || null : null),
    [sessions, activeSessionId]
  );

  const activeWrittenSession = useMemo(
    () => (writtenSessionId ? sessions.find(s => s.id === writtenSessionId && s.scene === 'written') || null : null),
    [sessions, writtenSessionId]
  );

  const patchSessionById = useCallback((sid, updater) => {
    setSessions(list => list.map(s => (s.id === sid ? updater(s) : s)));
  }, []);

  const buildLibraryOverrideFor = useCallback((session) => {
    if (!session) return undefined;
    const override = {};
    if (typeof session.libraryEnabled === 'boolean') override.enabled = session.libraryEnabled;
    if (session.role) override.role = session.role;
    return Object.keys(override).length ? override : undefined;
  }, []);

  const enqueueMemoUpdate = useCallback((sid, question, answer) => {
    if (!question?.trim() || !answer?.trim()) return;
    const prev = memoChainRef.current.get(sid) ?? Promise.resolve();
    const next = prev.then(async () => {
      const cur = sessionsRef.current.find(x => x.id === sid);
      if (!cur) return;
      const updated = await window.mc.memoUpdate({ memo: cur.memo || '', question, answer });
      if (updated) patchSessionById(sid, s => ({ ...s, memo: updated }));
    }).catch(() => {});
    memoChainRef.current.set(sid, next);
  }, [patchSessionById]);

  const dispatchLlmAsk = useCallback((session, { requestId, mode = 'free', prompt, excludeQuestionId = null }) => {
    const recentTranscript = (session.segments || []).slice(-18).map(seg => ({
      speaker: seg.speaker,
      text: seg.text
    }));
    window.mc.llmAsk({
      requestId,
      mode,
      question: mode === 'free' ? undefined : prompt,
      freeQuestion: mode === 'free' ? prompt : undefined,
      recentTranscript,
      history: buildLlmHistory(session, { excludeQuestionId, maxTurns: 6 }),
      resume: session.resume || undefined,
      jd: session.jd || undefined,
      memo: session.memo || undefined,
      background: session.kbText || undefined,
      dialogueState: session.dialogueState || undefined,
      sessionId: session.id,
      scene: session.scene || 'interview',
      answerLang: session.answerLang || settingsRef.current?.llm?.answerLang || 'chinese',
      libraryOverride: buildLibraryOverrideFor(session),
      memoryEnabled: workbenchPrefsRef.current?.memoryRecallEnabled !== false,
      memoryMaxChars: workbenchPrefsRef.current?.memoryMaxChars ?? 1600,
      codingPrefs: workbenchPrefsRef.current?.codingPrefs,
      dialogueThinking: Boolean(workbenchPrefsRef.current?.dialogueThinking)
    });
  }, [buildLibraryOverrideFor]);

  const handleAskText = useCallback((promptText, sourceSegmentIds = [], { mode = 'free', forceSelect = true, questionId } = {}) => {
    const sid = activeSessionIdRef.current;
    const cur = sessionsRef.current.find(s => s.id === sid);
    const clean = String(promptText || '').trim();
    if (!cur || !clean) return null;
    if (mode === 'free') {
      turnAggregatorRef.current?.notifyManualQuestion();
    }
    const qid = questionId || createId('q');
    const requestId = createId('req');
    patchSessionById(cur.id, (s) => addQuestionWithAttempt(s, {
      questionId: qid,
      requestId,
      prompt: clean,
      kind: mode === 'continuous' || mode === 'segment' ? 'segment' : 'free',
      sourceSegmentIds,
      forceSelect
    }));
    dispatchLlmAsk(cur, { requestId, mode, prompt: clean });
    return qid;
  }, [dispatchLlmAsk, patchSessionById]);

  const handleReviseAutoQuestion = useCallback(({ questionId, fullPrompt, addedSegmentIds = [] }) => {
    const sid = activeSessionIdRef.current;
    const cur = sessionsRef.current.find(s => s.id === sid);
    const clean = String(fullPrompt || '').trim();
    if (!cur || !questionId || !clean) return;
    const existing = cur.questions.find(q => q.id === questionId);
    if (!existing) return;
    const requestId = createId('req');
    let toCancel = [];
    patchSessionById(cur.id, (s) => {
      const revised = reviseQuestionWithAttempt(s, questionId, {
        nextPrompt: clean,
        addedSegmentIds,
        requestId
      });
      toCancel = revised.cancelledRequestIds;
      return revised.session;
    });
    // Also cancel any active streaming requests from current ref snapshot immediately
    const liveCancel = new Set([
      ...toCancel,
      ...existing.attempts.filter(a => a.status === 'streaming').map(a => a.requestId).filter(Boolean)
    ]);
    for (const rid of liveCancel) {
      window.mc.llmCancel(rid);
    }
    dispatchLlmAsk(cur, { requestId, mode: 'continuous', prompt: clean, excludeQuestionId: questionId });
  }, [dispatchLlmAsk, patchSessionById]);

  const handleRegenerateQuestion = useCallback((questionId) => {
    const sid = activeSessionIdRef.current;
    const cur = sessionsRef.current.find(s => s.id === sid);
    const q = cur?.questions?.find(item => item.id === questionId);
    if (!cur || !q) return;
    for (const att of q.attempts) {
      if (att.status === 'streaming') window.mc.llmCancel(att.requestId);
    }
    const requestId = createId('req');
    patchSessionById(cur.id, (s) => regenerateQuestion(s, questionId, { requestId }));
    dispatchLlmAsk(cur, { requestId, mode: 'free', prompt: q.prompt, excludeQuestionId: questionId });
  }, [dispatchLlmAsk, patchSessionById]);

  const handleCancelAttempt = useCallback((requestId) => {
    window.mc.llmCancel(requestId);
    const targetIds = [activeSessionIdRef.current, writtenSessionIdRef.current].filter(Boolean);
    for (const sid of targetIds) {
      patchSessionById(sid, (s) => cancelAttempt(s, requestId));
    }
  }, [patchSessionById]);

  // Isolated written-exam session creation / retrieval (NEVER reuses an interview session — fixes M02)
  const createFreshWrittenSession = useCallback((customName = '') => {
    const timeTag = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const created = createEmptySession({ name: String(customName || '').trim() || `笔试会话 · ${timeTag}`, scene: 'written' });
    setSessions(list => [created, ...list]);
    setWrittenSessionId(created.id);
    writtenSessionIdRef.current = created.id;
    return created;
  }, []);

  const ensureWrittenSession = useCallback(() => {
    const wid = writtenSessionIdRef.current;
    if (wid) {
      const existing = sessionsRef.current.find(s => s.id === wid && s.scene === 'written');
      if (existing) return existing;
    }
    return createFreshWrittenSession();
  }, [createFreshWrittenSession]);

  const isCurrentlyWrittenContext = useCallback((sceneOverride) => {
    if (sceneOverride === 'written') return true;
    if (sceneOverride === 'interview') return false;
    if (routeRef.current === 'written') return true;
    if (settingsRef.current?.writtenWindow?.enabled) return true;
    if (routeRef.current === 'home' && homeTabRef.current === 'written') return true;
    return false;
  }, []);

  const resolveWrittenDispatchConfig = useCallback((writtenModeOverride) => {
    const wCfg = workbenchPrefsRef.current?.writtenConfig || {};
    const writtenMode = writtenModeOverride || (wCfg.mode === 'followup' ? 'followup' : 'fast');
    let simultaneousAnswers;
    if (writtenMode === 'followup') {
      // User decision: follow-up questions always go to the primary vision model cleanly.
      simultaneousAnswers = false;
    } else if (wCfg.simultaneousMode === 'parallel') {
      simultaneousAnswers = true;
    } else if (wCfg.simultaneousMode === 'single') {
      simultaneousAnswers = false;
    } else {
      simultaneousAnswers = Boolean(settingsRef.current?.multimodal?.simultaneousAnswers);
    }
    return {
      writtenMode,
      simultaneousAnswers,
      endpointId: (!simultaneousAnswers && wCfg.preferredEndpointId) ? wCfg.preferredEndpointId : undefined,
      writtenPrompt: wCfg.systemPrompt || ''
    };
  }, []);

  const sendShotQuestion = useCallback((questionText, dataUrl, dataUrls, extra = {}) => {
    const writtenCtx = isCurrentlyWrittenContext(extra.scene);
    const targetSession = writtenCtx
      ? ensureWrittenSession()
      : (activeSessionIdRef.current
        ? sessionsRef.current.find(s => s.id === activeSessionIdRef.current)
        : ensureWrittenSession());
    if (!targetSession) return;
    const requestId = createId('shot');
    const images = dataUrls || (dataUrl ? [dataUrl] : []);
    const isTextOnly = images.length === 0 && extra.textOnly === true;
    const prompt = String(questionText || '').trim() || (images.length > 1 ? `多图截图提问 (${images.length} 张)` : '截图提问');
    const wDispatch = writtenCtx ? resolveWrittenDispatchConfig(extra.writtenMode) : null;
    const history = writtenCtx && wDispatch?.writtenMode === 'followup'
      ? buildWrittenHistory(targetSession, { maxTurns: 6, maxImages: 4 })
      : [];
    patchSessionById(targetSession.id, (s) =>
      addQuestionWithAttempt(s, {
        requestId,
        prompt,
        kind: images.length > 1 ? 'batch' : images.length === 1 ? 'shot' : 'free',
        parentQuestionId: extra.parentQuestionId || null,
        isFollowup: Boolean(extra.isFollowup || extra.parentQuestionId),
        images,
        forceSelect: true
      })
    );
    window.mc.shotAsk({
      requestId,
      question: questionText || '',
      imageDataUrl: dataUrl,
      imageDataUrls: images.length ? images : undefined,
      textOnly: isTextOnly,
      scene: extra.scene || (writtenCtx ? 'written' : targetSession.scene),
      writtenMode: wDispatch?.writtenMode,
      simultaneousAnswers: wDispatch?.simultaneousAnswers,
      endpointId: wDispatch?.endpointId,
      writtenPrompt: wDispatch?.writtenPrompt,
      history,
      answerLang: targetSession.answerLang,
      displayId: extra.displayId ?? workbenchPrefsRef.current?.captureDisplayId,
      codingPrefs: workbenchPrefsRef.current?.codingPrefs,
      libraryOverride: writtenCtx ? { enabled: false } : buildLibraryOverrideFor(targetSession)
    });
  }, [buildLibraryOverrideFor, ensureWrittenSession, isCurrentlyWrittenContext, patchSessionById, resolveWrittenDispatchConfig]);

  const handleWrittenFollowup = useCallback((promptText, attachedImages = []) => {
    const imgs = Array.isArray(attachedImages) ? attachedImages.filter(Boolean) : [];
    const clean = String(promptText || '').trim();
    if (!clean && !imgs.length) return;
    const curWritten = sessionsRef.current.find(s => s.id === writtenSessionIdRef.current && s.scene === 'written');
    const selected = curWritten ? getSelectedQuestion(curWritten) : null;
    const latestRoot = curWritten?.questions?.slice().reverse().find(q => !q.isFollowup && !q.parentQuestionId) || null;
    const parentQuestionId = selected?.parentQuestionId || selected?.id || latestRoot?.id || null;
    sendShotQuestion(clean, undefined, imgs.length ? imgs : undefined, {
      scene: 'written',
      writtenMode: 'followup',
      textOnly: imgs.length === 0,
      parentQuestionId,
      isFollowup: Boolean(parentQuestionId)
    });
  }, [sendShotQuestion]);

  const handleRegenerateWrittenQuestion = useCallback((questionId) => {
    const wid = writtenSessionIdRef.current;
    const cur = sessionsRef.current.find(s => s.id === wid && s.scene === 'written');
    const q = cur?.questions?.find(item => item.id === questionId);
    if (!cur || !q) return;
    for (const att of q.attempts) {
      if (att.status === 'streaming') window.mc.llmCancel(att.requestId);
    }
    const prevAtt = q.attempts.find(a => a.id === q.activeAttemptId) || q.attempts[q.attempts.length - 1];
    const imgs = Array.isArray(prevAtt?.images) ? prevAtt.images : [];
    const requestId = createId('shot');
    const wDispatch = resolveWrittenDispatchConfig();
    const history = wDispatch.writtenMode === 'followup'
      ? buildWrittenHistory(cur, { excludeQuestionId: questionId, maxTurns: 6, maxImages: 4 })
      : [];
    patchSessionById(cur.id, (s) => regenerateQuestion(s, questionId, { requestId, images: imgs }));
    window.mc.shotAsk({
      requestId,
      question: q.prompt || '',
      imageDataUrls: imgs.length ? imgs : undefined,
      textOnly: imgs.length === 0,
      scene: 'written',
      writtenMode: wDispatch.writtenMode,
      simultaneousAnswers: wDispatch.simultaneousAnswers,
      endpointId: wDispatch.endpointId,
      writtenPrompt: wDispatch.writtenPrompt,
      history,
      answerLang: cur.answerLang,
      displayId: workbenchPrefsRef.current?.captureDisplayId,
      codingPrefs: workbenchPrefsRef.current?.codingPrefs,
      libraryOverride: { enabled: false }
    });
  }, [patchSessionById, resolveWrittenDispatchConfig]);

  const batchController = useMemo(() => createScreenshotBatch({
    capture: (mode, displayId) => window.mc.pickRegion(mode, displayId ?? workbenchPrefsRef.current?.captureDisplayId),
    send: (q, dataUrl, dataUrls, extra) => sendShotQuestion(q, dataUrl, dataUrls, extra),
    isWritten: () => (
      routeRef.current === 'written' ||
      Boolean(settingsRef.current?.writtenWindow?.enabled) ||
      (routeRef.current === 'home' && homeTabRef.current === 'written') ||
      settingsRef.current?.multimodal?.mode === 'written'
    ),
    getSession: (sceneOverride) => {
      if (isCurrentlyWrittenContext(sceneOverride)) return ensureWrittenSession().id;
      return activeSessionIdRef.current || ensureWrittenSession().id;
    },
    onChange: setBatch
  }), [sendShotQuestion, ensureWrittenSession, isCurrentlyWrittenContext]);

  // Initial load & IPC listeners
  useEffect(() => {
    let alive = true;
    Promise.all([
      window.mc.getSettings(),
      window.mc.loadSessions(),
      window.mc.loadTemplates().catch(() => ({ version: 1, groups: [{ id: 'group-default', name: '默认分组', order: 0, collapsed: false }], templates: [] })),
      window.mc.getInterviewLibrary().catch(() => null),
      window.mc.getWorkbenchPrefs().catch(() => null),
      window.mc.getWindowState().catch(() => null),
      window.mc.getRecordingStatus?.().catch(() => null)
    ]).then(([s, rawSessions, tpls, lib, prefs, winSt, recSt]) => {
      if (!alive) return;
      setSettings(s);
      const migrated = migrateSessionsFile(rawSessions);
      setSessions(migrated.sessions);
      setTemplatesStore(tpls);
      setLibrary(lib);
      setWorkbenchPrefs(prefs);
      setWindowState(winSt);
      if (recSt) setRecordingState(recSt);
      loadedRef.current = true;
    }).catch(() => {});

    const offWritten = window.mc.onWrittenWindowState?.((prefs) => {
      setSettings(prev => (prev ? { ...prev, writtenWindow: prefs } : prev));
    });
    const offWin = window.mc.onWindowState?.((st) => setWindowState(st));
    const offPrefs = window.mc.onWorkbenchPrefsState?.((p) => setWorkbenchPrefs(p));
    const offHover = window.mc.onHoverState?.(({ inside }) => setHoverInside(Boolean(inside)));
    const offRec = window.mc.onRecordingState?.((st) => setRecordingState(st));
    const onLibEvt = () => { void window.mc.getInterviewLibrary().then(setLibrary).catch(() => {}); };
    window.addEventListener('mc-library-updated', onLibEvt);

    turnAggregatorRef.current?.dispose?.();
    turnAggregatorRef.current = createTurnAggregator({
      getMode: () => settingsRef.current?.asr?.segmentationMode || 'balanced',
      onBufferChange: (text) => setPendingTurnText(text),
      onDispatch: ({ prompt, sourceSegmentIds }) => {
        const sid = activeSessionIdRef.current;
        const latestSess = sessionsRef.current.find(s => s.id === sid);
        if (!latestSess || latestSess.transcriptionMode !== 'auto') return null;
        return handleAskText(prompt, sourceSegmentIds, { mode: 'continuous', forceSelect: false });
      },
      onRevise: ({ questionId, fullPrompt, addedSegmentIds }) => {
        const sid = activeSessionIdRef.current;
        const latestSess = sessionsRef.current.find(s => s.id === sid);
        if (!latestSess || latestSess.transcriptionMode !== 'auto') return;
        handleReviseAutoQuestion({ questionId, fullPrompt, addedSegmentIds });
      }
    });

    const handleAsr = (ev) => {
      if (ev.kind === 'ready') {
        setAsr({ phase: 'ready', workerState: 'idle', ep: ev.ep, gpuSuspect: ev.gpuSuspect });
      } else if (ev.kind === 'status') {
        setAsr(prev => ({
          ...prev,
          workerState: ev.state,
          ...(ev.state === 'unconfigured' ? { phase: 'unconfigured', lastError: undefined } : {})
        }));
      } else if (ev.kind === 'error') {
        setAsr(prev => ({ ...prev, phase: ev.fatal ? 'error' : prev.phase, lastError: ev.message }));
      } else if (ev.kind === 'partial') {
        setPartials(prev => ({ ...prev, [ev.speaker]: ev.text }));
        const sid = activeSessionIdRef.current;
        const cur = sessionsRef.current.find(s => s.id === sid);
        if (cur && cur.transcriptionMode === 'auto') {
          if ((ev.speaker ?? 'them') === 'them') {
            turnAggregatorRef.current?.onPartial(ev.text);
          } else if (ev.speaker === 'me' && String(ev.text || '').trim().length >= 3) {
            const guardOn = cur.audioSource === 'system' && settingsRef.current?.asr?.echoGuard !== false;
            const echo = guardOn ? isEchoOfRecentThem(ev.text, cur.segments, Date.now()) : { isEcho: false };
            if (!echo.isEcho) {
              turnAggregatorRef.current?.onMeSpeech();
            }
          }
        }
      } else if (ev.kind === 'segment') {
        setPartials(prev => ({ ...prev, [ev.speaker]: undefined }));
        if (ev.timings) {
          const e2eMs = Date.now() - ev.timings.speechEndTs;
          const inferMs = ev.timings.inferEndTs - ev.timings.inferStartTs;
          e2eSamplesRef.current.push(e2eMs);
          if (e2eSamplesRef.current.length > 200) e2eSamplesRef.current.shift();
          setHud({
            lastE2eMs: e2eMs,
            lastInferMs: inferMs,
            p50: percentile(e2eSamplesRef.current, 50),
            p95: percentile(e2eSamplesRef.current, 95),
            count: e2eSamplesRef.current.length
          });
        }
        const sid = activeSessionIdRef.current;
        const cur = sessionsRef.current.find(s => s.id === sid);
        if (cur) {
          const speaker = ev.speaker === 'me' ? 'me' : 'them';
          const segTs = ev.timings?.speechEndTs || Date.now();
          // Text-level speaker echo deduplication for external speaker playback in system-audio mode
          if (speaker === 'me' && cur.audioSource === 'system' && settingsRef.current?.asr?.echoGuard !== false) {
            const echo = isEchoOfRecentThem(ev.text, cur.segments, segTs);
            if (echo.isEcho) return;
          }
          const segId = cur.nextSegmentId || 1;
          patchSessionById(cur.id, (s) => appendSegment(s, {
            id: segId,
            speaker,
            text: ev.text,
            startTs: ev.timings?.speechStartTs,
            endTs: ev.timings?.speechEndTs
          }));
          if (speaker === 'me') {
            turnAggregatorRef.current?.onMeSpeech();
          } else {
            if (cur.transcriptionMode === 'manual') {
              setManualDraft(prev => appendManualDraft(prev, { id: segId, text: ev.text, endTs: segTs }));
            } else if (cur.transcriptionMode === 'auto') {
              turnAggregatorRef.current?.onSegment({ id: segId, text: ev.text, ts: segTs });
            }
          }
        }
      }
    };
    const offAsr = window.mc.onAsrEvent(handleAsr);
    void window.mc.asrReplay().then(({ ready, status }) => {
      if (ready) handleAsr(ready);
      if (status) handleAsr(status);
    }).catch(() => {});

    const offLlm = window.mc.onLlmEvent((ev) => {
      setSessions(list => list.map(s => applyLlmEvent(s, ev)));
      if (ev.kind === 'done') {
        const cur = sessionsRef.current.find(s => s.questions.some(q => q.attempts.some(a => a.requestId === ev.requestId)));
        const q = cur?.questions.find(item => item.attempts.some(a => a.requestId === ev.requestId));
        if (cur && q && ['segment', 'free', 'manual'].includes(q.kind)) {
          enqueueMemoUpdate(cur.id, q.prompt, ev.text || '');
        }
      }
    });
    const offShot = window.mc.onShotHotkey((mode) => void batchController.take(mode));
    const offBatch = window.mc.onScreenshotBatchAction((action) => {
      if (action === 'toggleBatch') batchController.toggle();
      if (action === 'sendBatch') batchController.sendBatch();
    });
    const offTray = window.mc.onTrayCommand(({ command }) => {
      if (command === 'open-settings') actionsRef.current.navigateWithFlush?.('settings');
      else if (command === 'open-health') setModal('health');
      else if (command === 'open-quickstart') setModal('quickstart');
      else if (command === 'open-help') setModal('help');
      else if (command === 'toggle-capture') void actionsRef.current.handleToggleCapture?.();
    });
    window.__mcOpenSettings = () => actionsRef.current.navigateWithFlush?.('settings');
    window.__mcOpenHelp = () => setModal('help');

    return () => {
      alive = false;
      turnAggregatorRef.current?.dispose?.();
      offWritten?.();
      offWin?.();
      offPrefs?.();
      offHover?.();
      offRec?.();
      offAsr?.();
      offLlm?.();
      offShot?.();
      offBatch?.();
      offTray?.();
      window.removeEventListener('mc-library-updated', onLibEvt);
    };
  }, [batchController, enqueueMemoUpdate, handleAskText, handleReviseAutoQuestion, patchSessionById]);

  // Install global SuiSi-style custom tooltip & native tooltip privacy guard
  useEffect(() => installGlobalTooltip(document), []);

  // Theme & font scale sync
  useEffect(() => {
    const ui = settings?.ui;
    if (!ui) return;
    document.documentElement.dataset.fontScale = ui.fontScale ?? 'medium';
    const applyTheme = () => {
      const mode = ui.theme ?? 'light';
      const dark = mode === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : mode === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    applyTheme();
    if ((ui.theme ?? 'light') !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [settings?.ui?.theme, settings?.ui?.fontScale]);

  const isWrittenCompact = Boolean(settings?.writtenWindow?.enabled);
  useEffect(() => {
    document.documentElement.dataset.writtenCompact = isWrittenCompact ? 'true' : 'false';
  }, [isWrittenCompact]);

  // Debounced auto-persistence of sessions
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => {
      window.mc.saveSessions(serializeSessionsForDisk(sessions, activeSessionId));
    }, 400);
    return () => clearTimeout(timer);
  }, [sessions, activeSessionId]);

  const navigateWithFlush = useCallback((nextRoute, tab, focusSection = null) => {
    const proceed = () => {
      if (tab) setSettingsTab(tab);
      if (focusSection) {
        focusSeqRef.current += 1;
        setSettingsFocus({ section: focusSection, seq: focusSeqRef.current });
      }
      setRoute(nextRoute);
      if (nextRoute === 'workbench') {
        void window.mc.setWindowMode('workbench').catch(() => {});
      } else {
        void window.mc.setWindowMode('home').catch(() => {});
      }
    };
    if (route === 'settings' && nextRoute !== 'settings' && settingsCloseRef.current) {
      void settingsCloseRef.current(proceed);
    } else {
      proceed();
    }
  }, [route]);

  // Unified capability deep-link router (fixes M06 / M13 / M14 / M21)
  const navigateToCapability = useCallback((capability) => {
    switch (capability) {
      case 'kb':
      case 'knowledge':
        navigateWithFlush('knowledge');
        break;
      case 'vision':
        navigateWithFlush('settings', 'models', 'vision');
        break;
      case 'asr':
      case 'audio':
        navigateWithFlush('settings', 'audio', 'asr');
        break;
      case 'shortcuts-region':
        navigateWithFlush('settings', 'shortcuts', 'hotkeyRegion');
        break;
      case 'shortcuts-shot':
        navigateWithFlush('settings', 'shortcuts', 'hotkeyShot');
        break;
      case 'shortcuts-toggle':
        navigateWithFlush('settings', 'shortcuts', 'hotkeyToggle');
        break;
      case 'shortcuts':
        navigateWithFlush('settings', 'shortcuts', 'shortcuts');
        break;
      case 'text-llm':
      case 'models':
      default:
        navigateWithFlush('settings', 'models', 'text-llm');
        break;
    }
  }, [navigateWithFlush]);

  const handleSaveTemplates = useCallback(async (nextStore) => {
    setTemplatesStore(nextStore);
    try {
      const saved = await window.mc.saveTemplates(nextStore);
      setTemplatesStore(saved);
    } catch {}
  }, []);

  const handleUpdateWorkbenchPrefs = useCallback(async (patch) => {
    setWorkbenchPrefs(prev => (prev ? { ...prev, ...patch } : prev));
    try {
      const next = await window.mc.setWorkbenchPrefs(patch);
      setWorkbenchPrefs(next);
    } catch {}
  }, []);

  const handleToggleSecurity = useCallback(async (enable) => {
    try {
      const st = enable
        ? await window.mc.enableSecurity({ scope: 'persistent' })
        : await window.mc.disableSecurity({ scope: 'persistent', clearAutoLaunch: true });
      setWindowState(st);
      const refreshed = await window.mc.getSettings();
      setSettings(refreshed);
    } catch {}
  }, []);

  const startCaptureWithSource = useCallback(async (audioSource, micEnabled = false) => {
    const res = await audioRef.current.start({
      audioSource,
      micEnabled,
      micDeviceId: settingsRef.current?.audio?.micDeviceId || '',
      themDeviceId: settingsRef.current?.audio?.themDeviceId || ''
    });
    setCapturing(true);
    setSecondaryMicActive(Boolean(res.secondaryMicActive));
  }, []);

  const stopCaptureNow = useCallback(async () => {
    await audioRef.current.stop();
    setCapturing(false);
    setSecondaryMicActive(false);
  }, []);

  const handleStartSession = useCallback(async (config) => {
    const session = createEmptySession({
      name: config.name,
      templateId: config.templateId,
      audioSource: config.audioSource,
      answerLang: config.answerLang,
      scene: config.scene || 'interview',
      role: config.role || '',
      libraryEnabled: config.libraryEnabled,
      transcriptionMode: config.transcriptionMode || 'auto',
      resume: config.resume || '',
      resumeName: config.resumeName || '',
      jd: config.jd || '',
      jdName: config.jdName || ''
    });
    setSessions(list => [session, ...list]);
    setActiveSessionId(session.id);
    activeSessionIdRef.current = session.id;
    turnAggregatorRef.current?.reset();
    setManualDraft({ ...createManualDraftState(), audioSource: session.audioSource });
    if (typeof config.autoSaveOnClose === 'boolean') {
      void handleUpdateWorkbenchPrefs({ autoSaveOnClose: config.autoSaveOnClose });
    }
    if (config.enableSessionSecurity) {
      await window.mc.enableSecurity({ scope: 'session' }).then(setWindowState).catch(() => {});
    }
    navigateWithFlush('workbench');
    window.mc.prewarm({ resume: session.resume || undefined, jd: session.jd || undefined, immediate: true });
    if (config.autoStartCapture || config.startAudioRecording) {
      try {
        await startCaptureWithSource(
          config.audioSource,
          Boolean((config.enableSecondaryMic || config.startAudioRecording) && config.audioSource === 'system')
        );
      } catch (e) {
        setAsr(prev => ({ ...prev, lastError: e.message }));
      }
    }
    if (config.startAudioRecording) {
      try {
        const st = await window.mc.startRecording?.({
          sessionId: session.id,
          sessionName: session.name,
          role: session.role || '',
          audioSource: session.audioSource
        });
        if (st) setRecordingState(st);
      } catch (e) {
        setAsr(prev => ({ ...prev, lastError: `开启录音失败：${e.message}` }));
      }
    }
  }, [handleUpdateWorkbenchPrefs, navigateWithFlush, startCaptureWithSource]);

  const handleQuickTypeTest = useCallback(() => {
    if (activeSessionIdRef.current && sessionsRef.current.some(s => s.id === activeSessionIdRef.current)) {
      navigateWithFlush('workbench');
      return;
    }
    void handleStartSession({
      name: `快速试问 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      audioSource: 'system',
      answerLang: settingsRef.current?.llm?.answerLang || 'chinese',
      scene: 'interview',
      transcriptionMode: 'transcript-only',
      libraryEnabled: Boolean(library?.enabled),
      role: library?.role || '',
      autoStartCapture: false,
      startAudioRecording: false,
      enableSecondaryMic: false
    });
  }, [handleStartSession, library?.enabled, library?.role, navigateWithFlush]);

  const handleSaveProgressSync = useCallback(async () => {
    const payload = serializeSessionsForDisk(sessionsRef.current, activeSessionIdRef.current);
    return window.mc.saveSessionsSync(payload);
  }, []);

  const finalizeCloseSession = useCallback(async (discardCurrent = false) => {
    turnAggregatorRef.current?.reset();
    try { await window.mc.stopRecording?.(); } catch {}
    await stopCaptureNow();
    const closingId = activeSessionIdRef.current;
    await window.mc.disableSecurity({ scope: 'session' }).then(setWindowState).catch(() => {});
    if (discardCurrent && closingId) {
      try { await window.mc.discardRecording?.(closingId); } catch {}
      setSessions(list => list.filter(s => s.id !== closingId));
    }
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    setManualDraft(createManualDraftState());
    navigateWithFlush('home');
  }, [navigateWithFlush, stopCaptureNow]);

  const handleToggleRecording = useCallback(async () => {
    const cur = sessionsRef.current.find(s => s.id === activeSessionIdRef.current);
    if (!cur) return;
    if (recordingState?.active) {
      try {
        await window.mc.stopRecording?.();
        const st = await window.mc.getRecordingStatus?.();
        if (st) setRecordingState(st);
      } catch {}
      return;
    }
    try {
      if (!capturing) {
        await startCaptureWithSource(cur.audioSource, cur.audioSource === 'system');
      } else if (cur.audioSource === 'system' && !secondaryMicActive) {
        try {
          const res = await audioRef.current.setSecondaryMic(true, settingsRef.current?.audio?.micDeviceId || '');
          setSecondaryMicActive(Boolean(res.secondaryMicActive));
        } catch {}
      }
      const st = await window.mc.startRecording?.({
        sessionId: cur.id,
        sessionName: cur.name,
        role: cur.role || '',
        audioSource: cur.audioSource
      });
      if (st) setRecordingState(st);
    } catch (e) {
      setAsr(prev => ({ ...prev, lastError: `开启录音失败：${e.message}` }));
    }
  }, [capturing, recordingState?.active, secondaryMicActive, startCaptureWithSource]);

  const handleEndSessionSave = useCallback(async () => {
    const res = await handleSaveProgressSync();
    if (!res?.ok) return res;
    await finalizeCloseSession(false);
    return res;
  }, [finalizeCloseSession, handleSaveProgressSync]);

  const handleEndSessionDiscard = useCallback(async () => {
    await finalizeCloseSession(true);
  }, [finalizeCloseSession]);

  const handleEnterWrittenCompact = useCallback(async ({ fresh = false, resumeSessionId = null, name = '', mode, autoSecurity, compactMini } = {}) => {
    try {
      setWrittenError('');
      writtenOriginRef.current = {
        route: routeRef.current === 'written' ? 'home' : routeRef.current,
        homeTab: routeRef.current === 'home' ? homeTabRef.current : 'written'
      };
      if (resumeSessionId) {
        const target = sessionsRef.current.find(s => s.id === resumeSessionId && s.scene === 'written');
        if (target) {
          setWrittenSessionId(target.id);
          writtenSessionIdRef.current = target.id;
        }
      } else if (fresh || !writtenSessionIdRef.current || !sessionsRef.current.some(s => s.id === writtenSessionIdRef.current && s.scene === 'written')) {
        createFreshWrittenSession(name);
      }
      const prevCfg = workbenchPrefsRef.current?.writtenConfig || {};
      const nextMini = typeof compactMini === 'boolean' ? compactMini : Boolean(prevCfg.compactMini);
      const cfgPatch = {};
      if (mode && mode !== prevCfg.mode) cfgPatch.mode = mode;
      if (typeof compactMini === 'boolean' && compactMini !== Boolean(prevCfg.compactMini)) cfgPatch.compactMini = compactMini;
      if (Object.keys(cfgPatch).length) {
        await handleUpdateWorkbenchPrefs({ writtenConfig: { ...prevCfg, ...cfgPatch } });
      }
      // Ensure legacy written-window mode is off so workbench-window owns geometry & 5 core controls cleanly.
      if (settingsRef.current?.writtenWindow?.enabled) {
        const updated = await window.mc.setWrittenWindow({ enabled: false });
        setSettings(updated);
      }
      if (autoSecurity) {
        await window.mc.enableSecurity({ scope: 'session' }).then(setWindowState).catch(() => {});
      }
      setRoute('written');
      const winSt = await window.mc.setWindowMode(nextMini ? 'written-mini' : 'written');
      if (winSt) setWindowState(winSt);
    } catch (e) {
      setWrittenError(e.message);
    }
  }, [createFreshWrittenSession, handleUpdateWorkbenchPrefs]);

  const handleToggleWrittenMini = useCallback(async (nextMini) => {
    const mini = Boolean(nextMini);
    const prevCfg = workbenchPrefsRef.current?.writtenConfig || {};
    await handleUpdateWorkbenchPrefs({ writtenConfig: { ...prevCfg, compactMini: mini } });
    try {
      const st = await window.mc.setWindowMode(mini ? 'written-mini' : 'written');
      if (st) setWindowState(st);
    } catch (e) {
      setWrittenError(e.message);
    }
  }, [handleUpdateWorkbenchPrefs]);

  const handleExitWrittenCompact = useCallback(async () => {
    try {
      if (settingsRef.current?.writtenWindow?.enabled) {
        const updated = await window.mc.setWrittenWindow({ enabled: false });
        setSettings(updated);
      }
      if (!activeSessionIdRef.current) {
        await window.mc.disableSecurity({ scope: 'session' }).then(setWindowState).catch(() => {});
      }
      const origin = writtenOriginRef.current || { route: 'home', homeTab: 'written' };
      if (origin.route === 'home') {
        setHomeTab(origin.homeTab || 'written');
      }
      if (origin.route === 'workbench' && activeSessionIdRef.current) {
        setRoute('workbench');
        const st = await window.mc.setWindowMode('workbench').catch(() => null);
        if (st) setWindowState(st);
      } else {
        setRoute(origin.route || 'home');
        const st = await window.mc.setWindowMode('home').catch(() => null);
        if (st) setWindowState(st);
      }
    } catch (e) {
      setWrittenError(e.message);
    }
  }, []);

  const handleEndWrittenSession = useCallback(() => {
    const wid = writtenSessionIdRef.current;
    if (wid) {
      const cur = sessionsRef.current.find(s => s.id === wid);
      // Drop empty placeholder written sessions cleanly so history isn't cluttered with 0-question entries
      if (cur && !(cur.questions?.length > 0)) {
        setSessions(list => list.filter(s => s.id !== wid));
      }
    }
    setWrittenSessionId(null);
    writtenSessionIdRef.current = null;
  }, []);

  const handleResumeFromRecord = useCallback((sid) => {
    const target = sessionsRef.current.find(s => s.id === sid);
    if (!target) return;
    if (target.scene === 'written') {
      setHomeTab('written');
      void handleEnterWrittenCompact({ resumeSessionId: sid });
      return;
    }
    setActiveSessionId(sid);
    activeSessionIdRef.current = sid;
    setManualDraft({ ...createManualDraftState(), audioSource: target.audioSource });
    navigateWithFlush('workbench');
  }, [handleEnterWrittenCompact, navigateWithFlush]);

  const handleToggleCapture = useCallback(async () => {
    const cur = sessionsRef.current.find(s => s.id === activeSessionIdRef.current);
    if (!cur) return;
    if (capturing) {
      await stopCaptureNow();
    } else {
      try {
        await startCaptureWithSource(cur.audioSource, secondaryMicActive);
      } catch (e) {
        setAsr(prev => ({ ...prev, lastError: e.message }));
      }
    }
  }, [capturing, secondaryMicActive, startCaptureWithSource, stopCaptureNow]);

  actionsRef.current = { navigateWithFlush, handleToggleCapture };

  const handleSwitchAudioSource = useCallback(async (nextSource) => {
    const cur = sessionsRef.current.find(s => s.id === activeSessionIdRef.current);
    if (!cur || cur.audioSource === nextSource) return;
    patchSessionById(cur.id, s => ({ ...s, audioSource: nextSource }));
    setManualDraft(prev => handleAudioSourceSwitch(prev, nextSource, 'clear').nextState);
    if (capturing) {
      try {
        await startCaptureWithSource(nextSource, false);
      } catch (e) {
        setAsr(prev => ({ ...prev, lastError: e.message }));
      }
    }
  }, [capturing, patchSessionById, startCaptureWithSource]);

  const handleToggleSecondaryMic = useCallback(async () => {
    const next = !secondaryMicActive;
    try {
      const res = await audioRef.current.setSecondaryMic(next, settingsRef.current?.audio?.micDeviceId || '');
      setSecondaryMicActive(Boolean(res.secondaryMicActive));
    } catch (e) {
      setAsr(prev => ({ ...prev, lastError: e.message }));
    }
  }, [secondaryMicActive]);

  const handleTranslateSegment = useCallback(async (seg) => {
    const sid = activeSessionIdRef.current;
    if (!sid || !seg?.text) return;
    try {
      const zh = await window.mc.translate(seg.text);
      patchSessionById(sid, s => setSegmentTranslation(s, seg.id, { translation: zh, error: '' }));
    } catch (e) {
      patchSessionById(sid, s => setSegmentTranslation(s, seg.id, { error: e.message || '翻译失败' }));
    }
  }, [patchSessionById]);

  const handleTranslateAnswer = useCallback(async (questionId, attemptId, text, targetLang = 'zh-CN') => {
    const sid = activeSessionIdRef.current;
    if (!sid || !text) return;
    try {
      const translated = await window.mc.translate(text, targetLang);
      patchSessionById(sid, s => setAttemptTranslation(s, questionId, attemptId, { translation: translated, error: '' }));
    } catch (e) {
      patchSessionById(sid, s => setAttemptTranslation(s, questionId, attemptId, { error: e.message || '翻译失败' }));
    }
  }, [patchSessionById]);

  if (!settings) {
    return (
      <div className="mc-shell" style={{ alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        正在加载 CueDesk…
      </div>
    );
  }

  if (route === 'written' || isWrittenCompact) {
    // Strictly bind ONLY to the active written-exam session (NEVER falls back to interview session — fixes M02)
    const curWritten = activeWrittenSession;
    const visionReady = Boolean(
      settings.multimodal?.enabled &&
      (settings.multimodal?.endpoints || []).some(e => e.enabled && e.baseUrl && e.model)
    );
    return (
      <WrittenCompactView
        settings={settings}
        workbenchPrefs={workbenchPrefs}
        windowState={windowState}
        hoverInside={hoverInside}
        writtenSession={curWritten}
        ready={visionReady}
        error={writtenError}
        batch={batch}
        batchController={batchController}
        onCapture={(mode) => void batchController.take(mode, '', undefined, 'written')}
        onFollowupSend={handleWrittenFollowup}
        onRegenerateQuestion={handleRegenerateWrittenQuestion}
        onSelectQuestion={(qid) => curWritten && patchSessionById(curWritten.id, s => selectQuestion(s, qid))}
        onCancel={handleCancelAttempt}
        onRestore={() => void handleExitWrittenCompact()}
        onNewSession={() => { createFreshWrittenSession(); setWrittenError(''); }}
        onEndSession={() => { handleEndWrittenSession(); void handleExitWrittenCompact(); }}
        onOpenVisionSettings={() => {
          void handleExitWrittenCompact().then(() => navigateToCapability('vision'));
        }}
        onUpdatePrefs={handleUpdateWorkbenchPrefs}
        onSetAlwaysOnTop={(on) => window.mc.setAlwaysOnTop(on).then(setWindowState)}
        onSetPreventFocus={(on) => window.mc.setPreventFocus(on).then(setWindowState)}
        onSetAllowCapture={(allow) => window.mc.setAllowCapture(allow).then(async (st) => { setWindowState(st); setSettings(await window.mc.getSettings()); })}
        onSetClickThrough={(on) => window.mc.setClickThrough(on).then(setWindowState)}
        onToggleMiniMode={(nextMini) => void handleToggleWrittenMini(nextMini)}
        onSettingsUpdated={setSettings}
        onOpenFullSettings={() => {
          void handleExitWrittenCompact().then(() => navigateToCapability('shortcuts'));
        }}
      />
    );
  }

  if (route === 'workbench' && activeSession) {
    return (
      <WorkbenchView
        session={activeSession}
        settings={settings}
        library={library}
        asr={asr}
        hud={hud}
        capturing={capturing}
        secondaryMicActive={secondaryMicActive}
        recordingState={recordingState}
        partials={partials}
        pendingTurnText={pendingTurnText}
        manualDraft={manualDraft}
        workbenchPrefs={workbenchPrefs}
        windowState={windowState}
        hoverInside={hoverInside}
        onBackHome={() => navigateWithFlush('home')}
        onToggleCapture={() => void handleToggleCapture()}
        onToggleRecording={() => void handleToggleRecording()}
        onSwitchAudioSource={(src) => void handleSwitchAudioSource(src)}
        onToggleSecondaryMic={() => void handleToggleSecondaryMic()}
        onCaptureScreen={(mode) => void batchController.take(mode, '', undefined, 'interview')}
        onEnterWrittenCompact={() => void handleEnterWrittenCompact({ fresh: !activeWrittenSession })}
        onAskText={(q, segIds) => handleAskText(q, segIds)}
        onRegenerateQuestion={handleRegenerateQuestion}
        onCancelAttempt={handleCancelAttempt}
        onSelectQuestion={(qid) => patchSessionById(activeSession.id, s => selectQuestion(s, qid))}
        onSelectAttempt={(qid, aid) => patchSessionById(activeSession.id, s => selectAttempt(s, qid, aid))}
        onJumpLatest={() => patchSessionById(activeSession.id, s => jumpToLatestQuestion(s))}
        onMergeQuestions={(srcId, dstId) => patchSessionById(activeSession.id, s => mergeQuestions(s, srcId, dstId))}
        onClearSessionContent={() => {
          turnAggregatorRef.current?.reset();
          patchSessionById(activeSession.id, s => ({ ...s, questions: [], segments: [], selectedQuestionId: null, unreadQuestionIds: [] }));
        }}
        onCommitManualDraft={() => {
          const committed = commitManualDraft(manualDraft);
          setManualDraft(committed.nextState);
          if (committed.prompt) handleAskText(committed.prompt, committed.sourceSegmentIds, { mode: 'segment', forceSelect: true });
        }}
        onClearManualDraft={() => setManualDraft(prev => clearManualDraft(prev))}
        onChangeSessionMeta={(patch) => {
          if (patch.transcriptionMode !== undefined) turnAggregatorRef.current?.reset();
          patchSessionById(activeSession.id, s => ({ ...s, ...patch }));
        }}
        onTranslateSegment={handleTranslateSegment}
        onTranslateAnswer={handleTranslateAnswer}
        onClearTranscript={() => {
          turnAggregatorRef.current?.reset();
          patchSessionById(activeSession.id, s => ({ ...s, segments: [] }));
        }}
        onUpdatePrefs={handleUpdateWorkbenchPrefs}
        onSetAlwaysOnTop={(on) => window.mc.setAlwaysOnTop(on).then(setWindowState)}
        onSetPreventFocus={(on) => window.mc.setPreventFocus(on).then(setWindowState)}
        onSetAllowCapture={(allow) => window.mc.setAllowCapture(allow).then(async (st) => { setWindowState(st); setSettings(await window.mc.getSettings()); })}
        onSetClickThrough={(on) => window.mc.setClickThrough(on).then(setWindowState)}
        onSaveProgressSync={handleSaveProgressSync}
        onEndSessionSave={handleEndSessionSave}
        onEndSessionDiscard={handleEndSessionDiscard}
        onSettingsUpdated={setSettings}
        onNavigateCapability={navigateToCapability}
        onOpenSettings={() => navigateToCapability('text-llm')}
        onOpenKnowledgeSettings={() => navigateToCapability('kb')}
      />
    );
  }

  return (
    <>
      <AppShell
        route={route}
        onNavigate={(next) => navigateWithFlush(next)}
        settings={settings}
        asr={asr}
        library={library}
        windowState={windowState}
        activeSession={activeSession}
        onResumeWorkbench={() => navigateWithFlush('workbench')}
        onToggleSecurity={(next) => void handleToggleSecurity(next)}
        onOpenHealth={() => setModal('health')}
        onMinimize={() => void window.mc.minimizeWindow()}
        onToggleMaximize={() => void window.mc.toggleMaximizeWindow()}
        onQuit={() => window.mc.quit()}
      >
        {route === 'home' && (
          <HomeView
            homeTab={homeTab}
            onChangeHomeTab={setHomeTab}
            templatesStore={templatesStore}
            onSaveTemplates={handleSaveTemplates}
            settings={settings}
            asr={asr}
            library={library}
            workbenchPrefs={workbenchPrefs}
            windowState={windowState}
            activeSession={activeSession}
            activeWrittenSession={activeWrittenSession}
            onStartSession={(cfg) => void handleStartSession(cfg)}
            onResumeWorkbench={() => navigateWithFlush('workbench')}
            onEndActiveSession={() => void handleEndSessionSave()}
            onNavigateCapability={navigateToCapability}
            onOpenSettings={(tab) => navigateWithFlush('settings', tab)}
            onEnterWrittenCompact={(opts) => void handleEnterWrittenCompact(opts)}
            onEndWrittenSession={handleEndWrittenSession}
            onQuickCaptureWritten={(mode) => void batchController.take(mode, '', undefined, 'written')}
            onUpdateWorkbenchPrefs={handleUpdateWorkbenchPrefs}
            onSettingsUpdated={setSettings}
            batch={batch}
            batchController={batchController}
          />
        )}

        {route === 'knowledge' && (
          <KnowledgeView
            library={library}
            onLibraryUpdated={setLibrary}
            settings={settings}
            onSettingsUpdated={setSettings}
          />
        )}

        {route === 'records' && (
          <RecordsView
            sessions={sessions}
            activeSessionId={activeSessionId}
            library={library}
            workbenchPrefs={workbenchPrefs}
            onUpdateWorkbenchPrefs={handleUpdateWorkbenchPrefs}
            onResumeFromRecord={handleResumeFromRecord}
            onRenameSession={(id, name) => patchSessionById(id, s => ({ ...s, name }))}
            onDeleteSession={(id) => {
              void window.mc.discardRecording?.(id).catch(() => {});
              if (id === writtenSessionIdRef.current) {
                setWrittenSessionId(null);
                writtenSessionIdRef.current = null;
              }
              setSessions(list => list.filter(s => s.id !== id));
            }}
          />
        )}

        {route === 'settings' && (
          <ErrorBoundary inline fallbackLabel="设置页渲染异常">
            <SettingsView
              initialTab={settingsTab}
              focusRequest={settingsFocus}
              settings={settings}
              workbenchPrefs={workbenchPrefs}
              windowState={windowState}
              activeSession={activeSession}
              onSaved={setSettings}
              onUpdateWorkbenchPrefs={handleUpdateWorkbenchPrefs}
              onToggleSecurity={(next) => void handleToggleSecurity(next)}
              onSetSecurityPrefs={(patch) => void window.mc.setSecurityPrefs(patch).then(setWindowState).catch(() => {})}
              onResumeWorkbench={() => navigateWithFlush('workbench')}
              onOpenQuickStart={() => setModal('quickstart')}
              onOpenDiagnostics={() => setModal('diagnostics')}
              closeRef={settingsCloseRef}
            />
          </ErrorBoundary>
        )}
      </AppShell>

      {modal === 'health' && (
        <ServiceHealthModal
          settings={settings}
          asr={asr}
          library={library}
          activeSession={activeSession}
          onClose={() => setModal(null)}
          onNavigateCapability={navigateToCapability}
          onResumeWorkbench={() => navigateWithFlush('workbench')}
          onQuickTypeTest={handleQuickTypeTest}
          onSettingsRefreshed={setSettings}
        />
      )}
      {modal === 'quickstart' && (
        <QuickStartModal
          settings={settings}
          asr={asr}
          library={library}
          onClose={() => setModal(null)}
          onNavigateCapability={navigateToCapability}
        />
      )}
      {modal === 'diagnostics' && <DiagnosticsModal onClose={() => setModal(null)} />}
      {modal === 'help' && (
        <HelpModal
          onClose={() => setModal(null)}
          onNavigateCapability={navigateToCapability}
          onOpenDiagnostics={() => setModal('diagnostics')}
          onOpenQuickStart={() => setModal('quickstart')}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
