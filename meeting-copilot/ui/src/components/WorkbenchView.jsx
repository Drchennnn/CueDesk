import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computePrimaryButtonState,
  countNewerQuestions,
  getActiveAttempt,
  getSelectedQuestion
} from '../core/sessionModel.js';
import {
  formatCodingSummary,
  normalizeCodingPrefs
} from '../core/codingPrefs.js';
import { isInteractiveTarget, startClickThroughPolling } from '../core/clickThroughHitTest.js';
import { resolveAsrCapabilities } from '../core/turnPolicy.js';
import { AnchoredPopover } from './AnchoredPopover.jsx';
import { CodingPrefsPopover } from './CodingPrefsPopover.jsx';
import { CustomSelect } from './CustomSelect.jsx';
import { GearPopover, WorkbenchShortcutsModal } from './GearPopover.jsx';
import { ThirdPane } from './ThirdPane.jsx';
import { VirtualCursor } from './VirtualCursor.jsx';
import {
  IconArrowLeft,
  IconArrowUp,
  IconAt,
  IconBookOpen,
  IconCheck,
  IconChevronDown,
  IconCode,
  IconCopy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconGrid4,
  IconMaximize,
  IconMic,
  IconMicOff,
  IconMinus,
  IconMousePointer,
  IconPanelLeft,
  IconPanelRight,
  IconPin,
  IconRefresh,
  IconRestore,
  IconScan,
  IconSettings,
  IconSignal,
  IconSpeaker,
  IconSpeakerOff,
  IconSquare,
  IconTrash,
  IconX,
  IconZap
} from './Icons.jsx';
import {
  EyeContactToggle,
  ModelAnswers,
  Switch,
  cleanAnswerReferences,
  computeServiceHealth,
  parseAnswerBlocks
} from './SharedWidgets.jsx';

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ExitConfirmModal({ saving, error, onSaveExit, onDiscardExit, onCancel }) {
  return (
    <div className="mc-modal-backdrop" onClick={onCancel} data-interactive="true">
      <div className="mc-modal mc-modal-sm mc-modal-anim" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="结束本次面试会话">
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">保存到最近记录？</h3>
          <button type="button" className="mc-icon-btn" onClick={onCancel} disabled={saving}><IconX size={14} /></button>
        </div>
        <div className="mc-modal-body">
          <div className="mc-field-hint">
            保存后可在主界面「面试记录」中查看完整问答、引用证据与转写，也可随时导出。
          </div>
          {error && (
            <div className="mc-alert mc-alert-err" role="alert">
              保存失败：{error}。当前会话仍保留在窗口中，你可以重试保存或继续阅读。
            </div>
          )}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn mc-btn-sm" disabled={saving} onClick={onCancel}>取消</button>
          <button type="button" className="mc-btn mc-btn-sm mc-btn-danger" disabled={saving} onClick={onDiscardExit}>不保存结束</button>
          <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" disabled={saving} onClick={onSaveExit}>
            {saving ? '正在保存…' : error ? '重试保存并结束' : '保存并结束'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkbenchView({
  session,
  settings,
  library,
  asr,
  hud,
  capturing,
  secondaryMicActive,
  recordingState,
  partials,
  manualDraft,
  workbenchPrefs,
  windowState,
  hoverInside,
  onBackHome,
  onToggleCapture,
  onToggleRecording,
  onSwitchAudioSource,
  onToggleSecondaryMic,
  onCaptureScreen,
  onEnterWrittenCompact,
  onAskText,
  onRegenerateQuestion,
  onCancelAttempt,
  onSelectQuestion,
  onSelectAttempt,
  onJumpLatest,
  onMergeQuestions,
  onClearSessionContent,
  onCommitManualDraft,
  onClearManualDraft,
  onChangeSessionMeta,
  onTranslateSegment,
  onTranslateAnswer,
  onClearTranscript,
  onUpdatePrefs,
  onSetAlwaysOnTop,
  onSetPreventFocus,
  onSetAllowCapture,
  onSetClickThrough,
  onSaveProgressSync,
  onEndSessionSave,
  onEndSessionDiscard,
  onSettingsUpdated,
  onNavigateCapability,
  onOpenSettings,
  onOpenKnowledgeSettings
}) {
  const [draftText, setDraftText] = useState('');
  const [leftTab, setLeftTab] = useState('questions'); // 'questions' | 'transcript'
  const [elapsedSec, setElapsedSec] = useState(0);
  const [gearOpen, setGearOpen] = useState(false);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [exitSaving, setExitSaving] = useState(false);
  const [exitError, setExitError] = useState('');
  const [saveToast, setSaveToast] = useState(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [codingPopoverOpen, setCodingPopoverOpen] = useState(false);
  const [shotMenuOpen, setShotMenuOpen] = useState(false);
  const [audioPillOpen, setAudioPillOpen] = useState(false);
  const [kbMenuOpen, setKbMenuOpen] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const [dragQuestionId, setDragQuestionId] = useState(null);
  const [dropQuestionId, setDropQuestionId] = useState(null);

  // Split layout state
  const [leftRatio, setLeftRatio] = useState(workbenchPrefs?.leftPaneRatio ?? 0.5);
  const [sideWidth, setSideWidth] = useState(workbenchPrefs?.sidePaneWidth ?? 320);
  const [draggingDivider, setDraggingDivider] = useState(null); // 'main' | 'side' | null
  const [leftPaneWidth, setLeftPaneWidth] = useState(360);

  // Trigger refs for dynamically anchored popovers (ZERO hardcoded coordinates!)
  const gearBtnRef = useRef(null);
  const audioBtnRef = useRef(null);
  const shotBtnRef = useRef(null);
  const kbBtnRef = useRef(null);
  const modeBtnRef = useRef(null);
  const codingBtnRef = useRef(null);
  const modelBtnRef = useRef(null);

  const contentRef = useRef(null);
  const leftPaneRef = useRef(null);
  const answerScrollRef = useRef(null);
  const scrollMemoryRef = useRef(new Map());
  const prevQuestionIdRef = useRef(null);
  const audioPillTimerRef = useRef(null);
  const mouseInteractiveRef = useRef(false);
  const windowDraggingRef = useRef(false);

  const selectedQuestion = getSelectedQuestion(session);
  const activeAttempt = getActiveAttempt(selectedQuestion);
  const newerCount = countNewerQuestions(session);
  const primaryBtn = computePrimaryButtonState(draftText, selectedQuestion);
  const health = computeServiceHealth(settings, asr, library);
  const asrCaps = resolveAsrCapabilities(asr);
  const codingPrefs = normalizeCodingPrefs(workbenchPrefs?.codingPrefs);

  const leftCollapsed = Boolean(workbenchPrefs?.leftPaneCollapsed);
  const sideOpen = Boolean(workbenchPrefs?.sidePaneOpen);
  const sideTab = workbenchPrefs?.sidePaneTab || 'evidence';
  const sideTabs = workbenchPrefs?.sidePaneTabs?.length ? workbenchPrefs.sidePaneTabs : [sideTab];
  const hoverReveal = Boolean(workbenchPrefs?.hoverReveal);
  const autoCollapseChrome = Boolean(workbenchPrefs?.autoCollapseChrome);
  const dialogueThinking = Boolean(workbenchPrefs?.dialogueThinking);
  const translationTargetLang = workbenchPrefs?.translationTargetLang || 'zh-CN';
  const preventFocus = Boolean(windowState?.preventFocus);
  const clickThrough = Boolean(windowState?.clickThrough);
  const alwaysOnTop = windowState?.alwaysOnTop !== false;
  const virtualCursorActive = Boolean(windowState?.securityMode?.enabled && windowState?.securityMode?.hideCursor !== false);
  const clickThroughKeyLabel = (windowState?.workbenchHotkeys?.toggleClickThrough || windowState?.hotkeys?.toggleClickThrough || 'Control+Shift+9')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ');

  // Sync ratio/sideWidth from prefs when not dragging
  useEffect(() => {
    if (!draggingDivider && typeof workbenchPrefs?.leftPaneRatio === 'number') {
      setLeftRatio(workbenchPrefs.leftPaneRatio);
    }
  }, [workbenchPrefs?.leftPaneRatio, draggingDivider]);
  useEffect(() => {
    if (!draggingDivider && typeof workbenchPrefs?.sidePaneWidth === 'number') {
      setSideWidth(workbenchPrefs.sidePaneWidth);
    }
  }, [workbenchPrefs?.sidePaneWidth, draggingDivider]);

  // Session timer
  useEffect(() => {
    const start = session?.createdAt || Date.now();
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.id, session?.createdAt]);

  // ResizeObserver on left question pane (SuiSi >=230 / 150-229 / <150 responsive tiers)
  useEffect(() => {
    const el = leftPaneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setLeftPaneWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [leftCollapsed]);

  // Per-question reading scroll memory
  useEffect(() => {
    const el = answerScrollRef.current;
    const prevId = prevQuestionIdRef.current;
    const nextId = selectedQuestion?.id || null;
    if (el && prevId && prevId !== nextId) {
      scrollMemoryRef.current.set(prevId, el.scrollTop);
    }
    if (el && nextId && prevId !== nextId) {
      el.scrollTop = scrollMemoryRef.current.get(nextId) ?? 0;
    }
    prevQuestionIdRef.current = nextId;
  }, [selectedQuestion?.id]);

  // Smart Local Click-Through: SuiSi 80ms main-process cursor poller + mousemove fast-path
  useEffect(() => {
    if (!clickThrough) {
      if (mouseInteractiveRef.current) {
        mouseInteractiveRef.current = false;
        window.mc?.setMouseInteractive?.(false);
      }
      return;
    }
    const pushInteractive = (next) => {
      const val = Boolean(next);
      if (val !== mouseInteractiveRef.current) {
        mouseInteractiveRef.current = val;
        window.mc?.setMouseInteractive?.(val);
      }
    };
    const stopPolling = startClickThroughPolling(
      window.mc?.getCursorInContent,
      pushInteractive,
      80
    );
    const onMove = (e) => {
      const target = e.target instanceof Element ? e.target : document.elementFromPoint(e.clientX, e.clientY);
      pushInteractive(isInteractiveTarget(target, e.clientX, e.clientY));
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      stopPolling();
      window.removeEventListener('mousemove', onMove);
      if (mouseInteractiveRef.current) {
        mouseInteractiveRef.current = false;
        window.mc?.setMouseInteractive?.(false);
      }
    };
  }, [clickThrough]);

  // Clean up JS drag if component unmounts mid-drag
  useEffect(() => () => {
    if (windowDraggingRef.current) {
      windowDraggingRef.current = false;
      window.mc?.dragEnd?.();
    }
  }, []);

  // Hover-reveal & auto-collapse blocking whenever popovers/modals/input/drag are active
  const isAnimationSuppressed = Boolean(
    gearOpen || shortcutModalOpen || exitModalOpen || codingPopoverOpen ||
    modePopoverOpen || shotMenuOpen || audioPillOpen || kbMenuOpen || modelPopoverOpen ||
    inputFocused || draggingDivider || windowState?.tempFocus || exitError
  );
  useEffect(() => {
    void window.mc?.setHoverBlocked?.(isAnimationSuppressed)?.catch?.(() => {});
  }, [isAnimationSuppressed]);
  useEffect(() => () => {
    void window.mc?.setHoverBlocked?.(false)?.catch?.(() => {});
  }, []);

  const effectiveLibEnabled = typeof session?.libraryEnabled === 'boolean' ? session.libraryEnabled : Boolean(library?.enabled);

  // Workbench hotkey action listener (navigation, scroll, audio, manual send, KB, quick close)
  const hotkeyCtxRef = useRef({});
  hotkeyCtxRef.current = {
    session,
    selectedQuestion,
    effectiveLibEnabled,
    onSelectQuestion,
    onToggleCapture,
    onCommitManualDraft,
    onClearTranscript,
    onChangeSessionMeta,
    onEndSessionDiscard
  };
  useEffect(() => {
    const off = window.mc?.onWorkbenchHotkeyAction?.(({ action }) => {
      const ctx = hotkeyCtxRef.current;
      const qs = ctx.session?.questions || [];
      if (action === 'questionPrev' && qs.length > 0) {
        const idx = qs.findIndex(q => q.id === ctx.selectedQuestion?.id);
        const nextIdx = idx <= 0 ? 0 : idx - 1;
        ctx.onSelectQuestion(qs[nextIdx].id);
      } else if (action === 'questionNext' && qs.length > 0) {
        const idx = qs.findIndex(q => q.id === ctx.selectedQuestion?.id);
        const nextIdx = idx < 0 ? 0 : Math.min(qs.length - 1, idx + 1);
        ctx.onSelectQuestion(qs[nextIdx].id);
      } else if (action === 'scrollUp') {
        answerScrollRef.current?.scrollBy({ top: -180, behavior: 'smooth' });
      } else if (action === 'scrollDown') {
        answerScrollRef.current?.scrollBy({ top: 180, behavior: 'smooth' });
      } else if (action === 'toggleAudioCapture') {
        ctx.onToggleCapture();
      } else if (action === 'manualSend') {
        ctx.onCommitManualDraft();
      } else if (action === 'clearTranscript') {
        ctx.onClearTranscript();
      } else if (action === 'toggleKnowledge') {
        ctx.onChangeSessionMeta({ libraryEnabled: !ctx.effectiveLibEnabled });
      } else if (action === 'closeWithoutSave') {
        void ctx.onEndSessionDiscard();
      }
    });
    return () => off?.();
  }, []);

  const closeOtherPopovers = useCallback((except) => {
    if (except !== 'gear') setGearOpen(false);
    if (except !== 'coding') setCodingPopoverOpen(false);
    if (except !== 'mode') setModePopoverOpen(false);
    if (except !== 'shot') setShotMenuOpen(false);
    if (except !== 'audio') setAudioPillOpen(false);
    if (except !== 'kb') setKbMenuOpen(false);
    if (except !== 'model') setModelPopoverOpen(false);
  }, []);

  // SuiSi JS window dragging on topbar (zero `-webkit-app-region: drag`, pointer-captured + main-process DIP coords)
  const handleTopbarPointerDown = (e) => {
    if (e.button !== 0 || clickThrough) return;
    if (e.target.closest?.('button, input, select, textarea, a, [role="button"], [role="switch"]')) return;
    e.preventDefault();
    const headerEl = e.currentTarget;
    const pid = e.pointerId;
    try { headerEl.setPointerCapture?.(pid); } catch {}
    windowDraggingRef.current = true;
    window.mc?.dragStart?.();
    const onMove = () => {
      if (windowDraggingRef.current) window.mc?.dragMove?.();
    };
    const onUp = () => {
      if (!windowDraggingRef.current) return;
      windowDraggingRef.current = false;
      try { headerEl.releasePointerCapture?.(pid); } catch {}
      window.mc?.dragEnd?.();
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onUp);
  };

  // Layered opacity CSS custom properties
  const effectiveHoverInside = hoverInside || isAnimationSuppressed;
  const shouldHoverFade = hoverReveal && !effectiveHoverInside;
  const shouldCollapseChrome = autoCollapseChrome && !effectiveHoverInside;

  const b = (workbenchPrefs?.bgOpacity ?? 82) / 100;
  // SuiSi background synthesis: 1 - (1 - b)^2 keeps translucent surface legible
  const bgAlpha = Math.max(0, Math.min(1, 1 - (1 - b) * (1 - b)));
  const chromeOpacity = (workbenchPrefs?.iconTextOpacity ?? 100) / 100;
  const answerOpacity = (workbenchPrefs?.answerTextOpacity ?? 100) / 100;
  const hoverFade = shouldHoverFade ? (workbenchPrefs?.hoverOpacity ?? 8) / 100 : 1;
  const answerFontSize = workbenchPrefs?.fontSize ?? 14;

  const shellStyle = {
    '--wb-bg-alpha': bgAlpha.toFixed(4),
    '--wb-chrome-opacity': String(chromeOpacity),
    '--wb-answer-opacity': String(answerOpacity),
    '--wb-hover-fade': String(hoverFade),
    '--wb-answer-font-size': `${answerFontSize}px`
  };

  // Compute CSS grid template for 1/2/3 panes
  const gridTemplateColumns = useMemo(() => {
    if (leftCollapsed && !sideOpen) return 'minmax(0, 1fr)';
    if (leftCollapsed && sideOpen) return `minmax(240px, 1fr) 6px ${sideWidth}px`;
    if (!leftCollapsed && !sideOpen) return `minmax(0, ${leftRatio}fr) 6px minmax(0, ${1 - leftRatio}fr)`;
    return `minmax(0, ${leftRatio}fr) 6px minmax(0, ${1 - leftRatio}fr) 6px ${sideWidth}px`;
  }, [leftCollapsed, sideOpen, leftRatio, sideWidth]);

  // Draggable dividers
  const startMainDividerDrag = (e) => {
    e.preventDefault();
    setDraggingDivider('main');
    const container = contentRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const reservedRight = sideOpen ? sideWidth + 6 : 0;
    const usable = Math.max(200, rect.width - reservedRight - 6);

    let latest = leftRatio;
    const onMove = (ev) => {
      const next = Math.max(0.28, Math.min(0.72, (ev.clientX - rect.left) / usable));
      latest = next;
      setLeftRatio(next);
    };
    const onUp = () => {
      setDraggingDivider(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      void onUpdatePrefs({ leftPaneRatio: Number(latest.toFixed(4)) });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startSideDividerDrag = (e) => {
    e.preventDefault();
    setDraggingDivider('side');
    const container = contentRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const minMain = leftCollapsed ? 240 : 400;

    let latest = sideWidth;
    const onMove = (ev) => {
      const maxAllowed = Math.max(120, Math.min(560, rect.width - minMain - 6));
      const minAllowed = Math.min(180, maxAllowed);
      const next = Math.max(minAllowed, Math.min(maxAllowed, Math.round(rect.right - ev.clientX)));
      latest = next;
      setSideWidth(next);
    };
    const onUp = () => {
      setDraggingDivider(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      void onUpdatePrefs({ sidePaneWidth: latest });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Multi-tab Third Pane helpers
  const openThirdPaneTab = useCallback((targetTab, replaceLauncher = false) => {
    let nextTabs = [...sideTabs];
    if (replaceLauncher) {
      nextTabs = nextTabs.filter(t => t !== 'launcher');
    }
    if (!nextTabs.includes(targetTab)) nextTabs.push(targetTab);
    void onUpdatePrefs({ sidePaneOpen: true, sidePaneTab: targetTab, sidePaneTabs: nextTabs });
  }, [sideTabs, onUpdatePrefs]);

  const closeThirdPaneTab = useCallback((targetTab) => {
    const nextTabs = sideTabs.filter(t => t !== targetTab);
    if (!nextTabs.length) {
      void onUpdatePrefs({ sidePaneOpen: false });
      return;
    }
    const nextActive = sideTab === targetTab ? nextTabs[nextTabs.length - 1] : sideTab;
    void onUpdatePrefs({ sidePaneTab: nextActive, sidePaneTabs: nextTabs });
  }, [sideTabs, sideTab, onUpdatePrefs]);

  const handlePrimaryAction = () => {
    if (primaryBtn.action === 'send') {
      const q = draftText.trim();
      if (!q) return;
      onAskText(q, []);
      setDraftText('');
      if (preventFocus) void window.mc.requestTempFocus(false);
    } else if (primaryBtn.action === 'stop' && activeAttempt) {
      onCancelAttempt(activeAttempt.requestId);
    } else if (primaryBtn.action === 'regenerate' && selectedQuestion) {
      onRegenerateQuestion(selectedQuestion.id);
    }
  };

  const handleManualSave = async () => {
    const res = await onSaveProgressSync();
    if (res?.ok) {
      setSaveToast({ ok: true, text: '已保存进度' });
    } else {
      setSaveToast({ ok: false, text: res?.error || '保存失败' });
    }
    setTimeout(() => setSaveToast(null), 2600);
  };

  const handleCloseClick = async () => {
    const hasContent = (session?.questions?.length || 0) > 0 || (session?.segments?.length || 0) > 0;
    if (!hasContent) {
      await onEndSessionDiscard();
      return;
    }
    if (workbenchPrefs?.autoSaveOnClose) {
      setExitSaving(true);
      setExitError('');
      const res = await onEndSessionSave();
      setExitSaving(false);
      if (!res?.ok) {
        setExitError(res?.error || '磁盘写入失败');
        setExitModalOpen(true);
      }
      return;
    }
    setExitError('');
    setExitModalOpen(true);
  };

  const handleConfirmSaveExit = async () => {
    setExitSaving(true);
    setExitError('');
    const res = await onEndSessionSave();
    setExitSaving(false);
    if (!res?.ok) {
      setExitError(res?.error || '磁盘写入失败');
    } else {
      setExitModalOpen(false);
    }
  };

  const copyCurrentAnswer = async (text) => {
    try {
      await navigator.clipboard.writeText(cleanAnswerReferences(text));
      setCopiedAnswer(true);
      setTimeout(() => setCopiedAnswer(false), 1200);
    } catch {}
  };

  const leftTierClass = leftPaneWidth < 150 ? 'is-narrow' : leftPaneWidth < 230 ? 'is-compact' : '';
  const modeMeta = session.transcriptionMode === 'manual'
    ? { label: '手动', color: 'var(--success)', desc: '累计对方发言后手动发送' }
    : session.transcriptionMode === 'transcript-only'
      ? { label: '转写', color: 'var(--warning)', desc: '仅记录转写，不自动调用大模型' }
      : { label: '自动', color: 'var(--text-muted)', desc: '自动识别完整提问并生成回答' };

  const renderAnswerBody = (question, attempt) => {
    if (!attempt) return <div className="mc-field-hint">正在等待回答…</div>;
    if (attempt.modelResults?.length > 0) {
      return <ModelAnswers results={attempt.modelResults} onlyOptions={session.scene === 'written'} />;
    }
    if (attempt.status === 'error') {
      const errText = attempt.error || '生成失败';
      const isVisionErr = question.kind === 'shot' || question.kind === 'batch' || /视觉|截图|vision|multimodal/i.test(errText);
      const isAsrErr = /语音|asr|转写/i.test(errText);
      const fixCapability = isVisionErr ? 'vision' : isAsrErr ? 'asr' : 'text-llm';
      const fixLabel = isVisionErr ? '配置截图模型 →' : isAsrErr ? '配置语音识别 →' : '配置文本模型 →';
      const openFix = () => {
        if (onNavigateCapability) onNavigateCapability(fixCapability);
        else onOpenSettings?.();
      };
      return (
        <div className="mc-alert mc-alert-err" style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-interactive="true">
          <div>{errText}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={openFix}>
              {fixLabel}
            </button>
            <button type="button" className="mc-btn mc-btn-sm" onClick={() => onRegenerateQuestion(question.id)}>
              <IconRefresh size={12} /> 重答本题
            </button>
          </div>
        </div>
      );
    }
    const blocks = parseAnswerBlocks(attempt.text || '', false);
    if (!blocks.length) {
      return (
        <div className="mc-field-hint">
          {attempt.status === 'streaming'
            ? (attempt.statusText || '正在生成回答…')
            : attempt.unknownFacts?.length
              ? '个人经历暂未确认，请查看下方待确认提示。'
              : '（暂无回答内容）'}
        </div>
      );
    }
    return (
      <>
        {blocks.map((block, idx) =>
          block.kind === 'code' ? (
            <pre key={idx} className="mc-answer-code"><code>{block.text}</code></pre>
          ) : (
            <div key={idx} className="mc-answer-prose">{block.text}</div>
          )
        )}
        {attempt.status === 'streaming' && (
          <span style={{ display: 'inline-block', width: 7, height: 14, background: 'var(--primary)', marginLeft: 2, verticalAlign: 'text-bottom' }} />
        )}
      </>
    );
  };

  return (
    <>
      <div
        className={`mc-wb-shell${effectiveHoverInside ? ' is-hover-in' : ''}${shouldCollapseChrome ? ' is-chrome-collapsed' : ''}${windowState?.maximized ? ' is-maximized' : ''}`}
        style={shellStyle}
      >
        {/* 44px TOP CHROME (JS pointer drag, zero -webkit-app-region: drag) */}
        <header
          className="mc-wb-topbar"
          data-interactive="true"
          onPointerDown={handleTopbarPointerDown}
        >
          <div className="mc-wb-topbar-left">
            <button type="button" className="mc-icon-btn" title="返回首页（保持当前面试与采集运行）" aria-label="返回首页" onClick={onBackHome}>
              <IconArrowLeft size={15} />
            </button>
            <button
              type="button"
              className={`mc-icon-btn${leftCollapsed ? ' is-active' : ''}`}
              title={leftCollapsed ? '展开左侧问题栏' : '收起左侧问题栏（切换单栏问答流）'}
              aria-label="切换问题栏"
              onClick={() => void onUpdatePrefs({ leftPaneCollapsed: !leftCollapsed })}
            >
              <IconPanelLeft size={15} />
            </button>
            <span className="mc-wb-title" title={session?.name}>{session?.name || '实时面试'}</span>
          </div>

          <div className="mc-wb-tools">
            <div className="mc-wb-tools-scroll">
              {/* Audio capture button + hover source popover (no native title tooltip overlap — fixes M18) */}
              <div
                style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                onMouseEnter={() => { clearTimeout(audioPillTimerRef.current); setAudioPillOpen(true); }}
                onMouseLeave={() => { audioPillTimerRef.current = setTimeout(() => setAudioPillOpen(false), 180); }}
              >
                <button
                  ref={audioBtnRef}
                  type="button"
                  className={`mc-icon-btn${capturing ? ' is-live' : ''}`}
                  aria-label={capturing
                    ? `正在采集（${session.audioSource === 'mic' ? '麦克风' : '系统音频'}），点击暂停`
                    : `已暂停采集（${session.audioSource === 'mic' ? '麦克风' : '系统音频'}），点击开始`}
                  onClick={onToggleCapture}
                >
                  {session.audioSource === 'mic'
                    ? (capturing ? <IconMic size={15} /> : <IconMicOff size={15} />)
                    : (capturing ? <IconSpeaker size={15} /> : <IconSpeakerOff size={15} />)}
                </button>
              </div>

              {/* SuiSi-style compact manual dual-track WAV recording control */}
              <button
                type="button"
                className={`mc-rec-pill${recordingState?.active ? ' is-recording' : ''}`}
                title={recordingState?.active
                  ? `正在录制整场 WAV（对方+本人双轨）· 点击停止并保存`
                  : '手动开启整场双轨 WAV 录音（仅存本机，不写入知识库）'}
                aria-label={recordingState?.active ? '停止整场录音' : '开始整场录音'}
                aria-pressed={Boolean(recordingState?.active)}
                onClick={onToggleRecording}
              >
                <span className="mc-rec-dot" />
                <span className="mc-rec-label">
                  {recordingState?.active ? formatTimer(recordingState.durationSec || 0) : '录制'}
                </span>
              </button>

              {/* Screenshot capture + quick mode menu */}
              <button
                ref={shotBtnRef}
                type="button"
                className={`mc-icon-btn${shotMenuOpen ? ' is-active' : ''}`}
                title="截取屏幕识题（右键展开框选/笔试小窗）"
                aria-label="截取屏幕识题"
                onClick={() => onCaptureScreen('full')}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShotMenuOpen(v => !v); }}
              >
                <IconScan size={15} />
              </button>

              {/* Hover Reveal (Eye icon) */}
              <button
                type="button"
                className={`mc-icon-btn${hoverReveal ? ' is-active' : ''}`}
                title={hoverReveal ? `悬停显隐已开启（移出渐隐至 ${workbenchPrefs?.hoverOpacity ?? 8}% 并自动穿透）` : '开启悬停显隐（鼠标移出窗口时淡化隐身）'}
                aria-label="悬停显隐"
                aria-pressed={hoverReveal}
                onClick={() => void onUpdatePrefs({ hoverReveal: !hoverReveal })}
              >
                {hoverReveal ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>

              {/* Eye Contact Toggle (distinct viewfinder-eye icon) */}
              <EyeContactToggle compact />

              {/* Pin Always-On-Top */}
              <button
                type="button"
                className={`mc-icon-btn${alwaysOnTop ? ' is-active' : ''}`}
                title={alwaysOnTop ? '已置顶（点击取消置顶）' : '窗口置顶'}
                aria-label="窗口置顶"
                aria-pressed={alwaysOnTop}
                onClick={() => void onSetAlwaysOnTop(!alwaysOnTop)}
              >
                <IconPin size={14} filled={alwaysOnTop} />
              </button>

              {/* Save Progress */}
              <button
                type="button"
                className="mc-icon-btn"
                title={saveToast ? saveToast.text : '立即保存当前面试记录'}
                aria-label="保存当前记录"
                style={saveToast ? { color: saveToast.ok ? 'var(--success)' : 'var(--danger)' } : undefined}
                onClick={() => void handleManualSave()}
              >
                {saveToast?.ok ? <IconCheck size={15} /> : <IconDownload size={15} />}
              </button>

              {/* Gear Settings Popover Trigger */}
              <button
                ref={gearBtnRef}
                type="button"
                className={`mc-icon-btn${gearOpen ? ' is-active' : ''}`}
                title="会中窗口与透明度设置"
                aria-label="会中设置"
                aria-expanded={gearOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setGearOpen(v => {
                    const next = !v;
                    if (next) closeOtherPopovers('gear');
                    return next;
                  });
                }}
              >
                <IconSettings size={15} />
              </button>

              {/* Third Pane Toggle */}
              <button
                type="button"
                className={`mc-icon-btn${sideOpen ? ' is-active' : ''}`}
                title={sideOpen ? '收起右侧辅助栏（知识库/翻译/依据/转写）' : '展开右侧辅助栏（知识库/翻译/依据/转写）'}
                aria-label="切换辅助栏"
                onClick={() => void onUpdatePrefs({ sidePaneOpen: !sideOpen })}
              >
                <IconPanelRight size={15} />
              </button>
            </div>

            {/* System window controls */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, paddingLeft: 4, borderLeft: '1px solid var(--border)' }}>
              <button type="button" className="mc-icon-btn" title="最小化" onClick={() => void window.mc.minimizeWindow()}>
                <IconMinus size={14} />
              </button>
              <button type="button" className="mc-icon-btn" title={windowState?.maximized ? '还原' : '最大化'} onClick={() => void window.mc.toggleMaximizeWindow()}>
                {windowState?.maximized ? <IconRestore size={12} /> : <IconMaximize size={12} />}
              </button>
              <button type="button" className="mc-icon-btn is-danger" title="结束本次会话" aria-label="结束会话" onClick={() => void handleCloseClick()}>
                <IconX size={14} />
              </button>
            </div>
          </div>
        </header>

        {/* MAIN SPLIT CONTENT */}
        <div
          ref={contentRef}
          className={`mc-wb-content${!draggingDivider ? ' is-animating' : ''}`}
          style={{ gridTemplateColumns }}
        >
          {/* LEFT PANE: Questions + Sleek Single-Row Composer */}
          {!leftCollapsed && (
            <section ref={leftPaneRef} className={`mc-wb-pane ${leftTierClass}`} aria-label="问题列表栏">
              <div className="mc-wb-pane-header" data-interactive="true">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className={`mc-btn mc-btn-sm ${leftTab === 'questions' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 11.5 }}
                    onClick={() => setLeftTab('questions')}
                  >
                    问题 {session?.questions?.length || 0}
                  </button>
                  <button
                    type="button"
                    className={`mc-btn mc-btn-sm ${leftTab === 'transcript' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 11.5 }}
                    onClick={() => setLeftTab('transcript')}
                  >
                    转写 {session?.segments?.length || 0}
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                  <span className={`mc-dot ${capturing ? 'mc-dot-ok' : asr.phase === 'error' ? 'mc-dot-err' : 'mc-dot-idle'}`} />
                  {hud?.lastE2eMs !== undefined && <span>{(hud.lastE2eMs / 1000).toFixed(1)}s</span>}
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTimer(elapsedSec)}</span>
                </div>
              </div>

              {leftTab === 'questions' ? (
                <div className="mc-wb-qlist" data-scrollable="true">
                  {(session?.questions || []).length === 0 ? (
                    <div className="mc-field-hint" style={{ textAlign: 'center', marginTop: 28, padding: '0 12px' }}>
                      {capturing
                        ? '正在监听语音… 识别到面试官提问将自动建题；也可以直接输入或截图提问。'
                        : '点击顶栏音频按钮开始采集，或在下方直接输入问题。'}
                    </div>
                  ) : (
                    session.questions.map((q) => {
                      const att = getActiveAttempt(q);
                      const isSel = selectedQuestion?.id === q.id;
                      const isDrop = dropQuestionId === q.id && dragQuestionId && dragQuestionId !== q.id;
                      return (
                        <div
                          key={q.id}
                          draggable
                          data-interactive="true"
                          className={`mc-qcard${isSel ? ' is-selected' : ''}${isDrop ? ' is-drop-target' : ''}`}
                          onClick={() => onSelectQuestion(q.id)}
                          onDoubleClick={() => onRegenerateQuestion(q.id)}
                          onDragStart={(e) => {
                            setDragQuestionId(q.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            if (dragQuestionId && dragQuestionId !== q.id) {
                              e.preventDefault();
                              setDropQuestionId(q.id);
                            }
                          }}
                          onDragLeave={() => { if (dropQuestionId === q.id) setDropQuestionId(null); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragQuestionId && dragQuestionId !== q.id) {
                              onMergeQuestions(dragQuestionId, q.id);
                            }
                            setDragQuestionId(null);
                            setDropQuestionId(null);
                          }}
                          onDragEnd={() => { setDragQuestionId(null); setDropQuestionId(null); }}
                          title="单击查看答案 · 双击重新生成 · 拖到另一题上可合并提问"
                        >
                          <div className="mc-qcard-head">
                            <span>
                              #{q.ordinal}
                              {q.mergedFromOrdinals?.length > 1 && ` (合并 ${q.mergedFromOrdinals.join('+')})`}
                              {q.kind === 'shot' || q.kind === 'batch' ? ' · 截图' : ''}
                            </span>
                            <span className="mc-qcard-extra" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              {q.attempts.length > 1 && <span>v{q.attempts.findIndex(a => a.id === q.activeAttemptId) + 1}/{q.attempts.length}</span>}
                              {att?.status === 'streaming' && <span style={{ color: 'var(--info)' }}>生成中…</span>}
                              {att?.status === 'cancelled' && <span style={{ color: 'var(--warning)' }}>已取消</span>}
                              {att?.status === 'error' && <span style={{ color: 'var(--danger)' }}>失败</span>}
                            </span>
                          </div>
                          <div className="mc-qcard-body">{q.prompt}</div>
                        </div>
                      );
                    })
                  )}

                  {partials?.them && (
                    <div style={{ padding: '6px 10px', borderRadius: 8, border: '1px dashed var(--border-strong)', fontSize: 12, color: 'var(--text-muted)' }}>
                      <strong style={{ fontSize: 11 }}>实时识别中…</strong>
                      <div>{partials.them}</div>
                    </div>
                  )}

                  {session.transcriptionMode === 'manual' && manualDraft?.text && (
                    <div className="mc-card" style={{ padding: 8, gap: 6, display: 'flex', flexDirection: 'column' }} data-interactive="true">
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--info)' }}>待发送累计转写</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{manualDraft.text}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={onCommitManualDraft}>发送提问</button>
                        <button type="button" className="mc-btn mc-btn-sm" onClick={onClearManualDraft}>清空累计</button>
                      </div>
                    </div>
                  )}

                  {newerCount > 0 && (
                    <button type="button" className="mc-jump-pill" data-interactive="true" onClick={onJumpLatest}>
                      ↓ {newerCount} 条新问题
                    </button>
                  )}
                </div>
              ) : (
                <div className="mc-wb-qlist" data-scrollable="true">
                  {(session?.segments || []).length === 0 ? (
                    <div className="mc-field-hint" style={{ textAlign: 'center', marginTop: 28 }}>暂无转写片段</div>
                  ) : (
                    session.segments.map(seg => (
                      <div key={seg.id} style={{ padding: '7px 9px', borderRadius: 8, background: seg.speaker === 'me' ? 'var(--info-bg)' : 'var(--bg-subtle)', fontSize: 12.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                          <strong>{seg.speaker === 'me' ? '我' : '对方'}</strong>
                          {seg.speaker !== 'me' && (
                            <button type="button" className="mc-btn mc-btn-sm" data-interactive="true" style={{ height: 19, padding: '0 5px', fontSize: 10.5 }} onClick={() => onAskText(seg.text, [seg.id])}>
                              ⚡答
                            </button>
                          )}
                        </div>
                        <div style={{ userSelect: 'text' }}>{seg.text}</div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* SLEEK SINGLE-ROW LEFT BOTTOM COMPOSER (SuiSi style) */}
              <div className="mc-wb-input-wrap" data-interactive="true">
                <div className="mc-composer-bar">
                  <textarea
                    className="mc-composer-input"
                    rows={1}
                    value={draftText}
                    placeholder={preventFocus || clickThrough ? '点击开始安全输入' : '输入问题…'}
                    onMouseDown={() => {
                      if (preventFocus || clickThrough) void window.mc.requestTempFocus(true);
                    }}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => {
                      setInputFocused(false);
                      if (preventFocus || clickThrough) void window.mc.requestTempFocus(false);
                    }}
                    onChange={e => setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && (preventFocus || clickThrough)) {
                        e.currentTarget.blur();
                        void window.mc.requestTempFocus(false);
                        return;
                      }
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handlePrimaryAction();
                      }
                    }}
                  />
                  <div className="mc-composer-actions">
                    <button
                      type="button"
                      className={`mc-composer-send${primaryBtn.action === 'stop' ? ' is-stop' : ''}`}
                      disabled={primaryBtn.disabled}
                      title={primaryBtn.label}
                      aria-label={primaryBtn.label}
                      onClick={handlePrimaryAction}
                    >
                      {primaryBtn.action === 'stop' ? <IconSquare size={10} /> :
                        primaryBtn.action === 'regenerate' ? <IconRefresh size={13} /> :
                          <IconArrowUp size={14} />}
                    </button>

                    <button
                      type="button"
                      className={`mc-icon-btn${clearArmed ? ' is-danger' : ''}`}
                      style={{ width: 24, height: 24, color: clearArmed ? 'var(--danger)' : undefined }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (clearArmed) { onClearSessionContent(); setClearArmed(false); }
                        else setClearArmed(true);
                      }}
                      onBlur={() => setClearArmed(false)}
                      title={clearArmed ? '再次点击确认清空本场全部问答与转写' : '清空本场会话（连点两次确认）'}
                      aria-label="清空会话"
                    >
                      <IconTrash size={13} />
                    </button>

                    <button
                      ref={modeBtnRef}
                      type="button"
                      className={`mc-btn mc-btn-sm mc-btn-ghost${modePopoverOpen ? ' is-active' : ''}`}
                      style={{ height: 24, padding: '0 6px', fontSize: 11, color: modeMeta.color, gap: 3 }}
                      title={`当前转写策略：${modeMeta.label}（${modeMeta.desc}）`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModePopoverOpen(v => {
                          const next = !v;
                          if (next) closeOtherPopovers('mode');
                          return next;
                        });
                      }}
                    >
                      <IconZap size={12} />
                      {leftPaneWidth >= 210 && <span>{modeMeta.label}</span>}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* MAIN SPLIT DIVIDER */}
          {!leftCollapsed && (
            <div
              className={`mc-wb-divider${draggingDivider === 'main' ? ' is-dragging' : ''}`}
              data-interactive="true"
              onMouseDown={startMainDividerDrag}
              title="拖动调整左右栏比例"
            />
          )}

          {/* RIGHT MAIN ANSWER PANE */}
          <section className="mc-wb-pane" style={{ position: 'relative' }} aria-label="回答阅读区">
            <div className="mc-wb-pane-header" data-interactive="true">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
                {/* @ Dialogue Thinking Toggle (SuiSi style) */}
                <button
                  type="button"
                  className={`mc-icon-btn${dialogueThinking ? ' is-active' : ''}`}
                  style={{ width: 26, height: 26 }}
                  title={dialogueThinking
                    ? '对话思考已开启：结合上下文更深入拆解权衡点与追问方向'
                    : '开启对话思考（@）：结合上下文深入分析与结构化作答'}
                  aria-label="对话思考"
                  aria-pressed={dialogueThinking}
                  onClick={() => void onUpdatePrefs({ dialogueThinking: !dialogueThinking })}
                >
                  <IconAt size={14} />
                </button>

                {session.audioSource === 'system' && (
                  <button
                    type="button"
                    className={`mc-btn mc-btn-sm ${secondaryMicActive ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                    style={{ height: 24, padding: '0 7px', fontSize: 11.5 }}
                    title="开启后将本人麦克风发言一并记入对话上下文"
                    onClick={onToggleSecondaryMic}
                  >
                    {secondaryMicActive ? <IconMic size={12} /> : <IconMicOff size={12} />} 对话上下文
                  </button>
                )}

                {/* Knowledge V2 Dropdown Menu Trigger (SuiSi 📁 ▾ style) */}
                <button
                  ref={kbBtnRef}
                  type="button"
                  className={`mc-btn mc-btn-sm ${effectiveLibEnabled ? 'is-kb-on' : 'mc-btn-ghost'}`}
                  style={{
                    height: 24,
                    padding: '0 7px',
                    fontSize: 11.5,
                    gap: 4,
                    color: effectiveLibEnabled ? 'var(--text)' : 'var(--text-muted)',
                    background: effectiveLibEnabled ? 'var(--bg-subtle)' : 'transparent',
                    borderColor: effectiveLibEnabled ? 'var(--border)' : 'transparent'
                  }}
                  title="管理本场面试的本地知识库 V2 检索与岗位目录"
                  aria-expanded={kbMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setKbMenuOpen(v => {
                      const next = !v;
                      if (next) closeOtherPopovers('kb');
                      return next;
                    });
                  }}
                >
                  <IconFolder size={12} />
                  <span>{effectiveLibEnabled ? (session.role || `资料库 (${library?.files?.length || 0})`) : '资料库关'}</span>
                  <IconChevronDown size={11} />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <button
                  type="button"
                  className="mc-btn mc-btn-sm mc-btn-ghost"
                  style={{ height: 24, padding: '0 7px', fontSize: 11.5 }}
                  title="切换本场回答语言"
                  onClick={() => onChangeSessionMeta({ answerLang: session.answerLang === 'english' ? 'chinese' : 'english' })}
                >
                  {session.answerLang === 'english' ? 'EN' : '中文'}
                </button>
              </div>
            </div>

            {/* CLICK-THROUGH UNLOCK FLOATING PILL (positioned cleanly inside answer pane top-right, zero overlap!) */}
            {clickThrough && (
              <div className="mc-floating-click-pill" data-interactive="true">
                <IconMousePointer size={12} style={{ color: 'var(--info)' }} />
                <span>鼠标穿透已开启</span>
                <span className="mc-kbd">{clickThroughKeyLabel}</span>
                <button
                  type="button"
                  className="mc-icon-btn"
                  style={{ width: 20, height: 20 }}
                  title="关闭鼠标穿透"
                  aria-label="关闭鼠标穿透"
                  onClick={() => void onSetClickThrough(false)}
                >
                  <IconX size={12} />
                </button>
              </div>
            )}

            <div className="mc-wb-answer-scroll" ref={answerScrollRef} data-scrollable="true">
              {leftCollapsed ? (
                (session?.questions || []).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {session.questions.map((q) => {
                      const att = getActiveAttempt(q);
                      return (
                        <article key={q.id} style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95em', marginBottom: 6, color: 'var(--text-secondary)' }}>
                            #{q.ordinal} {q.prompt}
                          </div>
                          {renderAnswerBody(q, att)}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mc-field-hint" style={{ marginTop: 28, textAlign: 'center' }}>暂无问答内容</div>
                )
              ) : selectedQuestion ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      #{selectedQuestion.ordinal} {selectedQuestion.prompt}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} data-interactive="true">
                      {selectedQuestion.attempts.length > 1 && (
                        <CustomSelect
                          className="mc-filter-select"
                          style={{ height: 22, fontSize: 11, minWidth: 74 }}
                          align="end"
                          value={selectedQuestion.activeAttemptId || ''}
                          onChange={val => onSelectAttempt(selectedQuestion.id, val)}
                          ariaLabel="切换回答版本"
                          options={selectedQuestion.attempts.map((a, i) => ({ value: a.id, label: `尝试 ${i + 1}` }))}
                        />
                      )}
                      {activeAttempt?.text && (
                        <button type="button" className="mc-btn mc-btn-sm" style={{ height: 22 }} onClick={() => void copyCurrentAnswer(activeAttempt.text)}>
                          {copiedAnswer ? <><IconCheck size={11} /> 已复制</> : <><IconCopy size={11} /> 复制</>}
                        </button>
                      )}
                    </div>
                  </div>

                  {renderAnswerBody(selectedQuestion, activeAttempt)}

                  {activeAttempt?.unknownFacts?.length > 0 && (
                    <div className="mc-alert mc-alert-warn" style={{ marginTop: 12, fontSize: 12 }}>
                      <strong>待本人补充确认：</strong>
                      {activeAttempt.unknownFacts.join('；')}
                    </div>
                  )}

                  {(activeAttempt?.evidence?.length > 0 || activeAttempt?.privateNotes?.length > 0) && (
                    <div style={{ marginTop: 10 }} data-interactive="true">
                      <button
                        type="button"
                        className="mc-btn mc-btn-sm"
                        onClick={() => openThirdPaneTab('evidence')}
                      >
                        引用 {(activeAttempt.evidenceRefs || activeAttempt.citations || []).length} / 检索 {activeAttempt.evidence?.length || 0} · 查看依据与原文 →
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} data-interactive="true">
                  <div className="mc-field-hint">
                    {health.llm.ready
                      ? '手动打字问答已就绪；在左下角输入问题按 Enter，或开启顶栏音频实时听写。'
                      : '回答模型尚未配置 API Key，配置后即可在此直接提问。'}
                  </div>
                  {!health.llm.ready && (
                    <button
                      type="button"
                      className="mc-btn mc-btn-sm mc-btn-primary"
                      onClick={() => (onNavigateCapability ? onNavigateCapability('text-llm') : onOpenSettings())}
                    >
                      配置回答模型 →
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT BOTTOM TOOLBAR (Subtle SuiSi ⊞ Coding Prefs + Model/Health Popover) */}
            <footer className="mc-wb-answer-foot" data-interactive="true">
              <button
                ref={codingBtnRef}
                type="button"
                className={`mc-btn mc-btn-sm ${codingPrefs.mode === 'coding' ? 'is-active-soft' : 'mc-btn-ghost'}`}
                style={{ height: 24, padding: '0 7px', fontSize: 11.5, gap: 5 }}
                title={`作答偏好 · ${formatCodingSummary(codingPrefs)}`}
                aria-expanded={codingPopoverOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setCodingPopoverOpen(v => {
                    const next = !v;
                    if (next) closeOtherPopovers('coding');
                    return next;
                  });
                }}
              >
                <IconGrid4 size={12} />
                <span>{formatCodingSummary(codingPrefs)}</span>
                <IconChevronDown size={11} style={{ opacity: 0.7 }} />
              </button>

              <button
                ref={modelBtnRef}
                type="button"
                className="mc-btn mc-btn-sm mc-btn-ghost"
                style={{ height: 24, padding: '0 7px', fontSize: 11.5, gap: 5 }}
                aria-expanded={modelPopoverOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setModelPopoverOpen(v => {
                    const next = !v;
                    if (next) closeOtherPopovers('model');
                    return next;
                  });
                }}
                title="查看当前模型与本地服务状态"
              >
                <span className={`mc-dot ${health.llm.ready ? 'mc-dot-ok' : 'mc-dot-warn'}`} />
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {settings?.llm?.model || '未配置文本模型'}
                </span>
                <IconSignal size={12} style={{ color: health.llm.ready ? 'var(--success)' : 'var(--text-faint)' }} />
                <IconChevronDown size={11} style={{ opacity: 0.7 }} />
              </button>
            </footer>
          </section>

          {/* THIRD PANE DIVIDER + MULTI-TAB THIRD PANE */}
          {sideOpen && (
            <>
              <div
                className={`mc-wb-divider${draggingDivider === 'side' ? ' is-dragging' : ''}`}
                data-interactive="true"
                onMouseDown={startSideDividerDrag}
                title="拖动调整辅助栏宽度"
              />
              <ThirdPane
                tab={sideTab}
                tabs={sideTabs}
                onSelectTab={(t) => void onUpdatePrefs({ sidePaneTab: t })}
                onOpenTab={openThirdPaneTab}
                onCloseTab={closeThirdPaneTab}
                onClose={() => void onUpdatePrefs({ sidePaneOpen: false })}
                session={session}
                library={library}
                selectedQuestion={selectedQuestion}
                partials={partials}
                answersReady={health.llm.ready}
                preventFocus={preventFocus}
                targetLang={translationTargetLang}
                onChangeTargetLang={(lang) => void onUpdatePrefs({ translationTargetLang: lang })}
                onAskText={onAskText}
                onTranslateSegment={onTranslateSegment}
                onTranslateAnswer={onTranslateAnswer}
                onClearTranscript={onClearTranscript}
                onOpenKnowledgeSettings={onOpenKnowledgeSettings}
              />
            </>
          )}
        </div>
      </div>

      {/* =================================================================
          DYNAMICALLY ANCHORED POPOVERS (all getBoundingClientRect + 150ms anim)
         ================================================================= */}

      {/* 1. Audio Source Popover (status header built in, zero tooltip overlap — fixes M18) */}
      <AnchoredPopover
        open={audioPillOpen}
        anchorRef={audioBtnRef}
        placement="bottom"
        align="center"
        offset={6}
        width={196}
        estimatedHeight={76}
        className="mc-audio-popover-box"
        ariaLabel="音频采集与音源切换"
        trapFocus={false}
        autoFocus={false}
        onMouseEnter={() => clearTimeout(audioPillTimerRef.current)}
        onMouseLeave={() => { audioPillTimerRef.current = setTimeout(() => setAudioPillOpen(false), 150); }}
      >
        <button
          type="button"
          className="mc-audio-popover-status"
          onClick={() => { onToggleCapture(); setAudioPillOpen(false); }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <i className={`mc-dot ${capturing ? 'mc-dot-ok' : 'mc-dot-idle'}`} />
            <span>{capturing ? '正在采集' : '已暂停采集'}</span>
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>{capturing ? '点击暂停' : '点击开始'}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className={`mc-btn mc-btn-sm ${session.audioSource === 'system' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
            style={{ height: 26, borderRadius: 99, flex: 1 }}
            onClick={() => { onSwitchAudioSource('system'); setAudioPillOpen(false); }}
          >
            <IconSpeaker size={12} /> 系统音频
          </button>
          <button
            type="button"
            className={`mc-btn mc-btn-sm ${session.audioSource === 'mic' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
            style={{ height: 26, borderRadius: 99, flex: 1 }}
            onClick={() => { onSwitchAudioSource('mic'); setAudioPillOpen(false); }}
          >
            <IconMic size={12} /> 麦克风
          </button>
        </div>
      </AnchoredPopover>

      {/* 2. Screenshot Quick Mode Dropdown */}
      <AnchoredPopover
        open={shotMenuOpen}
        anchorRef={shotBtnRef}
        placement="bottom"
        align="end"
        offset={6}
        width={164}
        estimatedHeight={120}
        className="mc-dropdown-menu"
        ariaLabel="截图模式菜单"
        onClose={() => setShotMenuOpen(false)}
      >
        <button type="button" className="mc-dropdown-item" onClick={() => { setShotMenuOpen(false); onCaptureScreen('full'); }}>全屏截图识题</button>
        <button type="button" className="mc-dropdown-item" onClick={() => { setShotMenuOpen(false); onCaptureScreen('region'); }}>框选区域识题</button>
        <div className="mc-dropdown-sep" />
        <button type="button" className="mc-dropdown-item" onClick={() => { setShotMenuOpen(false); onEnterWrittenCompact(); }}>切换到笔试小窗</button>
      </AnchoredPopover>

      {/* 3. Knowledge V2 Session Menu Popover */}
      <AnchoredPopover
        open={kbMenuOpen}
        anchorRef={kbBtnRef}
        placement="bottom"
        align="start"
        offset={6}
        width={252}
        estimatedHeight={220}
        className="mc-dropdown-menu"
        style={{ padding: 10, gap: 8 }}
        ariaLabel="本场知识库设置"
        onClose={() => setKbMenuOpen(false)}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>本地知识库 V2 检索</div>
            <div className="mc-field-hint" style={{ fontSize: 11 }}>仅影响本场，不改写全局配置</div>
          </div>
          <Switch
            checked={effectiveLibEnabled}
            aria-label="本场启用知识库"
            onChange={(v) => onChangeSessionMeta({ libraryEnabled: v })}
          />
        </div>
        {effectiveLibEnabled && (
          <div className="mc-field" style={{ gap: 4 }}>
            <label className="mc-field-label" style={{ fontSize: 11.5 }}>本场岗位目录</label>
            <CustomSelect
              className="mc-filter-select"
              style={{ height: 28, fontSize: 12, width: '100%' }}
              ariaLabel="本场岗位目录"
              value={session.role || ''}
              onChange={val => onChangeSessionMeta({ role: val })}
              options={[
                { value: '', label: '通用（默认岗位）' },
                ...(library?.roles || []).map(r => ({ value: r, label: r }))
              ]}
            />
          </div>
        )}
        <div className="mc-field-hint" style={{ fontSize: 11 }}>
          {library?.root
            ? `已索引 ${library.files?.length || 0} 份有效本地资料`
            : '尚未配置本地资料库目录'}
        </div>
        <div className="mc-dropdown-sep" style={{ margin: '2px 0' }} />
        <button
          type="button"
          className="mc-dropdown-item"
          style={{ padding: '6px 8px' }}
          onClick={() => {
            setKbMenuOpen(false);
            openThirdPaneTab('knowledge');
          }}
        >
          <IconBookOpen size={13} /> 在右侧栏浏览并阅读文档 →
        </button>
      </AnchoredPopover>

      {/* 4. Transcription Mode Popover */}
      <AnchoredPopover
        open={modePopoverOpen}
        anchorRef={modeBtnRef}
        placement="top"
        align="end"
        offset={8}
        width={224}
        estimatedHeight={190}
        className="mc-dropdown-menu"
        ariaLabel="转写提问策略"
        onClose={() => setModePopoverOpen(false)}
      >
        {[
          ['auto', '自动提问', '识别到面试官完整提问自动生成回答'],
          ['manual', '手动累计发送', '先累计对方转写，点击发送后再建题'],
          ['transcript-only', '仅转写', '只记录转写不自动调用大模型']
        ].map(([id, title, desc]) => (
          <button
            key={id}
            type="button"
            className="mc-dropdown-item"
            style={{
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              background: session.transcriptionMode === id ? 'var(--bg-hover)' : undefined
            }}
            onClick={() => {
              onChangeSessionMeta({ transcriptionMode: id });
              setModePopoverOpen(false);
            }}
          >
            <strong style={{ fontSize: 12 }}>{title}{session.transcriptionMode === id ? ' ✓' : ''}</strong>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</span>
          </button>
        ))}
        <div className="mc-dropdown-sep" />
        <div style={{ padding: '4px 8px', fontSize: 10.5, color: 'var(--text-faint)' }}>
          {asrCaps.supportsRevision ? '当前 ASR 支持同题修订协议' : '当前 ASR 返回临时/最终转写，不自动修订旧题'}
        </div>
      </AnchoredPopover>

      {/* 5. Coding / 作答偏好 Popover (shared between Interview Workbench and Written Floating Window) */}
      <CodingPrefsPopover
        open={codingPopoverOpen}
        anchorRef={codingBtnRef}
        codingPrefs={codingPrefs}
        onChange={next => void onUpdatePrefs({ codingPrefs: next })}
        onClose={() => setCodingPopoverOpen(false)}
      />

      {/* 6. Bottom-Right Model & Health Status Popover (per-capability deep-links — M13) */}
      <AnchoredPopover
        open={modelPopoverOpen}
        anchorRef={modelBtnRef}
        placement="top"
        align="end"
        offset={8}
        width={276}
        estimatedHeight={220}
        className="mc-dropdown-menu"
        style={{ padding: 10, gap: 6 }}
        ariaLabel="当前模型与服务状态"
        onClose={() => setModelPopoverOpen(false)}
      >
        <div style={{ fontSize: 12.5, fontWeight: 600, padding: '0 4px' }}>当前模型与本地服务</div>
        {[
          {
            cap: 'text-llm',
            label: '回答模型',
            dot: health.llm.ready ? 'mc-dot-ok' : 'mc-dot-warn',
            value: settings?.llm?.model || '待配置'
          },
          {
            cap: 'asr',
            label: '语音识别',
            dot: health.asr.ready ? 'mc-dot-ok' : health.asr.state === 'err' ? 'mc-dot-err' : 'mc-dot-warn',
            value: health.asr.label
          },
          {
            cap: 'vision',
            label: '截图视觉',
            dot: health.vision.ready ? 'mc-dot-ok' : 'mc-dot-idle',
            value: health.vision.label
          },
          {
            cap: 'kb',
            label: '本地资料库',
            dot: effectiveLibEnabled ? 'mc-dot-ok' : 'mc-dot-idle',
            value: effectiveLibEnabled ? `已启用 (${library?.files?.length || 0} 篇)` : '本场关闭'
          }
        ].map((row) => (
          <button
            key={row.cap}
            type="button"
            className="mc-dropdown-item"
            style={{ justifyContent: 'space-between', padding: '6px 8px', fontSize: 12 }}
            onClick={() => {
              setModelPopoverOpen(false);
              if (onNavigateCapability) onNavigateCapability(row.cap);
              else if (row.cap === 'kb') onOpenKnowledgeSettings?.();
              else onOpenSettings?.();
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
              <i className={`mc-dot ${row.dot}`} />
              <span>{row.label}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 155 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{row.value}</span>
              <span style={{ color: 'var(--text-faint)' }}>→</span>
            </span>
          </button>
        ))}
      </AnchoredPopover>

      {/* 7. Gear Popover (anchored directly below Gear button, immune to workbench hover opacity!) */}
      <GearPopover
        open={gearOpen}
        anchorRef={gearBtnRef}
        workbenchPrefs={workbenchPrefs}
        windowState={windowState}
        onUpdatePrefs={onUpdatePrefs}
        onSetPreventFocus={onSetPreventFocus}
        onSetAllowCapture={onSetAllowCapture}
        onSetClickThrough={onSetClickThrough}
        onOpenShortcuts={() => setShortcutModalOpen(true)}
        onClose={() => setGearOpen(false)}
      />

      {/* Interactive Workbench Shortcuts Modal */}
      {shortcutModalOpen && (
        <WorkbenchShortcutsModal
          settings={settings}
          windowState={windowState}
          onSettingsUpdated={onSettingsUpdated}
          onOpenFullSettings={onOpenSettings}
          onClose={() => setShortcutModalOpen(false)}
        />
      )}

      {/* Exit Confirm Modal */}
      {exitModalOpen && (
        <ExitConfirmModal
          saving={exitSaving}
          error={exitError}
          onSaveExit={() => void handleConfirmSaveExit()}
          onDiscardExit={() => { setExitModalOpen(false); void onEndSessionDiscard(); }}
          onCancel={() => { if (!exitSaving) setExitModalOpen(false); }}
        />
      )}

      {/* Security Mode Virtual SVG Cursor */}
      <VirtualCursor active={virtualCursorActive} />
    </>
  );
}
