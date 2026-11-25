import React, { useEffect, useState } from 'react';
import { IconChevronRight, IconRefresh, IconX } from './Icons.jsx';
import { Switch } from './SharedWidgets.jsx';

const STEPPER_DEFAULTS = {
  fontSize: 14,
  bgOpacity: 82,
  iconTextOpacity: 100,
  answerTextOpacity: 100,
  hoverOpacity: 8
};

function StepperRow({ label, value, unit, min, max, step, defaultVal, onChange }) {
  return (
    <div className="mc-gear-row" style={{ flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{label}</span>
      <div className="mc-stepper-group">
        <button
          type="button"
          className="mc-stepper-btn"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          aria-label={`减小${label}`}
        >
          −
        </button>
        <span className="mc-stepper-val">{value}{unit}</span>
        <button
          type="button"
          className="mc-stepper-btn"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          aria-label={`增大${label}`}
        >
          +
        </button>
        <button
          type="button"
          className="mc-stepper-btn"
          disabled={value === defaultVal}
          title={`重置为 ${defaultVal}${unit}`}
          aria-label={`重置${label}`}
          onClick={() => onChange(defaultVal)}
        >
          <IconRefresh size={11} />
        </button>
      </div>
    </div>
  );
}

export function GearPopover({
  anchorRect,
  workbenchPrefs,
  windowState,
  onUpdatePrefs,
  onSetPreventFocus,
  onSetAllowCapture,
  onSetClickThrough,
  onOpenShortcuts,
  onClose
}) {
  const [displays, setDisplays] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    window.mc?.getDisplays?.().then(list => setDisplays(list || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const securityLocked = Boolean(windowState?.securityMode?.enabled);
  const preventFocus = Boolean(windowState?.preventFocus);
  const allowCapture = windowState?.allowCapture !== false;
  const clickThrough = Boolean(windowState?.clickThrough);
  const autoCollapse = Boolean(workbenchPrefs?.autoCollapseChrome);
  const captureDisplayId = workbenchPrefs?.captureDisplayId || '';

  const width = Math.min(220, Math.max(180, window.innerWidth - 16));
  const rawLeft = anchorRect ? anchorRect.right - width : window.innerWidth - width - 12;
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));
  const belowSpace = anchorRect ? window.innerHeight - anchorRect.bottom - 8 : window.innerHeight - 56;
  const top = anchorRect && belowSpace >= 220 ? anchorRect.bottom + 8 : 8;
  const maxHeight = Math.max(160, window.innerHeight - top - 8);

  const safeAction = async (fn) => {
    setError('');
    try { await fn(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div
      className="mc-gear-popover"
      data-interactive="true"
      role="menu"
      aria-label="会中设置"
      style={{ left, top, width, maxHeight }}
      onClick={e => e.stopPropagation()}
    >
      <div className="mc-gear-row" title={securityLocked ? '安全模式已开启，不抢焦点已锁定' : '开启后点击本窗不抢占会议/编辑器焦点（Ctrl+Shift+8）'}>
        <span>不抢焦点</span>
        <Switch
          checked={preventFocus}
          disabled={securityLocked}
          aria-label="不抢焦点"
          onChange={(v) => void safeAction(() => onSetPreventFocus(v))}
        />
      </div>

      <div className="mc-gear-row" title={securityLocked ? '安全模式已开启，已强制防截屏隐藏' : '关闭后在系统截屏与屏幕共享中隐藏本窗口'}>
        <span>允许出现在截图中</span>
        <Switch
          checked={allowCapture}
          disabled={securityLocked}
          aria-label="允许出现在截图中"
          onChange={(v) => void safeAction(() => onSetAllowCapture(v))}
        />
      </div>

      <div className="mc-gear-row" title="鼠标移出窗口后自动收起顶栏和底部输入栏，仅保留阅读区">
        <span>自动收起标题栏</span>
        <Switch
          checked={autoCollapse}
          aria-label="自动收起标题栏"
          onChange={(v) => void onUpdatePrefs({ autoCollapseChrome: v })}
        />
      </div>

      <div className="mc-gear-row" title="点击正文区直接穿透到底层窗口；悬停顶栏按钮与滚动条边缘仍可操作（Ctrl+Shift+9）">
        <span>鼠标穿透</span>
        <Switch
          checked={clickThrough}
          aria-label="鼠标穿透"
          onChange={(v) => void safeAction(() => onSetClickThrough(v))}
        />
      </div>

      <div className="mc-gear-row" style={{ gap: 6 }}>
        <span style={{ flexShrink: 0 }}>截取屏幕</span>
        <select
          className="mc-select"
          aria-label="截取屏幕选择"
          style={{ height: 24, padding: '0 6px', fontSize: 11.5 }}
          value={captureDisplayId}
          onChange={(e) => void onUpdatePrefs({ captureDisplayId: e.target.value })}
        >
          <option value="">默认屏幕</option>
          {displays.map(d => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="mc-gear-row"
        style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left' }}
        onClick={() => { onClose(); onOpenShortcuts(); }}
      >
        <span>快捷键</span>
        <IconChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
      </button>

      <div className="mc-dropdown-sep" />

      <StepperRow
        label="字体大小"
        value={workbenchPrefs?.fontSize ?? STEPPER_DEFAULTS.fontSize}
        unit="px"
        min={10}
        max={24}
        step={1}
        defaultVal={STEPPER_DEFAULTS.fontSize}
        onChange={(v) => void onUpdatePrefs({ fontSize: v })}
      />
      <StepperRow
        label="背景透明度"
        value={workbenchPrefs?.bgOpacity ?? STEPPER_DEFAULTS.bgOpacity}
        unit="%"
        min={0}
        max={100}
        step={5}
        defaultVal={STEPPER_DEFAULTS.bgOpacity}
        onChange={(v) => void onUpdatePrefs({ bgOpacity: v })}
      />
      <StepperRow
        label="图标文本"
        value={workbenchPrefs?.iconTextOpacity ?? STEPPER_DEFAULTS.iconTextOpacity}
        unit="%"
        min={0}
        max={100}
        step={5}
        defaultVal={STEPPER_DEFAULTS.iconTextOpacity}
        onChange={(v) => void onUpdatePrefs({ iconTextOpacity: v })}
      />
      <StepperRow
        label="答案文本"
        value={workbenchPrefs?.answerTextOpacity ?? STEPPER_DEFAULTS.answerTextOpacity}
        unit="%"
        min={0}
        max={100}
        step={5}
        defaultVal={STEPPER_DEFAULTS.answerTextOpacity}
        onChange={(v) => void onUpdatePrefs({ answerTextOpacity: v })}
      />
      <StepperRow
        label="悬停透明度"
        value={workbenchPrefs?.hoverOpacity ?? STEPPER_DEFAULTS.hoverOpacity}
        unit="%"
        min={0}
        max={50}
        step={5}
        defaultVal={STEPPER_DEFAULTS.hoverOpacity}
        onChange={(v) => void onUpdatePrefs({ hoverOpacity: v })}
      />

      {securityLocked && (
        <div className="mc-field-hint" style={{ padding: '4px 6px', fontSize: 11 }}>
          安全模式运行中，部分开关已锁定。
        </div>
      )}
      {error && (
        <div className="mc-alert mc-alert-err" style={{ marginTop: 4, padding: '6px 8px', fontSize: 11 }}>{error}</div>
      )}
    </div>
  );
}

export function ShortcutCheatSheetModal({ settings, windowState, onOpenFullSettings, onClose }) {
  const rows = [
    ['隐藏 / 呼出窗口', settings?.ui?.hotkeyToggle || 'Control+B'],
    ['全屏截图识题', settings?.ui?.hotkeyShot || 'Control+Shift+S'],
    ['框选区域识题', settings?.capture?.hotkeyRegion || 'Control+Shift+A'],
    ['不抢焦点开关', windowState?.hotkeys?.togglePreventFocus || 'Control+Shift+8'],
    ['鼠标穿透开关', windowState?.hotkeys?.toggleClickThrough || 'Control+Shift+9']
  ];
  return (
    <div className="mc-modal-backdrop" onClick={onClose} data-interactive="true">
      <div className="mc-modal mc-modal-sm" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="快捷键一览">
        <div className="mc-modal-header">
          <h3 className="mc-modal-title">快捷键一览</h3>
          <button type="button" className="mc-icon-btn" onClick={onClose}><IconX size={14} /></button>
        </div>
        <div className="mc-modal-body" style={{ gap: 8 }}>
          {rows.map(([label, key]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12.5 }}>{label}</span>
              <span className="mc-kbd">{key.replace(/Control/g, 'Ctrl')}</span>
            </div>
          ))}
        </div>
        <div className="mc-modal-footer">
          <button type="button" className="mc-btn mc-btn-sm" onClick={() => { onClose(); onOpenFullSettings(); }}>前往设置修改</button>
          <button type="button" className="mc-btn mc-btn-sm mc-btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
