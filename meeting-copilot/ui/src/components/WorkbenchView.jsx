import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computePrimaryButtonState,
  countNewerQuestions,
  getActiveAttempt,
  getSelectedQuestion
} from '../core/sessionModel.js';
import {
  CODING_EXPLAIN_MODES,
  CODING_LANGUAGES,
  formatCodingSummary,
  normalizeCodingPrefs
} from '../core/codingPrefs.js';
import { isInteractiveTarget } from '../core/clickThroughHitTest.js';
import { resolveAsrCapabilities } from '../core/turnPolicy.js';
import { GearPopover, ShortcutCheatSheetModal } from './GearPopover.jsx';
import { ThirdPane } from './ThirdPane.jsx';
import {
  IconArrowLeft,
  IconCheck,
  IconCode,
  IconCopy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconMaximize,
  IconMic,
  IconMicOff,
  IconMinus,
  IconPanelLeft,
  IconPanelRight,
  IconPin,
  IconRefresh,
  IconRestore,
  IconScan,
  IconSend,
  IconSettings,
  IconSpeaker,
  IconSpeakerOff,
  IconSquare,
  IconTrash,
  IconX
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
      <div className="mc-modal mc-modal-sm" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="结束本次面试会话">
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
  partials,
  manualDraft,
  workbenchPrefs,
  windowState,
  hoverInside,
  onBackHome,
  onToggleCapture,
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
  onOpenSettings
}) {
  const [draftText, setDraftText] = useState('');
  const [leftTab, setLeftTab] = useState('questions'); // 'questions' | 'transcript'
  const [elapsedSec, setElapsedSec] = useState(0);
  const [gearAnchor, setGearAnchor] = useState(null);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [exitSaving, setExitSaving] = useState(false);
  const [exitError, setExitError] = useState('');
  const [saveToast, setSaveToast] = useState(null); // { ok, text }
  const [clearArmed, setClearArmed] = useState(false);
  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [codingPopoverOpen, setCodingPopoverOpen] = useState(false);
  const [shotMenuOpen, setShotMenuOpen] = useState(false);
  const [audioPillOpen, setAudioPillOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [copiedAnswer, setCopiedAnswer] = useState(false);
  const [dragQuestionId, setDragQuestionId] = useState(null);
  const [dropQuestionId, setDropQuestionId] = useState(null);

  // Split layout state
  const [leftRatio, setLeftRatio] = useState(workbenchPrefs?.leftPaneRatio ?? 0.5);
  const [sideWidth, setSideWidth] = useState(workbenchPrefs?.sidePaneWidth ?? 300);
  const [draggingDivider, setDraggingDivider] = useState(null); // 'main' | 'side' | null
  const [leftPaneWidth, setLeftPaneWidth] = useState(360);

  const contentRef = useRef(null);
  const leftPaneRef = useRef(null);
  const answerScrollRef = useRef(null);
  const scrollMemoryRef = useRef(new Map());
  const prevQuestionIdRef = useRef(null);
  const audioPillTimerRef = useRef(null);
  const mouseInteractiveRef = useRef(false);

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
  const hoverReveal = Boolean(workbenchPrefs?.hoverReveal);
  const autoCollapseChrome = Boolean(workbenchPrefs?.autoCollapseChrome);
  const preventFocus = Boolean(windowState?.preventFocus);
  const clickThrough = Boolean(windowState?.clickThrough);
  const alwaysOnTop = windowState?.alwaysOnTop !== false;

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

  // Smart Local Click-Through hit-testing
  useEffect(() => {
    if (!clickThrough) {
      mouseInteractiveRef.current = false;
      return;
    }
    const onMove = (e) => {
      const interactive = isInteractiveTarget(e.target, e.clientX, e.clientY);
      if (interactive !== mouseInteractiveRef.current) {
        mouseInteractiveRef.current = interactive;
        window.mc?.setMouseInteractive?.(interactive);
      }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (mouseInteractiveRef.current) {
        mouseInteractiveRef.current = false;
        window.mc?.setMouseInteractive?.(false);
      }
    };
  }, [clickThrough]);

  // Close popovers on outside click / Esc
  useEffect(() => {
    const onWinClick = () => {
      setGearAnchor(null);
      setModePopoverOpen(false);
      setCodingPopoverOpen(false);
      setShotMenuOpen(false);
      setClearArmed(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setGearAnchor(null);
        setModePopoverOpen(false);
        setCodingPopoverOpen(false);
        setShotMenuOpen(false);
        setClearArmed(false);
      }
    };
    window.addEventListener('click', onWinClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onWinClick);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Layered opacity CSS custom properties
  const isAnimationSuppressed = Boolean(
    gearAnchor || shortcutModalOpen || exitModalOpen || codingPopoverOpen ||
    modePopoverOpen || shotMenuOpen || audioPillOpen || inputFocused ||
    windowState?.tempFocus || exitError
  );
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

  const openThirdPane = (targetTab) => {
    void onUpdatePrefs({ sidePaneOpen: true, sidePaneTab: targetTab });
  };

  const leftTierClass = leftPaneWidth < 150 ? 'is-narrow' : leftPaneWidth < 230 ? 'is-compact' : '';
  const effectiveLibEnabled = typeof session?.libraryEnabled === 'boolean' ? session.libraryEnabled : Boolean(library?.enabled);

  const renderAnswerBody = (question, attempt) => {
    if (!attempt) return <div className="mc-field-hint">正在等待回答…</div>;
    if (attempt.modelResults?.length > 0) {
      return <ModelAnswers results={attempt.modelResults} onlyOptions={session.scene === 'written'} />;
    }
    if (attempt.status === 'error') {
      return <div className="mc-alert mc-alert-err">{attempt.error || '生成失败'}</div>;
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
        {/* 44px TOP CHROME */}
        <header className="mc-wb-topbar" data-interactive="true">
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
              {/* Audio capture button + hover source pill */}
              <div
                style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                onMouseEnter={() => { clearTimeout(audioPillTimerRef.current); setAudioPillOpen(true); }}
                onMouseLeave={() => { audioPillTimerRef.current = setTimeout(() => setAudioPillOpen(false), 180); }}
              >
                <button
                  type="button"
                  className={`mc-icon-btn${capturing ? ' is-live' : ''}`}
                  title={capturing
                    ? `正在采集（${session.audioSource === 'mic' ? '麦克风' : '系统音频'}），点击暂停`
                    : `已暂停采集（${session.audioSource === 'mic' ? '麦克风' : '系统音频'}），点击开始`}
                  aria-label="开关音频采集"
                  onClick={onToggleCapture}
                >
                  {session.audioSource === 'mic'
                    ? (capturing ? <IconMic size={15} /> : <IconMicOff size={15} />)
                    : (capturing ? <IconSpeaker size={15} /> : <IconSpeakerOff size={15} />)}
                </button>
                {audioPillOpen && (
                  <div
                    data-interactive="true"
                    style={{
                      position: 'fixed', top: 48, right: 160, zIndex: 9950,
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: 4,
                      borderRadius: 99, border: '1px solid var(--border)', background: 'var(--popover-bg)', boxShadow: 'var(--shadow-md)'
                    }}
                    onMouseEnter={() => clearTimeout(audioPillTimerRef.current)}
                    onMouseLeave={() => { audioPillTimerRef.current = setTimeout(() => setAudioPillOpen(false), 150); }}
                  >
                    <button
                      type="button"
                      className={`mc-btn mc-btn-sm ${session.audioSource === 'system' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                      style={{ height: 24, borderRadius: 99 }}
                      onClick={() => { onSwitchAudioSource('system'); setAudioPillOpen(false); }}
                    >
                      <IconSpeaker size={12} /> 系统音频
                    </button>
                    <button
                      type="button"
                      className={`mc-btn mc-btn-sm ${session.audioSource === 'mic' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                      style={{ height: 24, borderRadius: 99 }}
                      onClick={() => { onSwitchAudioSource('mic'); setAudioPillOpen(false); }}
                    >
                      <IconMic size={12} /> 麦克风
                    </button>
                  </div>
                )}
              </div>

              {/* Screenshot capture + quick mode menu */}
              <div style={{ position: 'relative', display: 'inline-flex' }}>
                <button
                  type="button"
                  className="mc-icon-btn"
                  title="截取屏幕识题（右键展开框选/笔试小窗）"
                  aria-label="截取屏幕识题"
                  onClick={() => onCaptureScreen('full')}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setShotMenuOpen(v => !v); }}
                >
                  <IconScan size={15} />
                </button>
                {shotMenuOpen && (
                  <div className="mc-dropdown-menu" style={{ top: 46, right: 150 }} data-interactive="true" onClick={e => e.stopPropagation()}>
                    <button type="button" className="mc-dropdown-item" onClick={() => { setShotMenuOpen(false); onCaptureScreen('full'); }}>全屏截图识题</button>
                    <button type="button" className="mc-dropdown-item" onClick={() => { setShotMenuOpen(false); onCaptureScreen('region'); }}>框选区域识题</button>
                    <div className="mc-dropdown-sep" />
                    <button type="button" className="mc-dropdown-item" onClick={() => { setShotMenuOpen(false); onEnterWrittenCompact(); }}>切换到笔试小窗</button>
                  </div>
                )}
              </div>

              {/* Hover Reveal (Eye icon) */}
              <button
                type="button"
                className={`mc-icon-btn${hoverReveal ? ' is-active' : ''}`}
                title={hoverReveal ? `悬停显隐已开启（移出渐隐至 ${workbenchPrefs?.hoverOpacity ?? 8}%）` : '开启悬停显隐（鼠标移出窗口时淡化隐身）'}
                aria-label="悬停显隐"
                aria-pressed={hoverReveal}
                onClick={() => void onUpdatePrefs({ hoverReveal: !hoverReveal })}
              >
                {hoverReveal ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>

              {/* Eye Contact Toggle */}
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
                type="button"
                className={`mc-icon-btn${gearAnchor ? ' is-active' : ''}`}
                title="会中窗口与透明度设置"
                aria-label="会中设置"
                aria-expanded={!!gearAnchor}
                onClick={(e) => {
                  e.stopPropagation();
                  if (gearAnchor) setGearAnchor(null);
                  else setGearAnchor(e.currentTarget.getBoundingClientRect());
                }}
              >
                <IconSettings size={15} />
              </button>

              {/* Third Pane Toggle */}
              <button
                type="button"
                className={`mc-icon-btn${sideOpen ? ' is-active' : ''}`}
                title={sideOpen ? '收起右侧辅助栏（依据/转写/翻译）' : '展开右侧辅助栏（依据/转写/翻译）'}
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
          {/* LEFT PANE: Questions + Manual/Live Input */}
          {!leftCollapsed && (
            <section ref={leftPaneRef} className={`mc-wb-pane ${leftTierClass}`} aria-label="问题列表栏">
              <div className="mc-wb-pane-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className={`mc-btn mc-btn-sm ${leftTab === 'questions' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 11.5 }}
                    onClick={() => setLeftTab('questions')}
                  >
                    问题 ({session?.questions?.length || 0})
                  </button>
                  <button
                    type="button"
                    className={`mc-btn mc-btn-sm ${leftTab === 'transcript' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                    style={{ height: 22, padding: '0 7px', fontSize: 11.5 }}
                    onClick={() => setLeftTab('transcript')}
                  >
                    转写 ({session?.segments?.length || 0})
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
                            <button type="button" className="mc-btn mc-btn-sm" style={{ height: 19, padding: '0 5px', fontSize: 10.5 }} onClick={() => onAskText(seg.text, [seg.id])}>
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

              {/* LEFT BOTTOM INPUT BAR */}
              <div className="mc-wb-input-wrap" data-interactive="true">
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <textarea
                    className="mc-textarea"
                    rows={1}
                    style={{ minHeight: 34, maxHeight: 84, padding: '7px 10px', resize: 'none', fontSize: 12.5 }}
                    value={draftText}
                    placeholder={preventFocus || clickThrough ? '点击开始安全输入' : '输入问题，Enter 发送 / Shift+Enter 换行'}
                    onMouseDown={() => {
                      if (preventFocus) void window.mc.requestTempFocus(true);
                    }}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => {
                      setInputFocused(false);
                      if (preventFocus) void window.mc.requestTempFocus(false);
                    }}
                    onChange={e => setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && preventFocus) {
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
                  <button
                    type="button"
                    className={`mc-btn ${primaryBtn.action === 'stop' ? 'mc-btn-danger' : 'mc-btn-primary'}`}
                    style={{ width: 34, height: 34, padding: 0, borderRadius: 99, flexShrink: 0 }}
                    disabled={primaryBtn.disabled}
                    title={primaryBtn.label}
                    aria-label={primaryBtn.label}
                    onClick={handlePrimaryAction}
                  >
                    {primaryBtn.action === 'stop' ? <IconSquare size={12} /> :
                      primaryBtn.action === 'regenerate' ? <IconRefresh size={14} /> :
                        <IconSend size={14} />}
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className={`mc-btn mc-btn-sm ${clearArmed ? 'mc-btn-danger' : 'mc-btn-ghost'}`}
                      style={{ height: 22, padding: '0 6px', fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (clearArmed) { onClearSessionContent(); setClearArmed(false); }
                        else setClearArmed(true);
                      }}
                      onBlur={() => setClearArmed(false)}
                      title="清空本场会话历史（需连续点击两次确认）"
                    >
                      <IconTrash size={12} /> {clearArmed ? '再点一次清空' : ''}
                    </button>

                    {/* Transcription mode selector */}
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="mc-btn mc-btn-sm mc-btn-ghost"
                        style={{ height: 22, padding: '0 7px', fontSize: 11 }}
                        onClick={(e) => { e.stopPropagation(); setModePopoverOpen(v => !v); }}
                      >
                        {session.transcriptionMode === 'manual' ? '手动发送' :
                          session.transcriptionMode === 'transcript-only' ? '仅转写' : '自动提问'}
                      </button>
                      {modePopoverOpen && (
                        <div className="mc-dropdown-menu" style={{ bottom: 44, left: 10, width: 220 }} data-interactive="true" onClick={e => e.stopPropagation()}>
                          {[
                            ['auto', '自动提问', '识别到面试官完整提问自动生成回答'],
                            ['manual', '手动累计发送', '先累计对方转写，点击发送后再建题'],
                            ['transcript-only', '仅转写', '只记录转写不自动调用大模型']
                          ].map(([id, title, desc]) => (
                            <button
                              key={id}
                              type="button"
                              className="mc-dropdown-item"
                              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: session.transcriptionMode === id ? 'var(--bg-hover)' : undefined }}
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
                        </div>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{primaryBtn.label}</span>
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

          {/* RIGHT MAIN ANSWER PANE (or Single-Column Flow when leftCollapsed) */}
          <section className="mc-wb-pane" aria-label="回答阅读区">
            <div className="mc-wb-pane-header" data-interactive="true">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflowX: 'auto' }}>
                {session.audioSource === 'system' && (
                  <button
                    type="button"
                    className={`mc-btn mc-btn-sm ${secondaryMicActive ? 'mc-btn-primary' : ''}`}
                    style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
                    title="开启后将本人麦克风发言一并记入对话上下文"
                    onClick={onToggleSecondaryMic}
                  >
                    {secondaryMicActive ? <IconMic size={12} /> : <IconMicOff size={12} />} 对话上下文
                  </button>
                )}

                <button
                  type="button"
                  className={`mc-btn mc-btn-sm ${effectiveLibEnabled ? 'mc-btn-primary' : ''}`}
                  style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
                  title="仅针对本场面试开关本地资料库 V2 检索，不改写全局配置"
                  onClick={() => onChangeSessionMeta({ libraryEnabled: !effectiveLibEnabled })}
                >
                  <IconFolder size={12} /> 资料库{effectiveLibEnabled ? '' : '关'}
                </button>

                {effectiveLibEnabled && (library?.roles?.length || 0) > 0 && (
                  <select
                    className="mc-filter-select"
                    style={{ height: 24, fontSize: 11.5, maxWidth: 120 }}
                    value={session.role || ''}
                    aria-label="本场岗位目录"
                    onChange={e => onChangeSessionMeta({ role: e.target.value })}
                  >
                    <option value="">默认岗位</option>
                    {library.roles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="mc-btn mc-btn-sm"
                  style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
                  title="切换本场回答语言"
                  onClick={() => onChangeSessionMeta({ answerLang: session.answerLang === 'english' ? 'chinese' : 'english' })}
                >
                  {session.answerLang === 'english' ? 'EN' : '中文'}
                </button>
              </div>
            </div>

            <div className="mc-wb-answer-scroll" ref={answerScrollRef} data-scrollable="true">
              {leftCollapsed ? (
                /* Single-column chronological Q&A stream */
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
                        <select
                          className="mc-filter-select"
                          style={{ height: 22, fontSize: 11 }}
                          value={selectedQuestion.activeAttemptId || ''}
                          onChange={e => onSelectAttempt(selectedQuestion.id, e.target.value)}
                          aria-label="切换回答版本"
                        >
                          {selectedQuestion.attempts.map((a, i) => (
                            <option key={a.id} value={a.id}>尝试 {i + 1}</option>
                          ))}
                        </select>
                      )}
                      {activeAttempt?.text && (
                        <button type="button" className="mc-btn mc-btn-sm" style={{ height: 22 }} onClick={() => void copyCurrentAnswer(activeAttempt.text)}>
                          {copiedAnswer ? <><IconCheck size={11} /> 已复制</> : <><IconCopy size={11} /> 复制</>}
                        </button>
                      )}
                    </div>
                  </div>

                  {renderAnswerBody(selectedQuestion, activeAttempt)}

                  {/* V2 Unknown Facts & Evidence Bar */}
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
                        onClick={() => openThirdPane('evidence')}
                      >
                        引用 {(activeAttempt.evidenceRefs || activeAttempt.citations || []).length} / 检索 {activeAttempt.evidence?.length || 0} · 查看依据与原文 →
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mc-field-hint" style={{ marginTop: 36, textAlign: 'center' }}>
                  {health.llm.ready ? '等待第一个提问… 识别到问题后回答将实时流式显示在这里。' : '文本大模型尚未配置 API Key，点击右下角模型名可前往设置。'}
                </div>
              )}
            </div>

            {/* RIGHT BOTTOM TOOLBAR (Coding Prefs + Text Model) */}
            <footer className="mc-wb-answer-foot" data-interactive="true">
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={`mc-btn mc-btn-sm ${codingPrefs.mode === 'coding' ? 'mc-btn-primary' : 'mc-btn-ghost'}`}
                  style={{ height: 24, padding: '0 8px', fontSize: 11.5 }}
                  onClick={(e) => { e.stopPropagation(); setCodingPopoverOpen(v => !v); }}
                >
                  <IconCode size={13} /> {formatCodingSummary(codingPrefs)}
                </button>
                {codingPopoverOpen && (
                  <div
                    className="mc-dropdown-menu"
                    style={{ bottom: 42, left: 12, width: 256, padding: 10, gap: 8 }}
                    data-interactive="true"
                    onClick={e => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 12 }}>作答偏好（截图/手写算法）</strong>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className={`mc-btn mc-btn-sm ${codingPrefs.mode === 'normal' ? 'mc-btn-primary' : ''}`} style={{ height: 22 }} onClick={() => void onUpdatePrefs({ codingPrefs: { ...codingPrefs, mode: 'normal' } })}>常规</button>
                        <button type="button" className={`mc-btn mc-btn-sm ${codingPrefs.mode === 'coding' ? 'mc-btn-primary' : ''}`} style={{ height: 22 }} onClick={() => void onUpdatePrefs({ codingPrefs: { ...codingPrefs, mode: 'coding' } })}>Coding</button>
                      </div>
                    </div>
                    {codingPrefs.mode === 'coding' && (
                      <>
                        <div className="mc-field">
                          <label className="mc-field-label" style={{ fontSize: 11.5 }}>首选编程语言</label>
                          <select
                            className="mc-select"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            value={codingPrefs.language}
                            onChange={e => void onUpdatePrefs({ codingPrefs: { ...codingPrefs, language: e.target.value } })}
                          >
                            {CODING_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                          </select>
                        </div>
                        <div className="mc-field">
                          <label className="mc-field-label" style={{ fontSize: 11.5 }}>讲解风格</label>
                          <select
                            className="mc-select"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            value={codingPrefs.explainMode}
                            onChange={e => void onUpdatePrefs({ codingPrefs: { ...codingPrefs, explainMode: e.target.value } })}
                          >
                            {CODING_EXPLAIN_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <span>附带时间/空间复杂度</span>
                          <Switch checked={codingPrefs.includeComplexity} onChange={v => void onUpdatePrefs({ codingPrefs: { ...codingPrefs, includeComplexity: v } })} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <span>提示边界条件</span>
                          <Switch checked={codingPrefs.includeEdgeCases} onChange={v => void onUpdatePrefs({ codingPrefs: { ...codingPrefs, includeEdgeCases: v } })} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="mc-btn mc-btn-sm mc-btn-ghost"
                style={{ height: 24, fontSize: 11.5 }}
                onClick={onOpenSettings}
                title="点击前往高级设置修改模型"
              >
                <span className={`mc-dot ${health.llm.ready ? 'mc-dot-ok' : 'mc-dot-warn'}`} />
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {settings?.llm?.model || '未配置文本模型'}
                </span>
              </button>
            </footer>
          </section>

          {/* THIRD PANE DIVIDER + THIRD PANE */}
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
                onSelectTab={(t) => void onUpdatePrefs({ sidePaneTab: t })}
                onClose={() => void onUpdatePrefs({ sidePaneOpen: false })}
                session={session}
                selectedQuestion={selectedQuestion}
                partials={partials}
                answersReady={health.llm.ready}
                onAskText={onAskText}
                onTranslateSegment={onTranslateSegment}
                onTranslateAnswer={onTranslateAnswer}
                onClearTranscript={onClearTranscript}
              />
            </>
          )}
        </div>
      </div>

      {/* FLOATING STATUS PILLS (Top-Right, always clickable even during click-through) */}
      {(clickThrough || preventFocus) && (
        <div className="mc-floating-pills">
          {clickThrough && (
            <div className="mc-floating-pill" data-interactive="true">
              <span>鼠标穿透已开启</span>
              <span className="mc-kbd">Ctrl + Shift + 9</span>
              <button type="button" className="mc-icon-btn" style={{ width: 20, height: 20 }} title="关闭鼠标穿透" onClick={() => void onSetClickThrough(false)}>
                <IconX size={12} />
              </button>
            </div>
          )}
          {preventFocus && (
            <div className="mc-floating-pill" data-interactive="true">
              <span>焦点屏蔽已开启</span>
              <span className="mc-kbd">Ctrl + Shift + 8</span>
              {!windowState?.securityMode?.enabled && (
                <button type="button" className="mc-icon-btn" style={{ width: 20, height: 20 }} title="关闭不抢焦点" onClick={() => void onSetPreventFocus(false)}>
                  <IconX size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* GEAR POPOVER (top-level fixed sibling, immune to workbench hover opacity!) */}
      {gearAnchor && (
        <GearPopover
          anchorRect={gearAnchor}
          workbenchPrefs={workbenchPrefs}
          windowState={windowState}
          onUpdatePrefs={onUpdatePrefs}
          onSetPreventFocus={onSetPreventFocus}
          onSetAllowCapture={onSetAllowCapture}
          onSetClickThrough={onSetClickThrough}
          onOpenShortcuts={() => setShortcutModalOpen(true)}
          onClose={() => setGearAnchor(null)}
        />
      )}

      {shortcutModalOpen && (
        <ShortcutCheatSheetModal
          settings={settings}
          windowState={windowState}
          onOpenFullSettings={onOpenSettings}
          onClose={() => setShortcutModalOpen(false)}
        />
      )}

      {exitModalOpen && (
        <ExitConfirmModal
          saving={exitSaving}
          error={exitError}
          onSaveExit={() => void handleConfirmSaveExit()}
          onDiscardExit={() => { setExitModalOpen(false); void onEndSessionDiscard(); }}
          onCancel={() => { if (!exitSaving) setExitModalOpen(false); }}
        />
      )}
    </>
  );
}
