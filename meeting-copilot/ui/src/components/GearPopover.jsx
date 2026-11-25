import React, { useEffect, useState } from 'react';
import { AnchoredPopover } from './AnchoredPopover.jsx';
import { CustomSelect } from './CustomSelect.jsx';
import { IconChevronRight, IconRefresh } from './Icons.jsx';
import { Switch } from './SharedWidgets.jsx';
export { WorkbenchShortcutsModal } from './WorkbenchShortcutsModal.jsx';

const STEPPER_DEFAULTS = {
  fontSize: 14,
  bgOpacity: 82,
  iconTextOpacity: 100,
  answerTextOpacity: 100,
  hoverOpacity: 8
};

function StepperRow({ label, ariaName, value, unit, min, max, step, defaultVal, onChange }) {
  const fullName = ariaName || label;
  return (
    <div className="mc-gear-row mc-gear-stepper-row">
      <span className="mc-gear-stepper-label">{label}</span>
      <div className="mc-stepper-wrap">
        <div className="mc-stepper-pill">
          <button
            type="button"
            className="mc-stepper-seg"
            disabled={value <= min}
            onClick={() => onChange(Math.max(min, value - step))}
            aria-label={`减小${fullName}`}
          >
            −
          </button>
          <span className="mc-stepper-val">{value}{unit}</span>
          <button
            type="button"
            className="mc-stepper-seg"
            disabled={value >= max}
            onClick={() => onChange(Math.min(max, value + step))}
            aria-label={`增大${fullName}`}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="mc-stepper-reset"
          disabled={value === defaultVal}
          title={`重置${fullName}为 ${defaultVal}${unit}`}
          aria-label={`重置${fullName}`}
          onClick={() => onChange(defaultVal)}
        >
          <IconRefresh size={12} />
        </button>
      </div>
    </div>
  );
}

export function GearPopover({
  open,
  anchorRef,
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
    if (!open) return;
    setError('');
    window.mc?.getDisplays?.().then(list => setDisplays(list || [])).catch(() => {});
  }, [open]);

  const securityLocked = Boolean(windowState?.securityMode?.enabled);
  const preventFocus = Boolean(windowState?.preventFocus);
  const allowCapture = windowState?.allowCapture !== false;
  const clickThrough = Boolean(windowState?.clickThrough);
  const autoCollapse = Boolean(workbenchPrefs?.autoCollapseChrome);
  const captureDisplayId = workbenchPrefs?.captureDisplayId || '';

  const safeAction = async (fn) => {
    setError('');
    try { await fn(); }
    catch (e) { setError(e.message); }
  };

  const displayOptions = [
    { value: '', label: '默认屏幕' },
    ...displays.map(d => ({ value: d.id, label: d.label }))
  ];

  return (
    <AnchoredPopover
      open={open}
      anchorRef={anchorRef}
      placement="bottom"
      align="end"
      offset={8}
      width={232}
      estimatedHeight={410}
      zIndex={9999}
      className="mc-gear-popover"
      role="dialog"
      ariaLabel="会中设置"
      trapFocus
      autoFocus
      onClose={onClose}
    >
      <div className="mc-gear-row" title={securityLocked ? '安全模式已开启，不抢焦点已锁定' : '开启后点击本窗不抢占会议或编辑器焦点（Ctrl+Shift+8）'}>
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

      <div className="mc-gear-row" title="鼠标移出窗口后自动收起顶栏和底部工具栏，仅保留阅读区">
        <span>自动收起标题栏</span>
        <Switch
          checked={autoCollapse}
          aria-label="自动收起标题栏"
          onChange={(v) => void onUpdatePrefs({ autoCollapseChrome: v })}
        />
      </div>

      <div className="mc-gear-row" title="开启后正文区直接穿透到底层窗口；悬停顶栏按钮、滚动条边缘或退出条仍可点击（Ctrl+Shift+9）">
        <span>鼠标穿透</span>
        <Switch
          checked={clickThrough}
          aria-label="鼠标穿透"
          onChange={(v) => void safeAction(async () => {
            await onSetClickThrough(v);
            if (v) onClose();
          })}
        />
      </div>

      <div className="mc-gear-row" style={{ gap: 6 }}>
        <span style={{ flexShrink: 0 }}>截取屏幕</span>
        <CustomSelect
          className="mc-filter-select"
          ariaLabel="截取屏幕选择"
          style={{ height: 26, fontSize: 11.5, flex: 1, minWidth: 0 }}
          align="end"
          zIndex={10050}
          value={captureDisplayId}
          options={displayOptions}
          onChange={(val) => void onUpdatePrefs({ captureDisplayId: val })}
        />
      </div>

      <div className="mc-dropdown-sep" />

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

      {/* Unified Opacity Section (fixes M19: clear meaning + zero awkward wrapping in compact window) */}
      <div className="mc-gear-section-label">透明度</div>
      <StepperRow
        label="背景"
        ariaName="背景透明度"
        value={workbenchPrefs?.bgOpacity ?? STEPPER_DEFAULTS.bgOpacity}
        unit="%"
        min={0}
        max={100}
        step={5}
        defaultVal={STEPPER_DEFAULTS.bgOpacity}
        onChange={(v) => void onUpdatePrefs({ bgOpacity: v })}
      />
      <StepperRow
        label="图标与文字"
        ariaName="图标与文字透明度"
        value={workbenchPrefs?.iconTextOpacity ?? STEPPER_DEFAULTS.iconTextOpacity}
        unit="%"
        min={0}
        max={100}
        step={5}
        defaultVal={STEPPER_DEFAULTS.iconTextOpacity}
        onChange={(v) => void onUpdatePrefs({ iconTextOpacity: v })}
      />
      <StepperRow
        label="答案"
        ariaName="答案透明度"
        value={workbenchPrefs?.answerTextOpacity ?? STEPPER_DEFAULTS.answerTextOpacity}
        unit="%"
        min={0}
        max={100}
        step={5}
        defaultVal={STEPPER_DEFAULTS.answerTextOpacity}
        onChange={(v) => void onUpdatePrefs({ answerTextOpacity: v })}
      />
      <StepperRow
        label="移出窗口后"
        ariaName="移出窗口后透明度"
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
    </AnchoredPopover>
  );
}
