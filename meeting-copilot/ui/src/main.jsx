import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LoopbackCapture, MicCapture } from '@mc/runtime';
import {
  addQuestionWithAttempt,
  appendSegment,
  applyLlmEvent,
  buildLlmHistory,
  cancelAttempt,
  createEmptySession,
  createId,
  jumpToLatestQuestion,
  mergeQuestions,
  migrateSessionsFile,
  regenerateQuestion,
  selectAttempt,
  selectQuestion,
  serializeSessionsForDisk,
  setAttemptTranslation,
  setSegmentTranslation
} from './core/sessionModel.js';
import {
  appendManualDraft,
  classifyTurn,
  clearManualDraft,
  commitManualDraft,
  createManualDraftState,
  handleAudioSourceSwitch
} from './core/turnPolicy.js';
import { createAudioController } from './core/audioController.js';
import { AppShell } from './components/AppShell.jsx';
import { HomeView } from './components/HomeView.jsx';
import { KnowledgeView } from './components/KnowledgeView.jsx';
import { RecordsView } from './components/RecordsView.jsx';
import { SettingsView } from './components/SettingsView.jsx';
import { WrittenCompactView } from './components/WrittenCompactView.jsx';
import { WorkbenchView } from './components/WorkbenchView.jsx';
import { DiagnosticsModal, HelpModal, ServiceHealthModal } from './components/SharedWidgets.jsx';

// Signal to main-process window-controls.cjs that UI Next manages layered opacity tokens.
document.documentElement.dataset.uiNext = '1';

