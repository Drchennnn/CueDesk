// reading-scroll-v1: shared scroll behavior for the renderer.
(function installReadingScroll() {
  if (window.__mcReadingScroll) return;
  window.__mcReadingScroll = true;
  document.addEventListener('wheel', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    let element = event.target instanceof Element ? event.target : event.target?.parentElement;
    // Keep native selection, number/range controls and horizontal gestures.
    if (element?.closest('select,input,[contenteditable="true"]')) return;
    while (element) {
      const style = getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
        if (!event.cancelable) return;
        event.preventDefault();
        const units = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? element.clientHeight : 1;
        const limit = Math.min(48, Math.max(12, element.clientHeight * .22));
        const distance = Math.sign(event.deltaY) * Math.min(limit, Math.abs(event.deltaY * units) * .45);
        element.scrollBy({ top: distance, behavior: 'instant' });
        return; // A pane at its edge must not unexpectedly move its parent.
      }
      element = element.parentElement;
    }
  }, { passive: false });
})();
