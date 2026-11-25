import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatCodingSummary, normalizeCodingPrefs } from '../core/codingPrefs.js';
import { isInteractiveTarget, startClickThroughPolling } from '../core/clickThroughHitTest.js';
import { getActiveAttempt, getSelectedQuestion } from '../core/sessionModel.js';
import { AnchoredPopover } from './AnchoredPopover.jsx';
import { CodingPrefsPopover } from './CodingPrefsPopover.jsx';
import { GearPopover, WorkbenchShortcutsModal } from './GearPopover.jsx';
import {
  IconArrowLeft,
  IconArrowUp,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconGrid4,
  IconImage,
  IconLayers,
  IconMaximize2,
  IconMessageSquare,
  IconMinimize2,
  IconMousePointer,
  IconPin,
  IconPlus,
  IconRefresh,
  IconScan,
  IconSettings,
  IconSquare,
  IconTrash,
  IconX,
  IconZap
} from './Icons.jsx';
import { EyeContactToggle, WrittenAnswerContent, compactWrittenAnswer } from './SharedWidgets.jsx';
import { VirtualCursor } from './VirtualCursor.jsx';

export function writtenAnswerRows(question) {
  if (!question) return [];
  const attempt = getActiveAttempt(question);
  if (!attempt) return [];
  if (attempt.modelResults?.length) {
    return [...attempt.modelResults].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  const text = String(attempt.text || '');
  const headings = [...text.matchAll(/^【([^\n]+)】\s*$/gm)];
  if (headings.length) {
    return headings.map((heading, index) => ({
      id: `stored-${index}`,
      index,
      name: heading[1],
      model: '',
      status: 'done',
      text: text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim()
    }));
  }
  return [{
    id: attempt.id,
    index: 0,
    name: '答案',
    model: '',
    status: attempt.status === 'streaming' ? 'pending' : attempt.status === 'error' ? 'error' : 'done',
    text,
    error: attempt.error,
    latencyMs: attempt.completedAt && attempt.createdAt ? Math.max(0, attempt.completedAt - attempt.createdAt) : undefined
  }];
}

function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatKeyShort(acc) {
  if (!acc) return '未设置';
  return String(acc)
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, '+');
}

function isPureChoiceAnswer(text) {
  const compact = compactWrittenAnswer(text);
  return Boolean(compact && /^[A-H]+(?:\n[A-H]+)*$/.test(compact));
}

