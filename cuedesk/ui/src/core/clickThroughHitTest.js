const PASSIVE_SELECTOR = '[data-click-through-passive="true"]';

const INTERACTIVE_SELECTOR = [
  '[data-interactive="true"]',
  '[data-click-through-interactive="true"]',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="switch"]',
  '[role="tab"]',
  '[contenteditable="true"]'
].join(',');

const SCROLL_EDGE_PX = 16;

/**
 * Pure hit-test for Smart Local Click-Through (aligned with SuiSi's clickThroughRegion).
 * 1. Explicit passive marker always passes through.
 * 2. Interactive controls / regions capture pointer.
 * 3. Scrollable containers capture pointer ONLY within their 16px right/bottom scrollbar edge when overflowing.
 */
export function isInteractiveTarget(target, clientX, clientY) {
  if (!target) return false;
  if (typeof target.closest === 'function') {
    if (target.closest(PASSIVE_SELECTOR)) return false;
    if (target.closest(INTERACTIVE_SELECTOR)) return true;
  }
  let node = target;
  while (node && node.nodeType === 1) {
    if (node.dataset && node.dataset.scrollable === 'true' && typeof node.getBoundingClientRect === 'function') {
      const hasV = (node.scrollHeight || 0) > (node.clientHeight || 0) + 2;
      const hasH = (node.scrollWidth || 0) > (node.clientWidth || 0) + 2;
      if (hasV || hasH) {
        if (clientX === undefined) return true;
        const rect = node.getBoundingClientRect();
        const onRightEdge = hasV &&
          clientX >= rect.right - SCROLL_EDGE_PX && clientX <= rect.right &&
          (clientY === undefined || (clientY >= rect.top && clientY <= rect.bottom));
        const onBottomEdge = hasH &&
          clientY !== undefined &&
          clientY >= rect.bottom - SCROLL_EDGE_PX && clientY <= rect.bottom &&
          clientX >= rect.left && clientX <= rect.right;
        if (onRightEdge || onBottomEdge) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * SuiSi-style 80ms main-process cursor poller for Windows click-through.
 * Even when Windows stops forwarding `mousemove` events to a click-through transparent window,
 * polling `screen.getCursorScreenPoint()` converted to content DIP coords reliably detects when
 * the pointer enters topbar buttons, floating pill, popovers, or scrollbar edges.
 */
export function startClickThroughPolling(getCursorInContent, onInteractiveChange, intervalMs = 80) {
  if (typeof getCursorInContent !== 'function') return () => {};
  let disposed = false;
  let busy = false;
  const tick = async () => {
    if (disposed || busy) return;
    busy = true;
    try {
      const pt = await getCursorInContent();
      if (disposed) return;
      if (!pt || !pt.inside) {
        onInteractiveChange(false);
        return;
      }
      const el = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(pt.x, pt.y)
        : null;
      onInteractiveChange(isInteractiveTarget(el, pt.x, pt.y));
    } catch {
      // Ignore transient IPC errors during shutdown
    } finally {
      busy = false;
    }
  };
  void tick();
  const id = setInterval(tick, intervalMs);
  return () => {
    disposed = true;
    clearInterval(id);
  };
}
