import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IconCheck, IconChevronDown } from './Icons.jsx';

/**
 * Lightweight document.body overlay renderer backed by react-dom/client createRoot
 * (compatible with the docsLinks-DacHPHnf.js React runtime bridge without react-dom.createPortal).
 * Prevents clipping inside transformed or overflow:hidden ancestors such as cards, modals, and GearPopover.
 */
function BodyOverlay({ children }) {
  const hostRef = useRef(null);
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const host = document.createElement('div');
    host.dataset.mcOverlayHost = '1';
    document.body.appendChild(host);
    const root = createRoot(host);
    hostRef.current = host;
    rootRef.current = root;
    root.render(children);
    return () => {
      const r = rootRef.current;
      const h = hostRef.current;
      rootRef.current = null;
      hostRef.current = null;
      queueMicrotask(() => {
        try { r?.unmount(); } catch {}
        try { h?.remove(); } catch {}
      });
    };
  }, []);

  useLayoutEffect(() => {
    rootRef.current?.render(children);
  });

  return null;
}

/**
 * Unified custom dropdown select replacing native Chromium <select> popups (M20).
 * - Rounded card menu with subtle border, soft shadow, and visible gap from trigger
 * - Left-aligned with trigger; viewport-clamped and flips upward when near bottom edge
 * - Selected value marked by right-aligned checkmark (no harsh full-width blue fill)
 * - Hovered/keyboard-focused item highlighted with subtle theme hover tint
 * - Full keyboard navigation: ArrowUp/Down, Home/End, Enter/Space, Escape (cancels cleanly)
 */