export function WrittenCompactView({
  settings,
  workbenchPrefs,
  windowState,
  hoverInside = true,
  writtenSession,
  ready,
  error,
  batch,
  batchController,
  onCapture,
  onFollowupSend,
  onRegenerateQuestion,
  onSelectQuestion,
  onCancel,
  onRestore,
  onNewSession,
  onEndSession,
  onOpenVisionSettings,
  onUpdatePrefs,
  onSetAlwaysOnTop,
  onSetPreventFocus,
  onSetAllowCapture,
  onSetClickThrough,
  onToggleMiniMode,
  onSettingsUpdated,
  onOpenFullSettings
}) {
  const [draftText, setDraftText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [codingPopoverOpen, setCodingPopoverOpen] = useState(false);
  const [shotMenuOpen, setShotMenuOpen] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [copiedId, setCopiedId] = useState('');
  const [localMsg, setLocalMsg] = useState('');

  const gearBtnRef = useRef(null);
  const shotBtnRef = useRef(null);
  const codingBtnRef = useRef(null);
  const modelBtnRef = useRef(null);
  const readerRef = useRef(null);
  const inputRef = useRef(null);
  const mouseInteractiveRef = useRef(false);
  const windowDraggingRef = useRef(false);

  const validSession = writtenSession && writtenSession.scene === 'written' ? writtenSession : null;
  const questions = validSession?.questions || [];
  const selectedQuestion = getSelectedQuestion(validSession);
  const selectedIdx = selectedQuestion ? questions.findIndex(q => q.id === selectedQuestion.id) : -1;
  const attempt = getActiveAttempt(selectedQuestion);
  const rows = writtenAnswerRows(selectedQuestion);

  const writtenCfg = workbenchPrefs?.writtenConfig || {};
  const writtenMode = writtenCfg.mode === 'followup' ? 'followup' : 'fast';
  const compactMini = Boolean(writtenCfg.compactMini);
  const miniFontSize = writtenCfg.miniFontSize ?? 24;
  const showModelNames = writtenCfg.showModelNames !== false;
  const codingPrefs = normalizeCodingPrefs(workbenchPrefs?.codingPrefs);

  const enabledEndpoints = useMemo(
    () => (settings?.multimodal?.endpoints || []).filter(e => e.enabled && e.baseUrl && e.model),
    [settings?.multimodal?.endpoints]
  );
  const primaryEndpoint = useMemo(() => {
    if (!enabledEndpoints.length) return null;
    if (writtenCfg.preferredEndpointId) {
      const picked = enabledEndpoints.find(e => e.id === writtenCfg.preferredEndpointId);
      if (picked) return picked;
    }
    return enabledEndpoints[0];
  }, [enabledEndpoints, writtenCfg.preferredEndpointId]);

  const effectiveSimultaneous = useMemo(() => {
    if (writtenMode === 'followup') return false;
    if (writtenCfg.simultaneousMode === 'parallel') return true;
    if (writtenCfg.simultaneousMode === 'single') return false;
    return Boolean(settings?.multimodal?.simultaneousAnswers);
  }, [writtenMode, writtenCfg.simultaneousMode, settings?.multimodal?.simultaneousAnswers]);

  const hoverReveal = Boolean(workbenchPrefs?.hoverReveal);
  const autoCollapseChrome = Boolean(workbenchPrefs?.autoCollapseChrome);
  const preventFocus = Boolean(windowState?.preventFocus);
  const clickThrough = Boolean(windowState?.clickThrough);
  const alwaysOnTop = windowState?.alwaysOnTop !== false;
  const virtualCursorActive = Boolean(windowState?.securityMode?.enabled && windowState?.securityMode?.hideCursor !== false);
  const clickThroughKeyLabel = (windowState?.workbenchHotkeys?.toggleClickThrough || windowState?.hotkeys?.toggleClickThrough || 'Control+Shift+9')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ');

  const isStreaming = Boolean(attempt && attempt.status === 'streaming');
  const stagedImages = batch?.images || [];
  const hasStaged = stagedImages.length > 0;

  const patchWrittenCfg = useCallback((delta) => {
    void onUpdatePrefs?.({ writtenConfig: { ...writtenCfg, ...delta } });
  }, [onUpdatePrefs, writtenCfg]);

  const closeOtherPopovers = useCallback((keep) => {
    if (keep !== 'gear') setGearOpen(false);
    if (keep !== 'coding') setCodingPopoverOpen(false);
    if (keep !== 'shot') setShotMenuOpen(false);
    if (keep !== 'model') setModelPopoverOpen(false);
  }, []);

  // Scroll reader appropriately when questions or answer status change
  useLayoutEffect(() => {
    const el = readerRef.current;
    if (!el) return;
    if (writtenMode === 'followup') {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop = 0;
    }
  }, [selectedQuestion?.id, questions.length, writtenMode, attempt?.status, attempt?.text?.length]);

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
    const stopPolling = startClickThroughPolling(window.mc?.getCursorInContent, pushInteractive, 80);
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

  // Clean up JS drag on unmount
  useEffect(() => () => {
    if (windowDraggingRef.current) {
      windowDraggingRef.current = false;
      window.mc?.dragEnd?.();
    }
  }, []);

  // Suppress hover-reveal & auto-collapse while interactive overlays or input are active
  const isAnimationSuppressed = Boolean(
    gearOpen || shortcutModalOpen || codingPopoverOpen || shotMenuOpen || modelPopoverOpen ||
    lightboxImage || inputFocused || windowState?.tempFocus
  );
  useEffect(() => {
    void window.mc?.setHoverBlocked?.(isAnimationSuppressed)?.catch?.(() => {});
  }, [isAnimationSuppressed]);
  useEffect(() => () => {
    void window.mc?.setHoverBlocked?.(false)?.catch?.(() => {});
  }, []);

  // Listen for floating hotkeys (prev/next question, scroll up/down, close without save)
  useEffect(() => {
    const off = window.mc?.onWorkbenchHotkeyAction?.(({ action }) => {
      if (action === 'questionPrev' && questions.length > 1) {
        const curIdx = selectedIdx >= 0 ? selectedIdx : questions.length - 1;
        if (curIdx > 0) onSelectQuestion?.(questions[curIdx - 1].id);
      } else if (action === 'questionNext' && questions.length > 1) {
        const curIdx = selectedIdx >= 0 ? selectedIdx : questions.length - 1;
        if (curIdx < questions.length - 1) onSelectQuestion?.(questions[curIdx + 1].id);
      } else if (action === 'scrollUp' && readerRef.current) {
        readerRef.current.scrollBy({ top: -180, behavior: 'smooth' });
      } else if (action === 'scrollDown' && readerRef.current) {
        readerRef.current.scrollBy({ top: 180, behavior: 'smooth' });
      } else if (action === 'closeWithoutSave') {
        onEndSession?.();
      }
    });
    return () => off?.();
  }, [questions, selectedIdx, onSelectQuestion, onEndSession]);

  // Escape closes lightbox / popovers first, or returns to Home when idle
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (lightboxImage) { e.preventDefault(); setLightboxImage(null); return; }
      if (gearOpen || codingPopoverOpen || shotMenuOpen || modelPopoverOpen || shortcutModalOpen) return;
      if (inputFocused) { inputRef.current?.blur?.(); return; }
      if (!isStreaming) {
        e.preventDefault();
        onRestore?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxImage, gearOpen, codingPopoverOpen, shotMenuOpen, modelPopoverOpen, shortcutModalOpen, inputFocused, isStreaming, onRestore]);

  // SuiSi JS pointer window dragging
  const handleTopbarPointerDown = useCallback((e) => {
    if (e.button !== 0 || clickThrough) return;
    if (e.target instanceof Element && e.target.closest('button, input, textarea, select, [role="button"], [role="combobox"], [data-no-drag="true"]')) {
      return;
    }
    e.preventDefault();
    windowDraggingRef.current = true;
    window.mc?.dragStart?.();
    const onMove = () => {
      if (windowDraggingRef.current) window.mc?.dragMove?.();
    };
    const finish = () => {
      if (!windowDraggingRef.current) return;
      windowDraggingRef.current = false;
      window.mc?.dragEnd?.();
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', finish);
  }, [clickThrough]);

  const handleCopyText = async (id, text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      setCopiedId(id);
      setTimeout(() => setCopiedId(prev => (prev === id ? '' : prev)), 1300);
    } catch {}
  };

  // Support Ctrl+V pasting screenshots directly into the inline thumbnail queue
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : '';
          if (dataUrl) {
            batchController?.addImage?.(dataUrl, `粘贴 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
          }
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  }, [batchController]);

  const handleSubmitFollowup = useCallback(() => {
    const clean = draftText.trim();
    const imgs = stagedImages.map(x => x.dataUrl);
    if (!clean && !imgs.length) return;
    setDraftText('');
    if (imgs.length) batchController?.clear?.();
    onFollowupSend?.(clean, imgs);
  }, [draftText, stagedImages, batchController, onFollowupSend]);

  const handleSwitchToFollowup = useCallback(() => {
    patchWrittenCfg({ mode: 'followup', compactMini: false });
    if (compactMini) onToggleMiniMode?.(false);
    setTimeout(() => inputRef.current?.focus?.(), 120);
  }, [patchWrittenCfg, compactMini, onToggleMiniMode]);

  const handleOpenShotDir = async () => {
    setShotMenuOpen(false);
    try {
      await window.mc?.openScreenshotFolder?.();
    } catch (e) {
      setLocalMsg(e?.message || '无法打开截图目录');
      setTimeout(() => setLocalMsg(''), 3000);
    }
  };

  // Layered opacity tokens (identical to WorkbenchView!)
  const bgAlpha = Math.max(0, Math.min(1, (workbenchPrefs?.bgOpacity ?? 82) / 100));
  const iconAlpha = Math.max(0.05, Math.min(1, (workbenchPrefs?.iconTextOpacity ?? 100) / 100));
  const answerAlpha = Math.max(0.05, Math.min(1, (workbenchPrefs?.answerTextOpacity ?? 100) / 100));
  const hoverOpacityVal = Math.max(0.02, Math.min(0.5, (workbenchPrefs?.hoverOpacity ?? 8) / 100));
  const effectiveHoverInside = hoverInside || isAnimationSuppressed;
  const shellOpacity = hoverReveal && !effectiveHoverInside ? hoverOpacityVal : 1;
  const shouldCollapseChrome = autoCollapseChrome && !effectiveHoverInside && !isAnimationSuppressed;

  const shellStyle = {
    '--mc-bg-alpha': bgAlpha,
    '--mc-icon-alpha': iconAlpha,
    '--mc-answer-alpha': answerAlpha,
    '--mc-wb-font-size': `${workbenchPrefs?.fontSize ?? 14}px`,
    opacity: shellOpacity,
    transition: 'opacity 180ms ease'
  };

  // Compute live footer latency / status summary
  const footerStatus = useMemo(() => {
    if (isStreaming) {
      return attempt?.statusText || (effectiveSimultaneous ? `并行识题中 (${rows.filter(r => r.status === 'done').length}/${rows.length || enabledEndpoints.length})…` : '正在请求首选视觉模型…');
    }
    if (attempt?.status === 'done') {
      const doneRows = rows.filter(r => r.status === 'done');
      const msList = doneRows.map(r => r.latencyMs).filter(v => Number.isFinite(v) && v > 0);
      const elapsed = msList.length
        ? Math.max(...msList)
        : (attempt.completedAt && attempt.createdAt ? Math.max(0, attempt.completedAt - attempt.createdAt) : 0);
      const latStr = formatLatency(elapsed);
      if (rows.length > 1) {
        return `${latStr ? `耗时 ${latStr} · ` : ''}${doneRows.length}/${rows.length} 模型完成`;
      }
      return latStr ? `耗时 ${latStr}` : '已完成';
    }
    if (!ready) return '视觉模型待配置';
    return `待命 · ${enabledEndpoints.length} 个视觉模型`;
  }, [isStreaming, attempt, effectiveSimultaneous, rows, enabledEndpoints.length, ready]);

  const modelButtonLabel = useMemo(() => {
    if (!ready) return '未配置视觉';
    if (writtenMode === 'followup') {
      const name = primaryEndpoint?.model || primaryEndpoint?.name || '首选视觉';
      return `主视觉 · ${name}`;
    }
    if (effectiveSimultaneous && enabledEndpoints.length > 1) {
      return `并行 · ${enabledEndpoints.length}模型`;
    }
    return primaryEndpoint?.model || primaryEndpoint?.name || '首选视觉';
  }, [ready, writtenMode, primaryEndpoint, effectiveSimultaneous, enabledEndpoints.length]);

  // =========================================================================
  // MINI CHOICE STRIP MODE (One-click compact overlay, still on workbench-window)
  // =========================================================================
  if (compactMini) {
    return (
      <>
        <section
          className={`mc-wf-shell mc-wf-mini${effectiveHoverInside ? ' is-hover-in' : ''}${shouldCollapseChrome ? ' is-chrome-collapsed' : ''}`}
          style={shellStyle}
          aria-label="笔试极简选项条"
        >
          <header className="mc-wf-mini-header" data-interactive="true" onPointerDown={handleTopbarPointerDown}>
            <strong className="mc-wf-mini-title" title="拖动移动小窗">
              {clickThrough ? '穿透中' : questions.length > 0 ? `第 ${selectedIdx + 1}/${questions.length} 题` : '笔试极简条'}
            </strong>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {questions.length > 1 && (
                <>
                  <button
                    type="button"
                    className="mc-icon-btn mc-wf-mini-btn"
                    disabled={selectedIdx <= 0}
                    title="上一题"
                    aria-label="上一题"
                    onClick={() => selectedIdx > 0 && onSelectQuestion?.(questions[selectedIdx - 1].id)}
                  >
                    <IconChevronLeft size={12} />
                  </button>
                  <button
                    type="button"
                    className="mc-icon-btn mc-wf-mini-btn"
                    disabled={selectedIdx >= questions.length - 1}
                    title="下一题"
                    aria-label="下一题"
                    onClick={() => selectedIdx < questions.length - 1 && onSelectQuestion?.(questions[selectedIdx + 1].id)}
                  >
                    <IconChevronRight size={12} />
                  </button>
                </>
              )}
              <button
                type="button"
                className="mc-btn mc-btn-sm"
                style={{ height: 20, padding: '0 5px', fontSize: 10.5 }}
                disabled={miniFontSize <= 12}
                title="缩小选项字号"
                aria-label="缩小字号"
                onClick={() => patchWrittenCfg({ miniFontSize: Math.max(12, miniFontSize - 2) })}
              >
                A−
              </button>
              <button
                type="button"
                className="mc-btn mc-btn-sm"
                style={{ height: 20, padding: '0 5px', fontSize: 10.5 }}
                disabled={miniFontSize >= 64}
                title="放大选项字号"
                aria-label="放大字号"
                onClick={() => patchWrittenCfg({ miniFontSize: Math.min(64, miniFontSize + 2) })}
              >
                A+
              </button>
              <button
                type="button"
                className="mc-icon-btn mc-wf-mini-btn"
                title="展开标准笔试浮窗（支持多轮追问与 Coding 偏好）"
                aria-label="展开标准笔试浮窗"
                onClick={() => onToggleMiniMode?.(false)}
              >
                <IconMaximize2 size={12} />
              </button>
              <button
                ref={gearBtnRef}
                type="button"
                className={`mc-icon-btn mc-wf-mini-btn${gearOpen ? ' is-active' : ''}`}
                title="笔试浮窗设置"
                aria-label="笔试设置"
                onClick={(e) => {
                  e.stopPropagation();
                  setGearOpen(v => { const n = !v; if (n) closeOtherPopovers('gear'); return n; });
                }}
              >
                <IconSettings size={12} />
              </button>
              <button
                type="button"
                className="mc-icon-btn mc-wf-mini-btn"
                title="返回主界面 (Esc)"
                aria-label="返回主界面"
                onClick={onRestore}
              >
                <IconArrowLeft size={12} />
              </button>
            </div>
          </header>

          {error && <div role="alert" className="mc-alert mc-alert-err" style={{ fontSize: 10.5, padding: '3px 6px', margin: '3px 6px 0' }}>{error}</div>}

          <div ref={readerRef} className="mc-wf-mini-body" data-scrollable="true" role="region" aria-label="笔试模型回答">
            {rows.length > 0 ? rows.map((result, index) => (
              <div
                key={result.id || index}
                className="mc-wf-mini-row"
                style={{
                  gridTemplateColumns: showModelNames ? 'minmax(52px, 36%) minmax(0, 1fr)' : '14px minmax(0, 1fr)'
                }}
              >
                <span className="mc-wf-mini-model" title={[result.name, result.model].filter(Boolean).join(' · ')}>
                  {showModelNames ? `${index + 1} ${result.model || result.name}` : String(index + 1)}
                </span>
                {result.status === 'done' ? (
                  <div style={{ minWidth: 0, gridColumn: isPureChoiceAnswer(result.text) ? undefined : '1 / -1' }}>
                    <WrittenAnswerContent
                      value={result.text}
                      fontSize={isPureChoiceAnswer(result.text) ? miniFontSize : Math.min(miniFontSize, workbenchPrefs?.fontSize ?? 14)}
                      compact
                    />
                  </div>
                ) : (
                  <span style={{ fontSize: result.status === 'pending' ? 13 : 11, color: result.status === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {result.status === 'pending' ? '…' : result.error || '已停止'}
                  </span>
                )}
              </div>
            )) : (
              <div className="mc-wf-mini-empty">
                <div>{ready ? '等待题图 · 按截屏快捷键开始识题' : '视觉模型未配置'}</div>
                {!ready && onOpenVisionSettings && (
                  <button type="button" className="mc-btn mc-btn-sm" onClick={onOpenVisionSettings}>
                    去配置截图模型
                  </button>
                )}
              </div>
            )}
          </div>

          <footer className="mc-wf-mini-footer" data-interactive="true">
            {isStreaming ? (
              <button type="button" className="mc-btn mc-btn-sm" style={{ height: 20, padding: '0 6px', fontSize: 10.5 }} onClick={() => attempt && onCancel?.(attempt.requestId)}>
                停止
              </button>
            ) : (
              <button type="button" className="mc-btn mc-btn-sm" style={{ height: 20, padding: '0 6px', fontSize: 10.5 }} disabled={!ready} onClick={() => onCapture?.('region')}>
                框选
              </button>
            )}
            <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
              暂存 {stagedImages.length}/12
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-faint)' }}>
              {rows.length ? `${rows.filter(r => r.status === 'done').length}/${rows.length}` : '0/0'}
            </span>
          </footer>

          {clickThrough && (
            <div className="mc-clickthrough-pill" data-interactive="true" role="status">
              <IconMousePointer size={11} />
              <span>穿透 · {clickThroughKeyLabel}</span>
              <button type="button" className="mc-btn mc-btn-sm" style={{ height: 19, padding: '0 6px', fontSize: 10 }} onClick={() => void onSetClickThrough?.(false)}>
                退出
              </button>
            </div>
          )}
        </section>

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
        {shortcutModalOpen && (
          <WorkbenchShortcutsModal
            settings={settings}
            windowState={windowState}
            onSettingsUpdated={onSettingsUpdated}
            onOpenFullSettings={onOpenFullSettings}
            onClose={() => setShortcutModalOpen(false)}
          />
        )}
        <VirtualCursor active={virtualCursorActive} />
      </>
    );
  }

  // =========================================================================
  // STANDARD SUISI-STYLE WRITTEN FLOATING WINDOW (Default 440x560)
  // =========================================================================
  const showInlineComposer = writtenMode === 'followup' || hasStaged || Boolean(batch?.enabled);

  return (
    <>
      <section
        className={`mc-wf-shell${effectiveHoverInside ? ' is-hover-in' : ''}${shouldCollapseChrome ? ' is-chrome-collapsed' : ''}${windowState?.maximized ? ' is-maximized' : ''}`}
        style={shellStyle}
        aria-label="笔试助手浮窗"
      >
        {/* 1. TOP CHROME (SuiSi style, JS pointer drag, auto-collapses when enabled) */}
        <header className="mc-wf-topbar" data-interactive="true" onPointerDown={handleTopbarPointerDown}>
          <div className="mc-wf-topbar-left">
            <button
              type="button"
              className="mc-icon-btn"
              title="返回主界面（保留本次笔试记录，Esc）"
              aria-label="返回主界面"
              onClick={onRestore}
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="mc-wf-title" title={validSession?.name || '笔试助手'}>
              {validSession?.name || '笔试助手'}
            </span>
            {questions.length > 0 && (
              <div className="mc-wf-pager" data-no-drag="true">
                <button
                  type="button"
                  className="mc-wf-pager-btn"
                  disabled={selectedIdx <= 0}
                  title="上一题"
                  aria-label="上一题"
                  onClick={() => selectedIdx > 0 && onSelectQuestion?.(questions[selectedIdx - 1].id)}
                >
                  <IconChevronLeft size={12} />
                </button>
                <span className="mc-wf-pager-text">{selectedIdx + 1}/{questions.length}</span>
                <button
                  type="button"
                  className="mc-wf-pager-btn"
                  disabled={selectedIdx >= questions.length - 1}
                  title="下一题"
                  aria-label="下一题"
                  onClick={() => selectedIdx < questions.length - 1 && onSelectQuestion?.(questions[selectedIdx + 1].id)}
                >
                  <IconChevronRight size={12} />
                </button>
              </div>
            )}
          </div>

          <div className="mc-wf-tools">
            {/* Hover reveal (small eye icon) */}
            <button
              type="button"
              className={`mc-icon-btn${hoverReveal ? ' is-active' : ''}`}
              title={hoverReveal ? '悬停显隐已开启：鼠标移出自动淡隐并穿透' : '开启悬停显隐：移出淡隐穿透，碰回立刻显现'}
              aria-label="悬停显隐"
              aria-pressed={hoverReveal}
              onClick={() => void onUpdatePrefs?.({ hoverReveal: !hoverReveal })}
            >
              {hoverReveal ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>

            {/* Eye Contact toggle (SuiSi style for camera-on proctored exams) */}
            <EyeContactToggle compact />

            {/* Capture menu (Full / Region / Open folder) */}
            <button
              ref={shotBtnRef}
              type="button"
              className={`mc-icon-btn${shotMenuOpen ? ' is-active' : ''}`}
              title={`截屏识题（全屏 ${formatKeyShort(settings?.ui?.hotkeyShot)} · 框选 ${formatKeyShort(settings?.capture?.hotkeyRegion)}）`}
              aria-label="截屏识题"
              aria-expanded={shotMenuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setShotMenuOpen(v => { const n = !v; if (n) closeOtherPopovers('shot'); return n; });
              }}
            >
              <IconCamera size={14} />
            </button>

            {/* Multi-screenshot batch toggle */}
            <button
              type="button"
              className={`mc-icon-btn mc-wf-batch-btn${batch?.enabled || hasStaged ? ' is-active' : ''}`}
              title={batch?.enabled ? `多图暂存已开启（${stagedImages.length}/12）· 点击关闭` : '开启多图暂存：连续截多张图后统一发题'}
              aria-label="多图暂存开关"
              aria-pressed={Boolean(batch?.enabled)}
              onClick={() => batchController?.toggle?.()}
            >
              <IconLayers size={14} />
              {hasStaged && <span className="mc-wf-badge-dot">{stagedImages.length}</span>}
            </button>

            {/* New blank written round */}
            {questions.length > 0 && (
              <button
                type="button"
                className="mc-icon-btn"
                title="新建空白笔试场次（不清除历史记录）"
                aria-label="新建空白笔试"
                onClick={onNewSession}
              >
                <IconPlus size={14} />
              </button>
            )}

            {/* Toggle Mini Choice Strip */}
            <button
              type="button"
              className="mc-icon-btn"
              title="切换极简选项条（窄窗口大字号只看答案）"
              aria-label="切换极简选项条"
              onClick={() => onToggleMiniMode?.(true)}
            >
              <IconMinimize2 size={14} />
            </button>

            {/* Pin Always-on-top */}
            <button
              type="button"
              className={`mc-icon-btn${alwaysOnTop ? ' is-active' : ''}`}
              title={alwaysOnTop ? '窗口已置顶（点击取消）' : '窗口置顶'}
              aria-label="窗口置顶"
              aria-pressed={alwaysOnTop}
              onClick={() => void onSetAlwaysOnTop?.(!alwaysOnTop)}
            >
              <IconPin size={14} filled={alwaysOnTop} />
            </button>

            {/* Gear settings (reuses exact GearPopover!) */}
            <button
              ref={gearBtnRef}
              type="button"
              className={`mc-icon-btn${gearOpen ? ' is-active' : ''}`}
              title="笔试浮窗与透明度设置"
              aria-label="笔试设置"
              aria-expanded={gearOpen}
              onClick={(e) => {
                e.stopPropagation();
                setGearOpen(v => { const n = !v; if (n) closeOtherPopovers('gear'); return n; });
              }}
            >
              <IconSettings size={14} />
            </button>

            {/* Close / Return Home */}
            <button
              type="button"
              className="mc-icon-btn is-danger"
              title="关闭笔试浮窗并返回主界面"
              aria-label="关闭笔试浮窗"
              onClick={onRestore}
            >
              <IconX size={14} />
            </button>
          </div>
        </header>

        {/* 2. MODE SUBBAR (SuiSi style: 极速识题 vs 对话追问) */}
        <div className="mc-wf-subbar" data-interactive="true">
          <div className="mc-wf-mode-tabs" role="tablist" aria-label="笔试作答模式">
            <button
              type="button"
              role="tab"
              aria-selected={writtenMode === 'fast'}
              className={`mc-wf-mode-tab${writtenMode === 'fast' ? ' is-active' : ''}`}
              title="极速识题：截屏后直接快速出答，支持多视觉模型并行对比与选择题大字号提纯"
              onClick={() => patchWrittenCfg({ mode: 'fast' })}
            >
              <IconZap size={12} /> 极速识题
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={writtenMode === 'followup'}
              className={`mc-wf-mode-tab${writtenMode === 'followup' ? ' is-active' : ''}`}
              title="对话追问：由首选视觉模型承接多轮对话，可继续打字追问、粘贴报错或补充截图"
              onClick={() => patchWrittenCfg({ mode: 'followup' })}
            >
              <IconMessageSquare size={12} /> 对话追问
            </button>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {selectedQuestion && !isStreaming && (
              <button
                type="button"
                className="mc-icon-btn"
                style={{ width: 24, height: 24 }}
                title="重新作答当前题"
                aria-label="重答当前题"
                onClick={() => onRegenerateQuestion?.(selectedQuestion.id)}
              >
                <IconRefresh size={12} />
              </button>
            )}
            {selectedQuestion && attempt?.status === 'done' && (attempt.text || rows.some(r => r.status === 'done')) && (
              <button
                type="button"
                className="mc-icon-btn"
                style={{ width: 24, height: 24 }}
                title="复制当前题完整回答"
                aria-label="复制当前回答"
                onClick={() => {
                  const firstDone = rows.find(r => r.status === 'done');
                  void handleCopyText('header-copy', attempt.text || firstDone?.text || '');
                }}
              >
                {copiedId === 'header-copy' ? <IconCheck size={12} /> : <IconCopy size={12} />}
              </button>
            )}
          </div>
        </div>

        {/* Inline alerts */}
        {(error || localMsg || batch?.message) && (
          <div className="mc-wf-notice-wrap" data-interactive="true">
            {error && <div role="alert" className="mc-alert mc-alert-err" style={{ fontSize: 11.5, padding: '5px 8px' }}>{error}</div>}
            {!error && (localMsg || batch?.message) && (
              <div role="status" className="mc-alert" style={{ fontSize: 11.5, padding: '5px 8px' }}>{localMsg || batch?.message}</div>
            )}
          </div>
        )}

        {/* 3. MAIN CONTENT / READING AREA */}
        <div
          ref={readerRef}
          className="mc-wf-body"
          data-scrollable="true"
          role="region"
          aria-label="笔试题解内容"
        >
          {questions.length === 0 ? (
            <div className="mc-wf-empty" data-interactive="true">
              {!ready ? (
                <>
                  <div className="mc-wf-empty-title">视觉模型尚未配置</div>
                  <div className="mc-wf-empty-desc">
                    配置至少一个 OpenAI 兼容多模态视觉接口后，即可静默截屏识题与多轮追问。
                  </div>
                  {onOpenVisionSettings && (
                    <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={onOpenVisionSettings}>
                      去配置截图视觉模型 →
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="mc-wf-empty-title">
                    {writtenMode === 'followup' ? '开始一个笔试对话' : '等待识题…'}
                  </div>
                  <div className="mc-wf-empty-desc">
                    {writtenMode === 'followup'
                      ? '可先截屏或直接输入题目 / 粘贴代码报错，由首选视觉模型多轮承接。'
                      : `按 ${formatKeyShort(settings?.ui?.hotkeyShot)} 全屏截题或 ${formatKeyShort(settings?.capture?.hotkeyRegion)} 框选题目；长题可先点顶栏多图图标连拍。`}
                  </div>
                  <div className="mc-wf-empty-actions">
                    <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" disabled={batch?.busy} onClick={() => onCapture?.('region')}>
                      <IconScan size={13} /> 框选截题
                    </button>
                    <button type="button" className="mc-btn mc-btn-sm" disabled={batch?.busy} onClick={() => onCapture?.('full')}>
                      <IconCamera size={13} /> 静默全屏
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : writtenMode === 'fast' ? (
            /* FAST RECOGNITION VIEW: focused on selected question, multi-model cross-check & crisp choice badges */
            <div className="mc-wf-fast-view">
              {/* Attached screenshots strip for current question */}
              {attempt?.images?.length > 0 && (
                <div className="mc-wf-q-images" data-interactive="true">
                  {attempt.images.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="mc-wf-q-thumb"
                      title={`点击放大查看第 ${idx + 1} 张题图`}
                      onClick={() => setLightboxImage(url)}
                    >
                      <img src={url} alt={`题图 ${idx + 1}`} />
                      <span>图 {idx + 1}</span>
                    </button>
                  ))}
                  {selectedQuestion?.prompt && !/^截图提问$|^多图截图提问/.test(selectedQuestion.prompt) && (
                    <div className="mc-wf-q-note">{selectedQuestion.prompt}</div>
                  )}
                </div>
              )}

              {/* Choice-only multi-model summary cards OR full answer cards */}
              <div className="mc-wf-model-list">
                {rows.map((result, idx) => {
                  const pureChoice = result.status === 'done' && isPureChoiceAnswer(result.text);
                  const copyKey = `fast-${result.id || idx}`;
                  return (
                    <div key={result.id || idx} className={`mc-wf-answer-card${pureChoice ? ' is-choice' : ''}`}>
                      <div className="mc-wf-answer-head" data-interactive="true">
                        <div className="mc-wf-answer-model">
                          <span className={`mc-dot ${result.status === 'done' ? 'mc-dot-ok' : result.status === 'error' ? 'mc-dot-err' : 'mc-dot-warn'}`} />
                          <strong>{result.name || `模型 ${idx + 1}`}</strong>
                          {result.model && <span className="mc-wf-answer-model-id">{result.model}</span>}
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {result.latencyMs > 0 && (
                            <span className="mc-wf-latency-chip">{formatLatency(result.latencyMs)}</span>
                          )}
                          {result.status === 'done' && (
                            <button
                              type="button"
                              className="mc-icon-btn"
                              style={{ width: 22, height: 22 }}
                              title="复制该模型回答"
                              onClick={() => void handleCopyText(copyKey, pureChoice ? compactWrittenAnswer(result.text) : result.text)}
                            >
                              {copiedId === copyKey ? <IconCheck size={12} /> : <IconCopy size={12} />}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mc-wf-answer-body">
                        {result.status === 'pending' ? (
                          <div className="mc-wf-pending-row">正在思考作答…</div>
                        ) : result.status === 'error' ? (
                          <div className="mc-alert mc-alert-err" style={{ fontSize: 12, padding: '6px 8px' }}>
                            {result.error || '请求失败'}
                          </div>
                        ) : (
                          <WrittenAnswerContent
                            value={result.text}
                            fontSize={pureChoice ? Math.max(20, (workbenchPrefs?.fontSize ?? 14) + 8) : (workbenchPrefs?.fontSize ?? 14)}
                            compact={pureChoice}
                            hideFooterCopy
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 1-click transition from Fast Answer -> Follow-up conversation */}
              {attempt?.status === 'done' && (
                <div className="mc-wf-fast-followup-bar" data-interactive="true">
                  <button type="button" className="mc-btn mc-btn-sm" onClick={handleSwitchToFollowup}>
                    <IconMessageSquare size={12} /> 对本题继续追问（首选视觉模型）→
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* FOLLOW-UP CONVERSATION VIEW: full chronological multi-turn thread */
            <div className="mc-wf-thread">
              {questions.map((q, qi) => {
                const qAtt = getActiveAttempt(q);
                const qRows = writtenAnswerRows(q);
                const qDone = qAtt?.status === 'done';
                const qStreaming = qAtt?.status === 'streaming';
                const qError = qAtt?.status === 'error';
                const isSelected = q.id === selectedQuestion?.id;
                const copyKey = `thread-${q.id}`;
                return (
                  <div
                    key={q.id}
                    className={`mc-wf-turn${isSelected ? ' is-selected' : ''}`}
                    onClick={() => onSelectQuestion?.(q.id)}
                  >
                    <div className="mc-wf-turn-user">
                      <span className="mc-wf-turn-idx">#{qi + 1}</span>
                      <div className="mc-wf-turn-user-content">
                        {qAtt?.images?.length > 0 && (
                          <div className="mc-wf-turn-imgs" data-interactive="true">
                            {qAtt.images.map((url, ii) => (
                              <button key={ii} type="button" className="mc-wf-q-thumb is-sm" onClick={(e) => { e.stopPropagation(); setLightboxImage(url); }}>
                                <img src={url} alt={`附件 ${ii + 1}`} />
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="mc-wf-turn-prompt">{q.prompt}</div>
                      </div>
                    </div>

                    <div className="mc-wf-turn-assistant">
                      {qStreaming ? (
                        <div className="mc-wf-pending-row">{qAtt?.statusText || '首选视觉模型正在思考…'}</div>
                      ) : qError ? (
                        <div className="mc-alert mc-alert-err" style={{ fontSize: 12, padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span>{qAtt?.error || '请求失败'}</span>
                          <button
                            type="button"
                            className="mc-btn mc-btn-sm"
                            data-interactive="true"
                            onClick={(e) => { e.stopPropagation(); onRegenerateQuestion?.(q.id); }}
                          >
                            重试
                          </button>
                        </div>
                      ) : qRows.length > 1 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {qRows.map((r, ri) => {
                            const subCopyKey = `thread-sub-${q.id}-${r.id || ri}`;
                            return (
                              <div key={r.id || ri} className="mc-wf-sub-model">
                                <div className="mc-wf-sub-model-head" data-interactive="true">
                                  <strong>{r.name}{r.model ? ` · ${r.model}` : ''}</strong>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    {r.latencyMs > 0 && <span>{formatLatency(r.latencyMs)}</span>}
                                    {r.status === 'done' && (
                                      <button
                                        type="button"
                                        className="mc-icon-btn"
                                        style={{ width: 20, height: 20 }}
                                        title="复制该模型回答"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleCopyText(subCopyKey, r.text);
                                        }}
                                      >
                                        {copiedId === subCopyKey ? <IconCheck size={11} /> : <IconCopy size={11} />}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {r.status === 'done' ? (
                                  <WrittenAnswerContent value={r.text} fontSize={workbenchPrefs?.fontSize ?? 14} hideFooterCopy />
                                ) : (
                                  <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>{r.error || '未完成'}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mc-wf-single-reply">
                          <div className="mc-wf-single-reply-head" data-interactive="true">
                            <span className="mc-field-hint" style={{ fontSize: 11 }}>
                              {qRows[0]?.model || qRows[0]?.name || primaryEndpoint?.model || '首选视觉模型'}
                              {qRows[0]?.latencyMs > 0 ? ` · ${formatLatency(qRows[0].latencyMs)}` : ''}
                            </span>
                            {qDone && (
                              <button
                                type="button"
                                className="mc-icon-btn"
                                style={{ width: 22, height: 22 }}
                                title="复制回答"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleCopyText(copyKey, qAtt?.text || qRows[0]?.text || '');
                                }}
                              >
                                {copiedId === copyKey ? <IconCheck size={12} /> : <IconCopy size={12} />}
                              </button>
                            )}
                          </div>
                          <WrittenAnswerContent
                            value={qRows[0]?.text || qAtt?.text || ''}
                            fontSize={workbenchPrefs?.fontSize ?? 14}
                            hideFooterCopy
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. INLINE MULTI-SCREENSHOT THUMBNAIL STRIP + FOLLOW-UP COMPOSER (SuiSi 00:30-00:39) */}
        {showInlineComposer && (
          <div className="mc-wf-composer-area" data-interactive="true">
            {(hasStaged || batch?.enabled) && (
              <div className="mc-wf-staged-bar">
                <div className="mc-wf-staged-thumbs">
                  {stagedImages.map((img, idx) => (
                    <div key={`${img.name}-${idx}`} className="mc-wf-staged-item">
                      <img
                        src={img.dataUrl}
                        alt={img.name || `截图 ${idx + 1}`}
                        onClick={() => setLightboxImage(img.dataUrl)}
                      />
                      <button
                        type="button"
                        className="mc-wf-staged-remove"
                        title="移除这张截图"
                        aria-label={`移除第 ${idx + 1} 张截图`}
                        onClick={() => batchController?.remove?.(idx)}
                      >
                        <IconX size={10} />
                      </button>
                    </div>
                  ))}
                  {stagedImages.length < 12 && (
                    <button
                      type="button"
                      className="mc-wf-staged-add"
                      disabled={!ready || batch?.busy}
                      title="再框选添加一张题图"
                      aria-label="框选添加截图"
                      onClick={() => onCapture?.('region')}
                    >
                      <IconPlus size={14} />
                    </button>
                  )}
                </div>
                <div className="mc-wf-staged-meta">
                  <span>{batch?.enabled ? '多图连拍中' : '已附题图'} · {stagedImages.length}/12</span>
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    {hasStaged && (
                      <button type="button" className="mc-btn mc-btn-sm" style={{ height: 22, padding: '0 6px', fontSize: 11 }} onClick={() => batchController?.clear?.()}>
                        清空
                      </button>
                    )}
                    {writtenMode === 'fast' && hasStaged && (
                      <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" style={{ height: 22, padding: '0 8px', fontSize: 11 }} onClick={() => batchController?.sendBatch?.()}>
                        统一发题 ({stagedImages.length})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {writtenMode === 'followup' && (
              <div className="mc-wf-input-box">
                <textarea
                  ref={inputRef}
                  className="mc-wf-textarea"
                  rows={2}
                  value={draftText}
                  placeholder={preventFocus || clickThrough ? '点击安全输入追问，支持 Ctrl+V 贴图…' : '继续追问、贴代码报错，或 Ctrl+V 贴图…'}
                  onMouseDown={() => {
                    if (preventFocus || clickThrough) void window.mc?.requestTempFocus?.(true);
                  }}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => {
                    setInputFocused(false);
                    if (preventFocus || clickThrough) void window.mc?.requestTempFocus?.(false);
                  }}
                  onPaste={handlePaste}
                  onChange={e => setDraftText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSubmitFollowup();
                    }
                  }}
                />
                <div className="mc-wf-input-actions">
                  <button
                    type="button"
                    className="mc-icon-btn"
                    style={{ width: 26, height: 26 }}
                    disabled={!ready || batch?.busy}
                    title="框选附图到本轮追问"
                    aria-label="框选附图"
                    onClick={() => {
                      if (!batch?.enabled) batchController?.toggle?.();
                      onCapture?.('region');
                    }}
                  >
                    <IconImage size={14} />
                  </button>
                  {isStreaming ? (
                    <button
                      type="button"
                      className="mc-wf-send-btn is-stop"
                      title="停止当前生成"
                      aria-label="停止生成"
                      onClick={() => attempt && onCancel?.(attempt.requestId)}
                    >
                      <IconSquare size={11} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mc-wf-send-btn"
                      disabled={!ready || (!draftText.trim() && !hasStaged)}
                      title="发送到首选视觉模型 (Enter)"
                      aria-label="发送追问"
                      onClick={handleSubmitFollowup}
                    >
                      <IconArrowUp size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5. BOTTOM FOOTER BAR (SuiSi style: Latency + Coding Prefs + Vision Model Selector) */}
        <footer className="mc-wf-footer" data-interactive="true">
          <div className="mc-wf-footer-left">
            <span className={`mc-dot ${!ready ? 'mc-dot-warn' : isStreaming ? 'mc-dot-warn' : 'mc-dot-ok'}`} />
            <span className="mc-wf-footer-status" title={footerStatus}>{footerStatus}</span>
            {isStreaming && (
              <button
                type="button"
                className="mc-btn mc-btn-sm"
                style={{ height: 20, padding: '0 6px', fontSize: 10.5 }}
                onClick={() => attempt && onCancel?.(attempt.requestId)}
              >
                停止
              </button>
            )}
          </div>

          <div className="mc-wf-footer-right">
            <button
              ref={codingBtnRef}
              type="button"
              className={`mc-wf-foot-pill${codingPrefs.mode === 'coding' ? ' is-accent' : ''}`}
              title="切换常规 / Coding 编程偏好（语言、ACM/核心代码、精简/全面）"
              aria-label="作答偏好"
              aria-expanded={codingPopoverOpen}
              onClick={(e) => {
                e.stopPropagation();
                setCodingPopoverOpen(v => { const n = !v; if (n) closeOtherPopovers('coding'); return n; });
              }}
            >
              {codingPrefs.mode === 'coding' ? <IconCode size={12} /> : <IconGrid4 size={12} />}
              <span>{formatCodingSummary(codingPrefs)}</span>
            </button>

            <button
              ref={modelBtnRef}
              type="button"
              className="mc-wf-foot-pill"
              title="切换多模型并行或首选视觉模型"
              aria-label="视觉模型选择"
              aria-expanded={modelPopoverOpen}
              onClick={(e) => {
                e.stopPropagation();
                setModelPopoverOpen(v => { const n = !v; if (n) closeOtherPopovers('model'); return n; });
              }}
            >
              <span className="mc-wf-model-pill-text">{modelButtonLabel}</span>
              <IconChevronDown size={11} />
            </button>
          </div>
        </footer>

        {/* Click-Through Floating Unlock Pill */}
        {clickThrough && (
          <div className="mc-clickthrough-pill" data-interactive="true" role="status">
            <IconMousePointer size={12} />
            <span>穿透中 · {clickThroughKeyLabel} 退出</span>
            <button
              type="button"
              className="mc-btn mc-btn-sm"
              style={{ height: 20, padding: '0 7px', fontSize: 10.5 }}
              onClick={() => void onSetClickThrough?.(false)}
            >
              退出穿透
            </button>
          </div>
        )}
      </section>

      {/* POPOVER 1: Capture menu */}
      <AnchoredPopover
        open={shotMenuOpen}
        anchorRef={shotBtnRef}
        placement="bottom"
        align="end"
        offset={6}
        width={210}
        estimatedHeight={170}
        className="mc-dropdown-menu"
        ariaLabel="截屏识题菜单"
        trapFocus
        autoFocus
        onClose={() => setShotMenuOpen(false)}
      >
        <button
          type="button"
          className="mc-dropdown-item"
          disabled={!ready || batch?.busy}
          onClick={() => { setShotMenuOpen(false); onCapture?.('full'); }}
        >
          <IconCamera size={13} />
          <span style={{ flex: 1 }}>静默全屏截题</span>
          <span className="mc-kbd">{formatKeyShort(settings?.ui?.hotkeyShot)}</span>
        </button>
        <button
          type="button"
          className="mc-dropdown-item"
          disabled={!ready || batch?.busy}
          onClick={() => { setShotMenuOpen(false); onCapture?.('region'); }}
        >
          <IconScan size={13} />
          <span style={{ flex: 1 }}>框选区域截题</span>
          <span className="mc-kbd">{formatKeyShort(settings?.capture?.hotkeyRegion)}</span>
        </button>
        <div className="mc-dropdown-sep" />
        <button
          type="button"
          className="mc-dropdown-item"
          onClick={() => { setShotMenuOpen(false); batchController?.toggle?.(); }}
        >
          <IconLayers size={13} />
          <span style={{ flex: 1 }}>{batch?.enabled ? '关闭多图暂存' : '开启多图暂存'}</span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{stagedImages.length}/12</span>
        </button>
        <button type="button" className="mc-dropdown-item" onClick={() => void handleOpenShotDir()}>
          <IconFolder size={13} /> 打开本地截图目录
        </button>
      </AnchoredPopover>

      {/* POPOVER 2: Shared Coding / 作答偏好 */}
      <CodingPrefsPopover
        open={codingPopoverOpen}
        anchorRef={codingBtnRef}
        codingPrefs={codingPrefs}
        onChange={next => void onUpdatePrefs?.({ codingPrefs: next })}
        onClose={() => setCodingPopoverOpen(false)}
        align="end"
      />

      {/* POPOVER 3: Vision Model / Parallel Strategy Selector */}
      <AnchoredPopover
        open={modelPopoverOpen}
        anchorRef={modelBtnRef}
        placement="top"
        align="end"
        offset={8}
        width={264}
        estimatedHeight={240}
        className="mc-dropdown-menu"
        style={{ padding: 8, gap: 4 }}
        ariaLabel="笔试视觉模型策略"
        trapFocus
        autoFocus
        onClose={() => setModelPopoverOpen(false)}
      >
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', padding: '2px 6px' }}>
          {writtenMode === 'followup' ? '追问模式 · 选择首选视觉模型' : '极速识题 · 回答策略'}
        </div>

        {writtenMode === 'fast' && enabledEndpoints.length > 1 && (
          <>
            <button
              type="button"
              className="mc-dropdown-item"
              style={{ justifyContent: 'space-between', background: effectiveSimultaneous ? 'var(--bg-hover)' : undefined }}
              onClick={() => { patchWrittenCfg({ simultaneousMode: 'parallel' }); setModelPopoverOpen(false); }}
            >
              <span>多模型并行交叉验证（{enabledEndpoints.length} 个）</span>
              {effectiveSimultaneous && <IconCheck size={13} />}
            </button>
            <button
              type="button"
              className="mc-dropdown-item"
              style={{ justifyContent: 'space-between', background: !effectiveSimultaneous && !writtenCfg.preferredEndpointId ? 'var(--bg-hover)' : undefined }}
              onClick={() => { patchWrittenCfg({ simultaneousMode: 'single', preferredEndpointId: '' }); setModelPopoverOpen(false); }}
            >
              <span>首选视觉模型（自动回退）</span>
              {!effectiveSimultaneous && !writtenCfg.preferredEndpointId && <IconCheck size={13} />}
            </button>
            <div className="mc-dropdown-sep" />
          </>
        )}

        {enabledEndpoints.length === 0 ? (
          <div className="mc-field-hint" style={{ padding: '6px 8px' }}>尚未配置可用视觉接口</div>
        ) : (
          enabledEndpoints.map((ep, idx) => {
            const isPicked = (writtenMode === 'followup' || !effectiveSimultaneous) && primaryEndpoint?.id === ep.id;
            return (
              <button
                key={ep.id}
                type="button"
                className="mc-dropdown-item"
                style={{ justifyContent: 'space-between', background: isPicked ? 'var(--bg-hover)' : undefined }}
                onClick={() => {
                  patchWrittenCfg({
                    preferredEndpointId: ep.id,
                    ...(writtenMode === 'fast' ? { simultaneousMode: 'single' } : {})
                  });
                  setModelPopoverOpen(false);
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {idx === 0 ? '★ ' : ''}{ep.name || ep.model} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{ep.model}</span>
                </span>
                {isPicked && <IconCheck size={13} />}
              </button>
            );
          })
        )}

        <div className="mc-dropdown-sep" />
        <button
          type="button"
          className="mc-dropdown-item"
          onClick={() => { setModelPopoverOpen(false); onOpenVisionSettings?.(); }}
        >
          <IconSettings size={13} /> 管理视觉模型接口 →
        </button>
      </AnchoredPopover>

      {/* POPOVER 4: Shared GearPopover (exact same 5 window switches + opacity group as Workbench!) */}
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

      {/* Shared Interactive Shortcuts Modal */}
      {shortcutModalOpen && (
        <WorkbenchShortcutsModal
          settings={settings}
          windowState={windowState}
          onSettingsUpdated={onSettingsUpdated}
          onOpenFullSettings={onOpenFullSettings}
          onClose={() => setShortcutModalOpen(false)}
        />
      )}

      {/* Screenshot Lightbox Preview */}
      {lightboxImage && (
        <div className="mc-modal-backdrop" data-interactive="true" onClick={() => setLightboxImage(null)}>
          <div className="mc-wf-lightbox" onClick={e => e.stopPropagation()}>
            <button type="button" className="mc-icon-btn mc-wf-lightbox-close" aria-label="关闭大图预览" onClick={() => setLightboxImage(null)}>
              <IconX size={15} />
            </button>
            <img src={lightboxImage} alt="题图大图预览" />
          </div>
        </div>
      )}

      {/* Security Mode Virtual SVG Cursor */}
      <VirtualCursor active={virtualCursorActive} />
    </>
  );
}
