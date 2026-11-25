import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconCheck, IconEdit, IconKeyboard, IconSearch, IconTrash, IconX } from './Icons.jsx';
import { Switch, acceleratorFromKeyboardEvent } from './SharedWidgets.jsx';

const GROUPS = [
  {
    id: 'nav',
    title: '导航与阅读',
    items: [
      { id: 'questionPrev', scope: 'wb', label: '上一题', desc: '切换到上一个提问记录', allowMouse: true },
      { id: 'questionNext', scope: 'wb', label: '下一题', desc: '切换到下一个提问记录', allowMouse: true },
      { id: 'scrollUp', scope: 'wb', label: '向上滚动内容', desc: '回答阅读区向上平滑滚动', allowMouse: true },
      { id: 'scrollDown', scope: 'wb', label: '向下滚动内容', desc: '回答阅读区向下平滑滚动', allowMouse: true }
    ]
  },
  {
    id: 'session',
    title: '语音、截图与资料库',
    items: [
      { id: 'toggleAudioCapture', scope: 'wb', label: '开关音频采集', desc: '开始或暂停实时语音识别', allowMouse: true },
      { id: 'manualSend', scope: 'wb', label: '手动发送累计转写', desc: '在手动模式下提交已累计的对方发言', allowMouse: true },
      { id: 'clearTranscript', scope: 'wb', label: '清空转写记录', desc: '清除当前转写片段与累计草稿', allowMouse: true },
      { id: 'toggleKnowledge', scope: 'wb', label: '开关资料库检索', desc: '仅针对本场面试启用或关闭本地资料库 V2', allowMouse: true },
      { id: 'hotkeyShot', scope: 'global', label: '静默全屏截图识题', desc: '支持组合键、F1–F24 或鼠标侧键 Mouse4 / Mouse5', allowMouse: true },
      { id: 'hotkeyRegion', scope: 'global', label: '框选区域截图识题', desc: '拖动选取屏幕区域识题，支持鼠标侧键', allowMouse: true },
      { id: 'toggleBatch', scope: 'win', label: '多图暂存开关', desc: '笔试场景下开启或关闭批量截图暂存', allowMouse: false },
      { id: 'sendBatch', scope: 'win', label: '发送暂存多图', desc: '提交全部已暂存的截图', allowMouse: false }
    ]
  },
  {
    id: 'window',
    title: '窗口与防干扰',
    items: [
      { id: 'hotkeyToggle', scope: 'global', label: '隐藏 / 显示主窗口', desc: '全局一键隐藏或呼出窗口', allowMouse: false },
      { id: 'toggleAlwaysOnTop', scope: 'wb', label: '切换窗口置顶', desc: '将工作台置顶于会议与编辑器之上', allowMouse: true },
      { id: 'togglePreventFocus', scope: 'wb', label: '开关不抢焦点', desc: '开启后点击本窗不抢占其他软件焦点', allowMouse: true },
      { id: 'toggleClickThrough', scope: 'wb', label: '开关鼠标穿透', desc: '正文区直接穿透底层窗口，悬停控件仍可操作', allowMouse: true },
      { id: 'toggleHoverReveal', scope: 'wb', label: '开关悬停显隐', desc: '鼠标移出窗口时淡化隐藏并穿透，移入恢复', allowMouse: true },
      { id: 'toggleHotkeys', scope: 'wb', label: '总开关工作台快捷键', desc: '禁用后仅保留安全解锁与本快捷键', allowMouse: true },
      { id: 'closeWithoutSave', scope: 'wb', label: '不保存直接关闭', desc: '丢弃当前会话并立即返回首页', allowMouse: true }
    ]
  },
  {
    id: 'move',
    title: '窗口移动与缩放',
    items: [
      { id: 'up', scope: 'win', label: '窗口上移', desc: '按设定步长向上微调窗口位置', allowMouse: false },
      { id: 'down', scope: 'win', label: '窗口下移', desc: '按设定步长向下微调窗口位置', allowMouse: false },
      { id: 'left', scope: 'win', label: '窗口左移', desc: '按设定步长向左微调窗口位置', allowMouse: false },
      { id: 'right', scope: 'win', label: '窗口右移', desc: '按设定步长向右微调窗口位置', allowMouse: false },
      { id: 'grow', scope: 'win', label: '放大窗口', desc: '等比放大浮窗尺寸与内容缩放', allowMouse: false },
      { id: 'shrink', scope: 'win', label: '缩小窗口', desc: '等比缩小浮窗尺寸与内容缩放', allowMouse: false }
    ]
  }
];

