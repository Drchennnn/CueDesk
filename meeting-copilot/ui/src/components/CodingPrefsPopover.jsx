import React from 'react';
import {
  CODING_EXPLAIN_MODES,
  CODING_FORMATS,
  CODING_LANGUAGES,
  normalizeCodingPrefs
} from '../core/codingPrefs.js';
import { AnchoredPopover } from './AnchoredPopover.jsx';
import { CustomSelect } from './CustomSelect.jsx';
import { IconCode } from './Icons.jsx';
import { Switch } from './SharedWidgets.jsx';

/**
 * Shared Coding / 作答偏好浮窗 — reused verbatim by both Interview Workbench and Written Floating Window.
 */
export function CodingPrefsPopover({
  open,
  anchorRef,
  codingPrefs,
  onChange,
  onClose,
  placement = 'top',
  align = 'start',
  zIndex = 9999
}) {
  const prefs = normalizeCodingPrefs(codingPrefs);
  const patch = (delta) => onChange?.({ ...prefs, ...delta });

  return (
    <AnchoredPopover
      open={open}
      anchorRef={anchorRef}
      placement={placement}
      align={align}
      offset={8}
      width={268}
      estimatedHeight={prefs.mode === 'coding' ? 280 : 72}
      zIndex={zIndex}
      className="mc-dropdown-menu"
      style={{ padding: 10, gap: 9 }}
      ariaLabel="作答偏好设置"
      trapFocus
      autoFocus
      onClose={onClose}
    >
      <div className="mc-pref-row">
        <span className="mc-pref-label">题型</span>
        <div className="mc-segmented">
          <button
            type="button"
            className={`mc-seg-btn${prefs.mode === 'normal' ? ' is-active' : ''}`}
            onClick={() => patch({ mode: 'normal' })}
          >
            常规
          </button>
          <button
            type="button"
            className={`mc-seg-btn${prefs.mode === 'coding' ? ' is-active' : ''}`}
            onClick={() => patch({ mode: 'coding' })}
          >
            <IconCode size={11} /> Coding
          </button>
        </div>
      </div>

      {prefs.mode === 'coding' && (
        <>
          <div className="mc-pref-row">
            <span className="mc-pref-label">编程语言</span>
            <CustomSelect
              className="mc-filter-select"
              style={{ width: 132, height: 26, fontSize: 12 }}
              ariaLabel="编程语言"
              value={prefs.language}
              onChange={val => patch({ language: val })}
              options={CODING_LANGUAGES.map(l => ({ value: l.id, label: l.label }))}
            />
          </div>

          <div className="mc-pref-row">
            <span className="mc-pref-label">代码格式</span>
            <div className="mc-segmented">
              {CODING_FORMATS.map(fmt => (
                <button
                  key={fmt.id}
                  type="button"
                  className={`mc-seg-btn${prefs.codeFormat === fmt.id ? ' is-active' : ''}`}
                  onClick={() => patch({ codeFormat: fmt.id })}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mc-pref-row">
            <span className="mc-pref-label">结论格式</span>
            <div className="mc-segmented">
              {CODING_EXPLAIN_MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className={`mc-seg-btn${prefs.explainMode === m.id ? ' is-active' : ''}`}
                  onClick={() => patch({ explainMode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mc-dropdown-sep" style={{ margin: '1px 0' }} />

          <div className="mc-pref-row">
            <span className="mc-pref-label">附带时间 / 空间复杂度</span>
            <Switch
              checked={prefs.includeComplexity}
              aria-label="附带时间与空间复杂度"
              onChange={v => patch({ includeComplexity: v })}
            />
          </div>
          <div className="mc-pref-row">
            <span className="mc-pref-label">提示边界条件</span>
            <Switch
              checked={prefs.includeEdgeCases}
              aria-label="提示边界条件"
              onChange={v => patch({ includeEdgeCases: v })}
            />
          </div>
        </>
      )}
    </AnchoredPopover>
  );
}
