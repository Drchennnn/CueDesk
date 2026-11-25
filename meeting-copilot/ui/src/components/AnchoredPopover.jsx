import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
 * Reusable dynamically-anchored popover with smooth 150ms enter/exit animation
 * (opacity + scale + translateY) and viewport overflow clamping.
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
  onClose,
  onMouseEnter,
  onMouseLeave,
  children
}) {
  const [mounted, setMounted] = useState(Boolean(open));
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);

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
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

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
