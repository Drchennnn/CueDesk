import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[role="switch"]:not([disabled]):not([tabindex="-1"])',
  '[role="combobox"]:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function getFocusableInside(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

/**
 * Computes viewport-clamped fixed coordinates anchored to a trigger DOMRect.
 * Automatically flips vertical placement when space is insufficient and clamps horizontally.
 */
export function computeAnchoredRect(anchorRect, {
  width = 240,
  estimatedHeight = 200,
  placement = 'bottom',
  align = 'end',
  offset = 8,
  margin = 8,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 920,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 464
} = {}) {
  const w = Math.min(width, Math.max(140, viewportWidth - margin * 2));
  const rect = anchorRect || {
    left: viewportWidth - w - margin,
    right: viewportWidth - margin,
    top: 44,
    bottom: 44,
    width: 28,
    height: 28
  };

  let rawLeft;
  if (align === 'start') rawLeft = rect.left;
  else if (align === 'center') rawLeft = rect.left + rect.width / 2 - w / 2;
  else rawLeft = rect.right - w;
  const left = Math.max(margin, Math.min(Math.round(rawLeft), Math.max(margin, viewportWidth - w - margin)));

  const spaceBelow = viewportHeight - rect.bottom - offset - margin;
  const spaceAbove = rect.top - offset - margin;
  let actualPlacement = placement;
  if (placement === 'bottom' && spaceBelow < Math.min(estimatedHeight, 160) && spaceAbove > spaceBelow) {
    actualPlacement = 'top';
  } else if (placement === 'top' && spaceAbove < Math.min(estimatedHeight, 160) && spaceBelow > spaceAbove) {
    actualPlacement = 'bottom';
  }

  if (actualPlacement === 'top') {
    const bottom = Math.max(margin, Math.round(viewportHeight - rect.top + offset));
    const maxHeight = Math.max(120, Math.round(viewportHeight - bottom - margin));
    return { left, bottom, top: undefined, width: w, maxHeight, placement: 'top' };
  }
  const top = Math.max(margin, Math.min(Math.round(rect.bottom + offset), viewportHeight - 120));
  const maxHeight = Math.max(120, Math.round(viewportHeight - top - margin));
  return { left, top, bottom: undefined, width: w, maxHeight, placement: 'bottom' };
}

/**
 * Reusable dynamically-anchored popover with smooth 150ms enter/exit animation,
 * viewport overflow clamping, and proper keyboard focus management / Tab trapping (M16).
 */
export function AnchoredPopover({
  open,
  anchorRef,
  anchorRect: explicitRect,
  placement = 'bottom',
  align = 'end',
  offset = 8,
  width = 240,
  estimatedHeight = 200,
  zIndex = 9960,
  className = '',
  style,
  role = 'menu',
  ariaLabel,
  trapFocus = true,
  autoFocus = true,
  onClose,
  onMouseEnter,
  onMouseLeave,
  children
}) {
  const [mounted, setMounted] = useState(Boolean(open));
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), 165);
    return () => clearTimeout(timer);
  }, [open]);

  // Auto-focus first interactive element inside click-opened popovers (M16)
  useEffect(() => {
    if (open && autoFocus && onClose) {
      wasOpenRef.current = true;
      const raf = requestAnimationFrame(() => {
        const container = popRef.current;
        if (!container) return;
        const focusables = getFocusableInside(container);
        if (focusables.length > 0) {
          focusables[0].focus({ preventScroll: true });
        } else {
          container.focus({ preventScroll: true });
        }
      });
      return () => cancelAnimationFrame(raf);
    }
    wasOpenRef.current = Boolean(open);
    return undefined;
  }, [open, autoFocus, onClose]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const recalc = () => {
      const rect = explicitRect || anchorRef?.current?.getBoundingClientRect?.() || null;
      const measuredH = popRef.current?.offsetHeight || estimatedHeight;
      setPos(computeAnchoredRect(rect, { width, estimatedHeight: measuredH, placement, align, offset }));
    };
    recalc();
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    return () => {
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
    };
  }, [mounted, open, explicitRect, anchorRef, width, estimatedHeight, placement, align, offset]);

  useEffect(() => {
    if (!open || !onClose) return;
    const onDown = (e) => {
      const target = e.target;
      if (popRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      // Ignore clicks inside portaled CustomSelect dropdown menus opened from within this popover
      if (target?.closest?.('[data-select-menu="true"]')) return;
      onClose();
    };
    const onKey = (e) => {
      // If a nested CustomSelect listbox is open, let CustomSelect handle Escape/Tab first
      if (document.querySelector('[data-select-menu="true"]')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        requestAnimationFrame(() => anchorRef?.current?.focus?.());
        return;
      }

      if (e.key === 'Tab' && trapFocus && popRef.current) {
        const focusables = getFocusableInside(popRef.current);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const inside = popRef.current.contains(active);
        if (!inside) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef, trapFocus]);

  if (!mounted) return null;
  const resolved = pos || computeAnchoredRect(explicitRect || anchorRef?.current?.getBoundingClientRect?.(), {
    width,
    estimatedHeight,
    placement,
    align,
    offset
  });

  return (
    <div
      ref={popRef}
      role={role}
      tabIndex={-1}
      aria-label={ariaLabel}
      data-interactive="true"
      className={`mc-popover-anim${visible ? ' is-open' : ''}${resolved.placement === 'top' ? ' is-top' : ' is-bottom'} ${className}`.trim()}
      style={{
        position: 'fixed',
        left: resolved.left,
        top: resolved.top,
        bottom: resolved.bottom,
        width: resolved.width,
        maxHeight: resolved.maxHeight,
        zIndex,
        ...style
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}