function percentile(values, p) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function createScreenshotBatch({ capture, send, isWritten, getSession, onChange }) {
  let state = { enabled: false, images: [], question: '', busy: false, message: '' };
  const snapshot = () => ({ ...state, images: [...state.images] });
  const update = (patch) => { state = { ...state, ...patch }; onChange(snapshot()); };
  function toggle() {
    if (state.busy) return update({ message: '截图中，请完成或取消框选后再切换模式' });
    if (!isWritten()) return update({ message: '请先切换到笔试模式' });
    update({ enabled: !state.enabled, message: state.enabled ? '已关闭多图；暂存截图保留，不会自动发送' : '多图已开启：按截图键逐张暂存，再统一发送' });
  }
  async function take(mode = 'full', question = '', displayId) {
    if (state.busy) return false;
    const batch = state.enabled && isWritten();
    const session = getSession();
    if (batch && state.images.length >= 12) { update({ message: '已暂存 12 张，请先发送或移除截图' }); return false; }
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
        });
      } else {
        if (!session || session !== getSession()) throw new Error('会话已变化，请重新截图');
        send(question, dataUrl);
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
    if (state.busy) return update({ message: '截图中，请先完成框选' });
    if (!isWritten()) return update({ message: '请先切换到笔试模式再发送暂存截图' });
    if (!state.images.length) return update({ message: '没有暂存截图' });
    if (!getSession()) return update({ message: '会话尚未就绪' });
    try {
      send(state.question, undefined, state.images.map(img => img.dataUrl));
      update({ images: [], question: '', message: '全部暂存截图已提交' });
    } catch (e) {
      update({ message: '发送失败：' + e.message });
    }
  }
  return {
    snapshot,
    take,
    toggle,
    sendBatch,
    question: (value) => update({ question: value }),
    remove: (idx) => { if (!state.busy) update({ images: state.images.filter((_, i) => i !== idx) }); },
    clear: () => { if (!state.busy) update({ images: [], message: '暂存已清空' }); }
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
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [route, setRoute] = useState('home'); // 'home' | 'knowledge' | 'records' | 'settings' | 'workbench'
  const [settingsTab, setSettingsTab] = useState('models');
  const [asr, setAsr] = useState({ phase: 'loading', workerState: 'loading' });
  const [hud, setHud] = useState({ count: 0 });
  const [capturing, setCapturing] = useState(false);
  const [secondaryMicActive, setSecondaryMicActive] = useState(false);
  const [recordingState, setRecordingState] = useState({ active: false, durationSec: 0, themBytes: 0, meBytes: 0 });
  const [partials, setPartials] = useState({});
  const [manualDraft, setManualDraft] = useState(createManualDraftState);
  const [modal, setModal] = useState(null); // 'health' | 'diagnostics' | 'help' | null
  const [writtenError, setWrittenError] = useState('');
  const [batch, setBatch] = useState({ enabled: false, images: [], question: '', busy: false, message: '' });

  const loadedRef = useRef(false);
  const settingsRef = useRef(null);
  const sessionsRef = useRef([]);
  const activeSessionIdRef = useRef(null);
  const workbenchPrefsRef = useRef(null);
  const settingsCloseRef = useRef(null);
  const audioRef = useRef(null);
  const e2eSamplesRef = useRef([]);
  const memoChainRef = useRef(new Map());
  const autoTurnTimerRef = useRef(null);
  const actionsRef = useRef({});

  settingsRef.current = settings;
  sessionsRef.current = sessions;
  activeSessionIdRef.current = activeSessionId;
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
      codingPrefs: workbenchPrefsRef.current?.codingPrefs,
      dialogueThinking: Boolean(workbenchPrefsRef.current?.dialogueThinking)
    });
  }, [buildLibraryOverrideFor]);

  const handleAskText = useCallback((promptText, sourceSegmentIds = [], { mode = 'free', forceSelect = true } = {}) => {
    const sid = activeSessionIdRef.current;
    const cur = sessionsRef.current.find(s => s.id === sid);
    const clean = String(promptText || '').trim();
    if (!cur || !clean) return;
    const requestId = createId('req');
    patchSessionById(cur.id, (s) => addQuestionWithAttempt(s, {
      requestId,
      prompt: clean,
      kind: mode === 'continuous' || mode === 'segment' ? 'segment' : 'free',
      sourceSegmentIds,
      forceSelect
    }));
    dispatchLlmAsk(cur, { requestId, mode, prompt: clean });
  }, [dispatchLlmAsk, patchSessionById]);

  const handleRegenerateQuestion = useCallback((questionId) => {
    const sid = activeSessionIdRef.current;
    const cur = sessionsRef.current.find(s => s.id === sid);
    const q = cur?.questions?.find(item => item.id === questionId);
    if (!cur || !q) return;
    // Cancel any currently streaming attempt on this question
    for (const att of q.attempts) {
      if (att.status === 'streaming') window.mc.llmCancel(att.requestId);
    }
    const requestId = createId('req');
    patchSessionById(cur.id, (s) => regenerateQuestion(s, questionId, { requestId }));
    dispatchLlmAsk(cur, { requestId, mode: 'free', prompt: q.prompt, excludeQuestionId: questionId });
  }, [dispatchLlmAsk, patchSessionById]);

  const handleCancelAttempt = useCallback((requestId) => {
    const sid = activeSessionIdRef.current;
    window.mc.llmCancel(requestId);
    if (sid) patchSessionById(sid, (s) => cancelAttempt(s, requestId));
  }, [patchSessionById]);

  const ensureSessionForWritten = useCallback(() => {
    if (activeSessionIdRef.current) {
      const existing = sessionsRef.current.find(s => s.id === activeSessionIdRef.current);
      if (existing) return existing;
    }
    const created = createEmptySession({ name: '笔试会话', scene: 'written' });
    setSessions(list => [created, ...list]);
    setActiveSessionId(created.id);
    activeSessionIdRef.current = created.id;
    return created;
  }, []);

  const sendShotQuestion = useCallback((questionText, dataUrl, dataUrls, extra = {}) => {
    const targetSession = activeSessionIdRef.current
      ? sessionsRef.current.find(s => s.id === activeSessionIdRef.current)
      : ensureSessionForWritten();
    if (!targetSession) return;
    const requestId = createId('shot');
    const images = dataUrls || (dataUrl ? [dataUrl] : []);
    const prompt = String(questionText || '').trim() || (images.length > 1 ? `多图截图提问 (${images.length} 张)` : '截图提问');
    patchSessionById(targetSession.id, (s) =>
      addQuestionWithAttempt(s, {
        requestId,
        prompt,
        kind: images.length > 1 ? 'batch' : 'shot',
        images,
        forceSelect: true
      })
    );
    window.mc.shotAsk({
      requestId,
      question: questionText || '',
      imageDataUrl: dataUrl,
      imageDataUrls: dataUrls,
      scene: extra.scene || targetSession.scene,
      answerLang: targetSession.answerLang,
      displayId: extra.displayId ?? workbenchPrefsRef.current?.captureDisplayId,
      codingPrefs: workbenchPrefsRef.current?.codingPrefs,
      libraryOverride: buildLibraryOverrideFor(targetSession)
    });
  }, [buildLibraryOverrideFor, ensureSessionForWritten, patchSessionById]);

  const batchController = useMemo(() => createScreenshotBatch({
    capture: (mode, displayId) => window.mc.pickRegion(mode, displayId ?? workbenchPrefsRef.current?.captureDisplayId),
    send: (q, dataUrl, dataUrls) => sendShotQuestion(q, dataUrl, dataUrls),
    isWritten: () => settingsRef.current?.multimodal?.mode === 'written' || Boolean(settingsRef.current?.writtenWindow?.enabled),
    getSession: () => activeSessionIdRef.current || ensureSessionForWritten().id,
    onChange: setBatch
  }), [sendShotQuestion, ensureSessionForWritten]);

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
          const segId = cur.nextSegmentId || 1;
          patchSessionById(cur.id, (s) => appendSegment(s, {
            id: segId,
            speaker: ev.speaker,
            text: ev.text,
            startTs: ev.timings?.speechStartTs,
            endTs: ev.timings?.speechEndTs
          }));
          if ((ev.speaker ?? 'them') === 'them') {
            if (cur.transcriptionMode === 'manual') {
              setManualDraft(prev => appendManualDraft(prev, { id: segId, text: ev.text, endTs: ev.timings?.speechEndTs }));
            } else if (cur.transcriptionMode === 'auto') {
              const verdict = classifyTurn(ev.text);
              if (verdict.action === 'answer') {
                clearTimeout(autoTurnTimerRef.current);
                autoTurnTimerRef.current = setTimeout(() => {
                  const latestSess = sessionsRef.current.find(s => s.id === cur.id);
                  if (!latestSess || latestSess.transcriptionMode !== 'auto') return;
                  handleAskText(ev.text, [segId], { mode: 'continuous', forceSelect: false });
                }, 1050);
              }
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
      else if (command === 'open-help') setModal('help');
      else if (command === 'toggle-capture') void actionsRef.current.handleToggleCapture?.();
    });
    window.__mcOpenSettings = () => actionsRef.current.navigateWithFlush?.('settings');
    window.__mcOpenHelp = () => setModal('help');

    return () => {
      alive = false;
      clearTimeout(autoTurnTimerRef.current);
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
  }, [batchController, enqueueMemoUpdate, handleAskText, patchSessionById]);

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

  const navigateWithFlush = useCallback((nextRoute, tab) => {
    const proceed = () => {
      if (tab) setSettingsTab(tab);
      setRoute(nextRoute);
      if (nextRoute === 'workbench') {
        void window.mc.setWindowMode('workbench').catch(() => {});
      } else {
        void window.mc.setWindowMode('home').catch(() => {});
      }
    };
    if (route === 'settings' && settingsCloseRef.current) {
      void settingsCloseRef.current(proceed);
    } else {
      proceed();
    }
  }, [route]);

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
        await startCaptureWithSource(config.audioSource, Boolean(config.startAudioRecording && config.audioSource === 'system'));
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

  const handleSaveProgressSync = useCallback(async () => {
    const payload = serializeSessionsForDisk(sessionsRef.current, activeSessionIdRef.current);
    return window.mc.saveSessionsSync(payload);
  }, []);

  const finalizeCloseSession = useCallback(async (discardCurrent = false) => {
    clearTimeout(autoTurnTimerRef.current);
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

  const handleResumeFromRecord = useCallback((sid) => {
    const target = sessionsRef.current.find(s => s.id === sid);
    if (!target) return;
    setActiveSessionId(sid);
    activeSessionIdRef.current = sid;
    setManualDraft({ ...createManualDraftState(), audioSource: target.audioSource });
    navigateWithFlush('workbench');
  }, [navigateWithFlush]);

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

  const handleEnterWrittenCompact = useCallback(async () => {
    try {
      setWrittenError('');
      const updated = await window.mc.setWrittenWindow({ enabled: true });
      setSettings(updated);
    } catch (e) {
      setWrittenError(e.message);
    }
  }, []);

  const handleExitWrittenCompact = useCallback(async () => {
    try {
      const updated = await window.mc.setWrittenWindow({ enabled: false });
      setSettings(updated);
    } catch (e) {
      setWrittenError(e.message);
    }
  }, []);

  if (!settings) {
    return (
      <div className="mc-shell" style={{ alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        正在加载 MeetingCopilot…
      </div>
    );
  }

  if (isWrittenCompact) {
    const curSess = activeSession || sessions[0] || null;
    const latestQ = curSess?.questions?.length ? curSess.questions[curSess.questions.length - 1] : null;
    const visionReady = Boolean(
      settings.multimodal?.enabled &&
      (settings.multimodal?.endpoints || []).some(e => e.enabled && e.baseUrl && e.model)
    );
    return (
      <WrittenCompactView
        preferences={settings.writtenWindow}
        latestQuestion={latestQ}
        ready={visionReady}
        error={writtenError}
        onPatch={async (patch) => {
          try { setSettings(await window.mc.setWrittenWindow(patch)); }
          catch (e) { setWrittenError(e.message); }
        }}
        onCancel={handleCancelAttempt}
        onRestore={() => void handleExitWrittenCompact()}
        batch={batch}
        batchController={batchController}
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
        manualDraft={manualDraft}
        workbenchPrefs={workbenchPrefs}
        windowState={windowState}
        hoverInside={hoverInside}
        onBackHome={() => navigateWithFlush('home')}
        onToggleCapture={() => void handleToggleCapture()}
        onToggleRecording={() => void handleToggleRecording()}
        onSwitchAudioSource={(src) => void handleSwitchAudioSource(src)}
        onToggleSecondaryMic={() => void handleToggleSecondaryMic()}
        onCaptureScreen={(mode) => void batchController.take(mode)}
        onEnterWrittenCompact={() => void handleEnterWrittenCompact()}
        onAskText={(q, segIds) => handleAskText(q, segIds)}
        onRegenerateQuestion={handleRegenerateQuestion}
        onCancelAttempt={handleCancelAttempt}
        onSelectQuestion={(qid) => patchSessionById(activeSession.id, s => selectQuestion(s, qid))}
        onSelectAttempt={(qid, aid) => patchSessionById(activeSession.id, s => selectAttempt(s, qid, aid))}
        onJumpLatest={() => patchSessionById(activeSession.id, s => jumpToLatestQuestion(s))}
        onMergeQuestions={(srcId, dstId) => patchSessionById(activeSession.id, s => mergeQuestions(s, srcId, dstId))}
        onClearSessionContent={() => patchSessionById(activeSession.id, s => ({ ...s, questions: [], segments: [], selectedQuestionId: null, unreadQuestionIds: [] }))}
        onCommitManualDraft={() => {
          const committed = commitManualDraft(manualDraft);
          setManualDraft(committed.nextState);
          if (committed.prompt) handleAskText(committed.prompt, committed.sourceSegmentIds, { mode: 'segment', forceSelect: true });
        }}
        onClearManualDraft={() => setManualDraft(prev => clearManualDraft(prev))}
        onChangeSessionMeta={(patch) => patchSessionById(activeSession.id, s => ({ ...s, ...patch }))}
        onTranslateSegment={handleTranslateSegment}
        onTranslateAnswer={handleTranslateAnswer}
        onClearTranscript={() => patchSessionById(activeSession.id, s => ({ ...s, segments: [] }))}
        onUpdatePrefs={handleUpdateWorkbenchPrefs}
        onSetAlwaysOnTop={(on) => window.mc.setAlwaysOnTop(on).then(setWindowState)}
        onSetPreventFocus={(on) => window.mc.setPreventFocus(on).then(setWindowState)}
        onSetAllowCapture={(allow) => window.mc.setAllowCapture(allow).then(async (st) => { setWindowState(st); setSettings(await window.mc.getSettings()); })}
        onSetClickThrough={(on) => window.mc.setClickThrough(on).then(setWindowState)}
        onSaveProgressSync={handleSaveProgressSync}
        onEndSessionSave={handleEndSessionSave}
        onEndSessionDiscard={handleEndSessionDiscard}
        onSettingsUpdated={setSettings}
        onOpenSettings={() => navigateWithFlush('settings', 'models')}
        onOpenKnowledgeSettings={() => navigateWithFlush('knowledge')}
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
            templatesStore={templatesStore}
            onSaveTemplates={handleSaveTemplates}
            settings={settings}
            asr={asr}
            library={library}
            workbenchPrefs={workbenchPrefs}
            windowState={windowState}
            activeSession={activeSession}
            onStartSession={(cfg) => void handleStartSession(cfg)}
            onResumeWorkbench={() => navigateWithFlush('workbench')}
            onEndActiveSession={() => void handleEndSessionSave()}
            onOpenSettings={(tab) => navigateWithFlush('settings', tab)}
            onEnterWrittenCompact={() => void handleEnterWrittenCompact()}
            onQuickCaptureWritten={(mode) => void batchController.take(mode)}
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
              setSessions(list => list.filter(s => s.id !== id));
            }}
          />
        )}

        {route === 'settings' && (
          <SettingsView
            initialTab={settingsTab}
            settings={settings}
            workbenchPrefs={workbenchPrefs}
            windowState={windowState}
            onSaved={setSettings}
            onUpdateWorkbenchPrefs={handleUpdateWorkbenchPrefs}
            onToggleSecurity={(next) => void handleToggleSecurity(next)}
            onSetSecurityPrefs={(patch) => void window.mc.setSecurityPrefs(patch).then(setWindowState).catch(() => {})}
            closeRef={settingsCloseRef}
          />
        )}
      </AppShell>

      {modal === 'health' && (
        <ServiceHealthModal
          settings={settings}
          asr={asr}
          library={library}
          onClose={() => setModal(null)}
          onOpenSettings={(tab) => navigateWithFlush('settings', tab)}
          onOpenDiagnostics={() => setModal('diagnostics')}
          onSettingsRefreshed={setSettings}
        />
      )}
      {modal === 'diagnostics' && <DiagnosticsModal onClose={() => setModal(null)} />}
      {modal === 'help' && (
        <HelpModal
          onClose={() => setModal(null)}
          onOpenSettings={(tab) => navigateWithFlush('settings', tab)}
          onOpenDiagnostics={() => setModal('diagnostics')}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