function formatKeyBadge(acc) {
  if (!acc) return '未设置';
  return String(acc)
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function normalizeSearch(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

export function WorkbenchShortcutsModal({
  settings,
  windowState,
  onSettingsUpdated,
  onOpenFullSettings,
  onClose
}) {
  const [query, setQuery] = useState('');
  const [searchByKey, setSearchByKey] = useState(false);
  const [editingItem, setEditingItem] = useState(null); // { id, scope, label, allowMouse }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flashSaved, setFlashSaved] = useState('');
  const [windowControls, setWindowControls] = useState(null);
  const recordTokenRef = useRef(null);
  const searchInputRef = useRef(null);

  const enabled = windowState?.workbenchHotkeysEnabled !== false;
  const wbBindings = windowState?.workbenchHotkeys || {};
  const preventFocus = Boolean(windowState?.preventFocus);
  const editingKey = editingItem ? `${editingItem.scope}:${editingItem.id}` : '';
  const editingItemRef = useRef(editingItem);
  editingItemRef.current = editingItem;
  const preventFocusRef = useRef(preventFocus);
  preventFocusRef.current = preventFocus;

  useEffect(() => {
    window.mc?.getWindowControls?.().then(setWindowControls).catch(() => {});
  }, []);

  const readValue = useCallback((item) => {
    if (item.scope === 'wb') return wbBindings[item.id] || '';
    if (item.scope === 'global') {
      if (item.id === 'hotkeyToggle') return settings?.ui?.hotkeyToggle || '';
      if (item.id === 'hotkeyShot') return settings?.ui?.hotkeyShot || '';
      if (item.id === 'hotkeyRegion') return settings?.capture?.hotkeyRegion || '';
      return '';
    }
    if (item.scope === 'win') return windowControls?.bindings?.[item.id] || '';
    return '';
  }, [wbBindings, settings, windowControls]);

  const allItems = useMemo(() => GROUPS.flatMap(g => g.items), []);

  const stopNativeRecording = useCallback(() => {
    const tok = recordTokenRef.current;
    recordTokenRef.current = null;
    if (tok) void window.mc?.endShortcutRecording?.(tok).catch(() => {});
  }, []);

  const cancelCapture = useCallback(() => {
    stopNativeRecording();
    setEditingItem(null);
    setSearchByKey(false);
  }, [stopNativeRecording]);

  const commitBinding = useCallback(async (item, acc) => {
    const clean = String(acc || '').trim();
    if (clean) {
      if (/^Mouse[45]$/.test(clean) && !item.allowMouse) {
        setError(`「${item.label}」暂不支持绑定鼠标侧键，请按键盘组合键`);
        return;
      }
      const conflict = allItems.find(other =>
        !(other.id === item.id && other.scope === item.scope) &&
        readValue(other).toLowerCase() === clean.toLowerCase()
      );
      if (conflict) {
        setError(`按键 ${formatKeyBadge(clean)} 已被「${conflict.label}」占用`);
        return;
      }
    }

    stopNativeRecording();
    setBusy(true);
    setError('');
    try {
      if (item.scope === 'wb') {
        await window.mc.setWorkbenchHotkeys({ bindings: { [item.id]: clean } });
      } else if (item.scope === 'global') {
        let patch;
        if (item.id === 'hotkeyToggle') patch = { ui: { hotkeyToggle: clean } };
        else if (item.id === 'hotkeyShot') patch = { ui: { hotkeyShot: clean } };
        else patch = { capture: { hotkeyRegion: clean } };
        const updated = await window.mc.setSettings(patch);
        onSettingsUpdated?.(updated);
      } else if (item.scope === 'win') {
        const updated = await window.mc.setWindowControls({
          bindings: { ...(windowControls?.bindings || {}), [item.id]: clean }
        });
        setWindowControls(updated);
      }
      setEditingItem(null);
      setFlashSaved(clean ? `已设置「${item.label}」为 ${formatKeyBadge(clean)}` : `已清除「${item.label}」`);
      setTimeout(() => setFlashSaved(''), 2200);
    } catch (err) {
      setError(err.message || '快捷键保存失败');
    } finally {
      setBusy(false);
    }
  }, [allItems, onSettingsUpdated, readValue, stopNativeRecording, windowControls]);

  const commitBindingRef = useRef(commitBinding);
  commitBindingRef.current = commitBinding;
  const cancelCaptureRef = useRef(cancelCapture);
  cancelCaptureRef.current = cancelCapture;
  const stopNativeRecordingRef = useRef(stopNativeRecording);
  stopNativeRecordingRef.current = stopNativeRecording;

  // Start native side-button + suspended-global-hotkey recording session whenever recording/searching by key.
  // Keyed ONLY on primitive [editingKey, searchByKey] so windowState updates (e.g. tempFocus) never tear down/re-arm recording!
  useEffect(() => {
    if (!editingKey && !searchByKey) {
      stopNativeRecordingRef.current();
      return;
    }
    const token = crypto.randomUUID();
    recordTokenRef.current = token;
    const requestedTemp = preventFocusRef.current;
    if (requestedTemp) void window.mc?.requestTempFocus?.(true);

    // Begin native recording (suspends global shortcuts & starts QuietCapture --mouse-watch Mouse4,Mouse5)
    void window.mc?.beginShortcutRecording?.(token).catch(() => {
      // Fallback gracefully if mouse helper unavailable; keyboard capture still works
    });

    const offRecorded = window.mc?.onShortcutRecorded?.((ev) => {
      if (ev.token !== recordTokenRef.current) return;
      if (ev.ended) return;
      if (ev.accelerator) {
        if (searchByKey) {
          setQuery(formatKeyBadge(ev.accelerator));
          cancelCaptureRef.current();
        } else if (editingItemRef.current) {
          void commitBindingRef.current(editingItemRef.current, ev.accelerator);
        }
      }
    });

    const onKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        cancelCaptureRef.current();
        return;
      }
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && ['Delete', 'Backspace'].includes(e.key) && editingItemRef.current) {
        void commitBindingRef.current(editingItemRef.current, '');
        return;
      }
      const acc = acceleratorFromKeyboardEvent(e);
      if (!acc) return;
      if (searchByKey) {
        setQuery(formatKeyBadge(acc));
        cancelCaptureRef.current();
      } else if (editingItemRef.current) {
        void commitBindingRef.current(editingItemRef.current, acc);
      }
    };

    const onMouseDown = (e) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        const acc = e.button === 3 ? 'Mouse4' : 'Mouse5';
        if (searchByKey) {
          setQuery(acc);
          cancelCaptureRef.current();
        } else if (editingItemRef.current) {
          void commitBindingRef.current(editingItemRef.current, acc);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      offRecorded?.();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      stopNativeRecordingRef.current();
      if (requestedTemp || preventFocusRef.current) void window.mc?.requestTempFocus?.(false);
    };
  }, [editingKey, searchByKey]);

  useEffect(() => {
    if (editingItem || searchByKey) return;
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [editingItem, searchByKey, onClose]);

  const normQ = normalizeSearch(query);
  const filteredGroups = useMemo(() => {
    return GROUPS.map(g => ({
      ...g,
      items: g.items.filter(it => {
        if (!normQ) return true;
        const val = readValue(it);
        const haystack = normalizeSearch(`${g.title} ${it.label} ${it.desc} ${val} ${formatKeyBadge(val)}`);
        return haystack.includes(normQ);
      })
    })).filter(g => g.items.length > 0);
  }, [normQ, readValue]);

  const toggleEnabled = async (next) => {
    setBusy(true);
    setError('');
    try {
      await window.mc.setWorkbenchHotkeys({ enabled: next });
    } catch (err) {
      setError(err.message || '更新失败');
    } finally {
      setBusy(false);
    }
  };

  const resetAll = async () => {
    cancelCapture();
    setBusy(true);
    setError('');
    try {
      await window.mc.resetWorkbenchHotkeys();
      setFlashSaved('已恢复全部工作台快捷键默认值');
      setTimeout(() => setFlashSaved(''), 2200);
    } catch (err) {
      setError(err.message || '重置失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mc-modal-backdrop" onClick={() => { cancelCapture(); onClose(); }} data-interactive="true">
      <div
        className="mc-modal mc-modal-lg mc-modal-anim"
        style={{ maxWidth: 640, maxHeight: 'calc(100vh - 36px)' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="键盘快捷键"
      >
        <div className="mc-modal-header" style={{ padding: '12px 16px' }}>
          <div>
            <h3 className="mc-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconKeyboard size={16} /> 键盘快捷键
            </h3>
            <div className="mc-field-hint">点击任意按键开始录制 → 按下组合键、F1–F24 或鼠标侧键（Mouse4 / Mouse5）即自动保存，Esc 取消。</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="mc-btn mc-btn-sm"
              disabled={busy || !!editingItem}
              onClick={() => void resetAll()}
            >
              全部重置为默认值
            </button>
            <button type="button" className="mc-icon-btn" onClick={() => { cancelCapture(); onClose(); }} aria-label="关闭">
              <IconX size={15} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div style={{ padding: '10px 16px 8px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 34, borderRadius: 99, border: '1px solid var(--border)', background: 'var(--bg-base)' }}>
            <IconSearch size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            {searchByKey ? (
              <span style={{ flex: 1, fontSize: 12, color: 'var(--info)', fontWeight: 500 }}>
                请按下组合键或鼠标侧键进行检索（Esc 取消）…
              </span>
            ) : (
              <input
                ref={searchInputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onMouseDown={() => { if (preventFocus) void window.mc?.requestTempFocus?.(true); }}
                onBlur={() => { if (preventFocus && !editingItem && !searchByKey) void window.mc?.requestTempFocus?.(false); }}
                placeholder="搜索快捷键名称、描述或按键…"
                aria-label="搜索快捷键"
                style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: 12.5 }}
              />
            )}
            {query && !searchByKey && (
              <button type="button" className="mc-icon-btn" style={{ width: 22, height: 22 }} onClick={() => setQuery('')} title="清空搜索">
                <IconX size={12} />
              </button>
            )}
            <button
              type="button"
              className={`mc-icon-btn${searchByKey ? ' is-active' : ''}`}
              style={{ width: 24, height: 24 }}
              title="按按键搜索"
              aria-pressed={searchByKey}
              onClick={() => {
                setError('');
                if (searchByKey) cancelCapture();
                else { setEditingItem(null); setSearchByKey(true); }
              }}
            >
              <IconKeyboard size={13} />
            </button>
          </div>
        </div>

        <div className="mc-modal-body" data-scrollable="true" style={{ padding: '12px 16px', gap: 14 }}>
          {/* Global workbench hotkeys toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>启用工作台快捷键</div>
              <div className="mc-field-hint">关闭后暂停工作台内快捷操作，仍保留「不抢焦点」「鼠标穿透」安全解锁键。</div>
            </div>
            <Switch checked={enabled} disabled={busy} onChange={(v) => void toggleEnabled(v)} aria-label="启用工作台快捷键" />
          </div>

          {flashSaved && (
            <div className="mc-alert mc-alert-ok" role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', fontSize: 12 }}>
              <IconCheck size={13} /> {flashSaved}
            </div>
          )}
          {error && <div className="mc-alert mc-alert-err" role="alert" style={{ padding: '7px 10px', fontSize: 12 }}>{error}</div>}
          {windowState?.hotkeyErrors?.length > 0 && (
            <div className="mc-alert mc-alert-warn" style={{ padding: '7px 10px', fontSize: 12 }}>{windowState.hotkeyErrors.join('；')}</div>
          )}

          {filteredGroups.length === 0 && (
            <div className="mc-field-hint" style={{ textAlign: 'center', padding: '24px 0' }}>
              没有匹配的快捷键。
            </div>
          )}

          {filteredGroups.map(group => (
            <section key={group.id}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                {group.title}
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-surface)' }}>
                {group.items.map((item, idx) => {
                  const val = readValue(item);
                  const isEditing = editingItem?.id === item.id && editingItem?.scope === item.scope;
                  const dimmed = item.scope === 'wb' && !enabled && !['togglePreventFocus', 'toggleClickThrough', 'toggleHotkeys'].includes(item.id);
                  return (
                    <div
                      key={`${item.scope}:${item.id}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto 28px',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 12px',
                        borderTop: idx === 0 ? 0 : '1px solid var(--border)',
                        opacity: dimmed ? 0.55 : 1
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{item.label}</div>
                        <div className="mc-field-hint" style={{ fontSize: 11 }}>{item.desc}</div>
                      </div>

                      {isEditing ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="mc-badge mc-badge-info">
                            {item.allowMouse ? '请按组合键 / 侧键…' : '请按组合键…'} (Esc 取消)
                          </span>
                          <button type="button" className="mc-btn mc-btn-sm" onClick={cancelCapture}>取消</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mc-btn mc-btn-sm mc-btn-ghost"
                          disabled={busy}
                          style={{ height: 26, padding: '0 8px', gap: 6 }}
                          title="点击录制新快捷键"
                          aria-label={`录制${item.label}快捷键（当前：${val ? formatKeyBadge(val) : '未设置'}）`}
                          onClick={() => { setError(''); setSearchByKey(false); setEditingItem(item); }}
                        >
                          <span className="mc-kbd" style={{ opacity: val ? 1 : 0.6 }}>{formatKeyBadge(val)}</span>
                          <IconEdit size={12} style={{ color: 'var(--text-faint)' }} />
                        </button>
                      )}

                      <div>
                        {val && !isEditing && (
                          <button
                            type="button"
                            className="mc-icon-btn"
                            style={{ width: 24, height: 24 }}
                            disabled={busy}
                            title="清除此快捷键"
                            aria-label={`清除${item.label}`}
                            onClick={() => void commitBinding(item, '')}
                          >
                            <IconTrash size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
            <button
              type="button"
              className="mc-btn mc-btn-sm mc-btn-ghost"
              onClick={() => { cancelCapture(); onClose(); onOpenFullSettings(); }}
            >
              前往完整「高级设置 → 快捷键与窗口」→
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
