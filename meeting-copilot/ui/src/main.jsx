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
  migrateSessionsFile,
  projectLegacyTurns,
  serializeSessionsForDisk
} from './core/sessionModel.js';
import { createAudioController } from './core/audioController.js';
import { AppShell } from './components/AppShell.jsx';
import { HomeView } from './components/HomeView.jsx';
import { KnowledgeView } from './components/KnowledgeView.jsx';
import { RecordsView } from './components/RecordsView.jsx';
import { SettingsView } from './components/SettingsView.jsx';
import { WrittenCompactView } from './components/WrittenCompactView.jsx';
import { DiagnosticsModal, HelpModal, ServiceHealthModal } from './components/SharedWidgets.jsx';

// Signal to main-process window-controls.cjs that UI Next manages layered opacity tokens.
document.documentElement.dataset.uiNext = '1';

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
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [route, setRoute] = useState('home'); // 'home' | 'knowledge' | 'records' | 'settings' | 'workbench'
  const [settingsTab, setSettingsTab] = useState('models');
  const [asr, setAsr] = useState({ phase: 'loading', workerState: 'loading' });
  const [capturing, setCapturing] = useState(false);
  const [partials, setPartials] = useState({});
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
      libraryOverride: targetSession.libraryEnabled !== null || targetSession.role
        ? {
            ...(typeof targetSession.libraryEnabled === 'boolean' ? { enabled: targetSession.libraryEnabled } : {}),
            ...(targetSession.role ? { role: targetSession.role } : {})
          }
        : undefined
    });
  }, [ensureSessionForWritten, patchSessionById]);

  const batchController = useMemo(() => createScreenshotBatch({
    capture: (mode, displayId) => window.mc.pickRegion(mode, displayId ?? workbenchPrefsRef.current?.captureDisplayId),
    send: (q, dataUrl, dataUrls) => sendShotQuestion(q, dataUrl, dataUrls),
    isWritten: () => settingsRef.current?.multimodal?.mode === 'written' || Boolean(settingsRef.current?.writtenWindow?.enabled),
    getSession: () => activeSessionIdRef.current || ensureSessionForWritten().id,
    onChange: setBatch
  }), [sendShotQuestion, ensureSessionForWritten]);

  // Initial load of settings, sessions, templates, library, workbench prefs, window state
  useEffect(() => {
    let alive = true;
    Promise.all([
      window.mc.getSettings(),
      window.mc.loadSessions(),
      window.mc.loadTemplates().catch(() => ({ version: 1, groups: [{ id: 'group-default', name: '默认分组', order: 0, collapsed: false }], templates: [] })),
      window.mc.getInterviewLibrary().catch(() => null),
      window.mc.getWorkbenchPrefs().catch(() => null),
      window.mc.getWindowState().catch(() => null)
    ]).then(([s, rawSessions, tpls, lib, prefs, winSt]) => {
      if (!alive) return;
      setSettings(s);
      const migrated = migrateSessionsFile(rawSessions);
      setSessions(migrated.sessions);
      setTemplatesStore(tpls);
      setLibrary(lib);
      setWorkbenchPrefs(prefs);
      setWindowState(winSt);
      loadedRef.current = true;
    }).catch(() => {});

    const offWritten = window.mc.onWrittenWindowState?.((prefs) => {
      setSettings(prev => (prev ? { ...prev, writtenWindow: prefs } : prev));
    });
    const offWin = window.mc.onWindowState?.((st) => setWindowState(st));
    const offPrefs = window.mc.onWorkbenchPrefsState?.((p) => setWorkbenchPrefs(p));
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
        const sid = activeSessionIdRef.current;
        if (sid) {
          patchSessionById(sid, (s) => appendSegment(s, {
            speaker: ev.speaker,
            text: ev.text,
            startTs: ev.timings?.speechStartTs,
            endTs: ev.timings?.speechEndTs
          }));
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
    });
    const offShot = window.mc.onShotHotkey((mode) => void batchController.take(mode));
    const offBatch = window.mc.onScreenshotBatchAction((action) => {
      if (action === 'toggleBatch') batchController.toggle();
      if (action === 'sendBatch') batchController.sendBatch();
    });
    const offTray = window.mc.onTrayCommand(({ command }) => {
      if (command === 'open-settings') navigateWithFlush('settings');
      else if (command === 'open-health') setModal('health');
      else if (command === 'open-help') setModal('help');
    });

    return () => {
      alive = false;
      offWritten?.();
      offWin?.();
      offPrefs?.();
      offAsr?.();
      offLlm?.();
      offShot?.();
      offBatch?.();
      offTray?.();
      window.removeEventListener('mc-library-updated', onLibEvt);
    };
  }, [batchController, patchSessionById]);

  // Apply theme & font scale tokens
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

  // Written compact dataset flag
  const isWrittenCompact = Boolean(settings?.writtenWindow?.enabled);
  useEffect(() => {
    document.documentElement.dataset.writtenCompact = isWrittenCompact ? 'true' : 'false';
  }, [isWrittenCompact]);

  // Debounced sessions persistence
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
    if (typeof config.autoSaveOnClose === 'boolean') {
      void handleUpdateWorkbenchPrefs({ autoSaveOnClose: config.autoSaveOnClose });
    }
    if (config.enableSessionSecurity) {
      await window.mc.enableSecurity({ scope: 'session' }).then(setWindowState).catch(() => {});
    }
    navigateWithFlush('workbench');
    if (config.autoStartCapture) {
      try {
        await audioRef.current.start({
          audioSource: config.audioSource,
          micEnabled: false,
          micDeviceId: settingsRef.current?.audio?.micDeviceId || '',
          themDeviceId: settingsRef.current?.audio?.themDeviceId || ''
        });
        setCapturing(true);
      } catch (e) {
        setAsr(prev => ({ ...prev, lastError: e.message }));
      }
    }
  }, [handleUpdateWorkbenchPrefs, navigateWithFlush]);

  const handleEndActiveSession = useCallback(async () => {
    await audioRef.current.stop();
    setCapturing(false);
    await window.mc.disableSecurity({ scope: 'session' }).then(setWindowState).catch(() => {});
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    navigateWithFlush('home');
  }, [navigateWithFlush]);

  const handleResumeFromRecord = useCallback((sid) => {
    setActiveSessionId(sid);
    activeSessionIdRef.current = sid;
    navigateWithFlush('workbench');
  }, [navigateWithFlush]);

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
        onCancel={(reqId) => {
          window.mc.llmCancel(reqId);
          if (curSess) patchSessionById(curSess.id, s => cancelAttempt(s, reqId));
        }}
        onRestore={() => void handleExitWrittenCompact()}
        batch={batch}
        batchController={batchController}
      />
    );
  }

  // Phase 3 will mount the full dual-pane WorkbenchView here; until then, keep a clean navigable bridge.
  if (route === 'workbench' && activeSession) {
    return (
      <div className="mc-wb-shell">
        <header className="mc-wb-topbar">
          <div className="mc-wb-topbar-left">
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => navigateWithFlush('home')}>
              ← 返回首页（保持后台运行）
            </button>
            <span className="mc-wb-title">{activeSession.name}</span>
          </div>
          <div className="mc-wb-tools">
            <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" onClick={() => void handleEndActiveSession()}>
              结束会话
            </button>
          </div>
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          实时面试工作台（Phase 3 实装中）
        </div>
      </div>
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
        onOpenDiagnostics={() => setModal('diagnostics')}
        onOpenHelp={() => setModal('help')}
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
            onEndActiveSession={() => void handleEndActiveSession()}
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
            onResumeFromRecord={handleResumeFromRecord}
            onRenameSession={(id, name) => patchSessionById(id, s => ({ ...s, name }))}
            onDeleteSession={(id) => setSessions(list => list.filter(s => s.id !== id))}
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
            onNavigate={(next) => navigateWithFlush(next)}
            onOpenHealth={() => setModal('health')}
            onOpenDiagnostics={() => setModal('diagnostics')}
            onOpenHelp={() => setModal('help')}
            onEnterWrittenCompact={() => void handleEnterWrittenCompact()}
            closeRef={settingsCloseRef}
            batch={batch}
            batchController={batchController}
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