export function CustomSelect({
  value,
  options = [],
  onChange,
  disabled = false,
  placeholder = '请选择',
  ariaLabel,
  id,
  className = 'mc-select',
  style,
  menuMinWidth,
  menuMaxWidth = 340,
  align = 'start',
  zIndex = 10020
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const normalizedOptions = useMemo(
    () => (options || []).map((opt) => (
      typeof opt === 'string'
        ? { value: opt, label: opt, disabled: false }
        : { value: String(opt?.value ?? ''), label: String(opt?.label ?? opt?.value ?? ''), disabled: Boolean(opt?.disabled) }
    )),
    [options]
  );

  const selectedValue = String(value ?? '');
  const selectedIndex = useMemo(
    () => normalizedOptions.findIndex(o => o.value === selectedValue),
    [normalizedOptions, selectedValue]
  );
  const selectedOption = selectedIndex >= 0 ? normalizedOptions[selectedIndex] : null;

  const findNextEnabled = useCallback((startIdx, delta) => {
    const len = normalizedOptions.length;
    if (!len) return -1;
    let idx = startIdx;
    for (let step = 0; step < len; step++) {
      idx = (idx + delta + len) % len;
      if (!normalizedOptions[idx].disabled) return idx;
    }
    return -1;
  }, [normalizedOptions]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    setVisible(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus?.());
    }
  }, []);

  const openMenu = useCallback((initialIdx) => {
    if (disabled || !normalizedOptions.length) return;
    const targetIdx = typeof initialIdx === 'number' && initialIdx >= 0
      ? initialIdx
      : (selectedIndex >= 0 && !normalizedOptions[selectedIndex]?.disabled
        ? selectedIndex
        : findNextEnabled(-1, 1));
    setHighlightedIndex(targetIdx);
    setOpen(true);
    requestAnimationFrame(() => setVisible(true));
  }, [disabled, normalizedOptions, selectedIndex, findNextEnabled]);

  const commitIndex = useCallback((idx) => {
    const opt = normalizedOptions[idx];
    if (!opt || opt.disabled) return;
    closeMenu(true);
    if (opt.value !== selectedValue) {
      onChange?.(opt.value);
    }
  }, [normalizedOptions, selectedValue, onChange, closeMenu]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 4;
    const estHeight = Math.min(260, normalizedOptions.length * 32 + 12);
    const desiredWidth = Math.min(
      Math.max(rect.width, menuMinWidth || 0),
      Math.min(menuMaxWidth, vw - margin * 2)
    );

    let rawLeft = align === 'end' ? rect.right - desiredWidth : rect.left;
    const left = Math.max(margin, Math.min(Math.round(rawLeft), Math.max(margin, vw - desiredWidth - margin)));

    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const placeTop = spaceBelow < Math.min(estHeight, 136) && spaceAbove > spaceBelow;

    if (placeTop) {
      const bottom = Math.max(margin, Math.round(vh - rect.top + gap));
      const maxHeight = Math.max(96, Math.min(280, Math.round(vh - bottom - margin)));
      setMenuPos({ left, bottom, top: undefined, minWidth: Math.round(desiredWidth), maxHeight, placement: 'top' });
    } else {
      const top = Math.max(margin, Math.min(Math.round(rect.bottom + gap), vh - 96));
      const maxHeight = Math.max(96, Math.min(280, Math.round(vh - top - margin)));
      setMenuPos({ left, top, bottom: undefined, minWidth: Math.round(desiredWidth), maxHeight, placement: 'bottom' });
    }
  }, [align, menuMaxWidth, menuMinWidth, normalizedOptions.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      closeMenu(false);
    };
    const onWindowKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        closeMenu(true);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => findNextEnabled(prev < 0 ? -1 : prev, 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => findNextEnabled(prev < 0 ? 0 : prev, -1));
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(findNextEnabled(-1, 1));
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(findNextEnabled(0, -1));
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (highlightedIndex >= 0) commitIndex(highlightedIndex);
        else closeMenu(true);
        return;
      }
      if (e.key === 'Tab') {
        closeMenu(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onWindowKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onWindowKeyDown, true);
    };
  }, [open, closeMenu, findNextEnabled, highlightedIndex, commitIndex]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const el = menuRef.current?.querySelector(`[data-option-index="${highlightedIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlightedIndex]);

  const handleKeyDown = (e) => {
    if (disabled || open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openMenu();
    }
  };

  const listboxId = useMemo(() => id ? `${id}-listbox` : `mc-select-lb-${Math.random().toString(36).slice(2, 8)}`, [id]);

  const triggerClass = `mc-custom-select ${className}${open ? ' is-open' : ''}`.trim();

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        data-interactive="true"
        className={triggerClass}
        style={style}
        onClick={(e) => {
          e.stopPropagation();
          if (open) closeMenu(false);
          else openMenu();
        }}
        onKeyDown={handleKeyDown}
      >
        <span className={`mc-custom-select-value${!selectedOption ? ' is-placeholder' : ''}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <IconChevronDown size={13} className={`mc-custom-select-chevron${open ? ' is-open' : ''}`} />
      </button>

      {open && menuPos && (
        <BodyOverlay>
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel || placeholder}
            data-interactive="true"
            data-select-menu="true"
            className={`mc-select-menu mc-popover-anim${visible ? ' is-open' : ''}${menuPos.placement === 'top' ? ' is-top' : ' is-bottom'}`}
            style={{
              position: 'fixed',
              left: menuPos.left,
              top: menuPos.top,
              bottom: menuPos.bottom,
              minWidth: menuPos.minWidth,
              maxWidth: menuMaxWidth,
              maxHeight: menuPos.maxHeight,
              zIndex
            }}
            onMouseDown={(e) => {
              // Prevent blur on trigger while clicking options
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {normalizedOptions.map((opt, idx) => {
              const isSelected = opt.value === selectedValue;
              const isHighlighted = idx === highlightedIndex;
              return (
                <button
                  key={`${opt.value}-${idx}`}
                  type="button"
                  role="option"
                  data-option-index={idx}
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  className={`mc-select-option${isSelected ? ' is-selected' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
                  onMouseEnter={() => { if (!opt.disabled) setHighlightedIndex(idx); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    commitIndex(idx);
                  }}
                >
                  <span className="mc-select-option-label">{opt.label}</span>
                  <span className="mc-select-option-check" aria-hidden="true">
                    {isSelected && <IconCheck size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
        </BodyOverlay>
      )}
    </>
  );
}
