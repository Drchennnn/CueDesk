const INTERACTIVE_SELECTOR = [
  '[data-interactive="true"]',
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
 * Pure hit-test for Smart Local Click-Through.
 * Returns true when the pointer is over an interactive control (top chrome,
 * floating exit pill, gear menu, inputs, buttons, modals, resize dividers)
 * or within the 16px scrollbar edge of a scrollable answer/question container.
 */
export function isInteractiveTarget(target, clientX, clientY) {
  if (!target) return false;
  if (typeof target.closest === 'function' && target.closest(INTERACTIVE_SELECTOR)) {
    return true;
  }
  let node = target;
  while (node && node.nodeType === 1) {
    if (node.dataset && node.dataset.scrollable === 'true' && typeof node.getBoundingClientRect === 'function') {
      const hasOverflow = (node.scrollHeight || 0) > (node.clientHeight || 0) + 2;
      if (hasOverflow) {
        const rect = node.getBoundingClientRect();
        const distRight = rect.right - clientX;
        const distBottom = rect.bottom - clientY;
        if ((distRight >= 0 && distRight <= SCROLL_EDGE_PX) || (distBottom >= 0 && distBottom <= SCROLL_EDGE_PX)) {
          return true;
        }
      }
    }
    node = node.parentElement;
  }
  return false;
}
