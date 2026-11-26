/**
 * Global SuiSi-style in-DOM tooltip manager + Native Tooltip Privacy Guard.
 *
 * Why this matters:
 * 1. Visual parity: replaces Chromium/Windows black-box native `title` tooltips with crisp
 *    rounded card tooltips (matching SuiSi) that support light/dark themes and viewport clamping.
 * 2. Anti-screenshot privacy: native OS `title` tooltips spawn a separate Windows HWND outside
 *    Electron's `setContentProtection(true)` surface; converting `title` -> `data-mc-tooltip`
 *    renders every tooltip strictly inside the protected window.
 */
export function installGlobalTooltip(doc = document) {
  if (!doc || typeof doc.createElement !== 'function') return () => {};

  const tip = doc.createElement('div');
  tip.id = 'mc-global-tooltip';
  tip.className = 'mc-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('aria-hidden', 'true');

  let activeTarget = null;
  let pendingTarget = null;
  let showTimer = null;
  let hideGraceUntil = 0;
  let targetObserver = null;

  const migrateTitle = (el) => {
    if (!el || el.nodeType !== 1) return;
    if (el.matches?.('iframe, frame')) return;
    if (el.hasAttribute('title')) {
      const val = el.getAttribute('title');
      if (val && val.trim()) {
        el.setAttribute('data-mc-tooltip', val);
      } else {
        el.removeAttribute('data-mc-tooltip');
      }
      el.removeAttribute('title');
    }
  };

  const sweepRoot = (root) => {
    if (!root || root.nodeType !== 1) return;
    migrateTitle(root);
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll('[title]').forEach(migrateTitle);
    }
  };

  const clearDescribedBy = (el) => {
    if (!el || !el.getAttribute) return;
    const prev = el.getAttribute('aria-describedby') || '';
    const next = prev.split(/\s+/).filter(id => id && id !== tip.id).join(' ');
    if (next) el.setAttribute('aria-describedby', next);
    else el.removeAttribute('aria-describedby');
  };

  const hideNow = () => {
    clearTimeout(showTimer);
    showTimer = null;
    pendingTarget = null;
    if (targetObserver) {
      targetObserver.disconnect();
      targetObserver = null;
    }
    if (activeTarget) {
      clearDescribedBy(activeTarget);
      activeTarget = null;
      hideGraceUntil = Date.now() + 260;
    }
    tip.classList.remove('is-visible', 'is-above', 'is-below');
    tip.setAttribute('aria-hidden', 'true');
    if (tip.parentNode) tip.remove();
  };

  const positionFor = (el) => {
    if (!el || !el.isConnected) {
      hideNow();
      return;
    }
    // Never overlap an expanded dropdown/popover on the same trigger button.
    if (el.getAttribute('aria-expanded') === 'true') {
      hideNow();
      return;
    }
    const text = (el.getAttribute('data-mc-tooltip') || '').trim();
    if (!text) {
      hideNow();
      return;
    }
    tip.textContent = text;
    if (!tip.parentNode) doc.body.appendChild(tip);

    const rect = el.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth || window.innerWidth;
    const vh = doc.documentElement.clientHeight || window.innerHeight;
    const margin = 8;
    const gap = 8;

    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;

    // Horizontally centered over trigger, clamped safely inside viewport
    const rawLeft = rect.left + (rect.width - tipW) / 2;
    const left = Math.max(margin, Math.min(vw - tipW - margin, Math.round(rawLeft)));

    // Prefer below trigger (matches SuiSi topbar tooltip); flip above near bottom edge
    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const placeAbove = spaceBelow < tipH && spaceAbove > spaceBelow;

    const top = placeAbove
      ? Math.max(margin, Math.round(rect.top - tipH - gap))
      : Math.min(vh - tipH - margin, Math.round(rect.bottom + gap));

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.classList.toggle('is-above', placeAbove);
    tip.classList.toggle('is-below', !placeAbove);
    tip.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      if (activeTarget === el) tip.classList.add('is-visible');
    });
  };

  const showFor = (el) => {
    if (!el || !el.isConnected) return;
    if (el.getAttribute('aria-expanded') === 'true') return;
    const text = (el.getAttribute('data-mc-tooltip') || '').trim();
    if (!text) return;

    if (activeTarget && activeTarget !== el) {
      clearDescribedBy(activeTarget);
    }
    activeTarget = el;
    pendingTarget = null;

    const prevDesc = el.getAttribute('aria-describedby') || '';
    const descParts = prevDesc.split(/\s+/).filter(Boolean);
    if (!descParts.includes(tip.id)) {
      el.setAttribute('aria-describedby', [...descParts, tip.id].join(' '));
    }

    positionFor(el);

    if (targetObserver) targetObserver.disconnect();
    targetObserver = new MutationObserver(() => {
      if (!activeTarget || !activeTarget.isConnected) {
        hideNow();
        return;
      }
      migrateTitle(activeTarget);
      positionFor(activeTarget);
    });
    targetObserver.observe(el, {
      attributes: true,
      attributeFilter: ['title', 'data-mc-tooltip', 'aria-expanded', 'disabled']
    });
  };

  const findTooltipTarget = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      migrateTitle(node);
      if (node.hasAttribute?.('data-mc-tooltip') && (node.getAttribute('data-mc-tooltip') || '').trim()) {
        return node;
      }
    }
    return null;
  };

  const scheduleFor = (target, immediate = false) => {
    if (!target) {
      hideNow();
      return;
    }
    if (target === activeTarget) {
      positionFor(target);
      return;
    }
    if (target === pendingTarget) return;
    clearTimeout(showTimer);
    pendingTarget = target;
    const warm = Boolean(activeTarget) || Date.now() < hideGraceUntil;
    const delay = immediate ? 0 : (warm ? 50 : 200);
    if (delay === 0) {
      showFor(target);
    } else {
      showTimer = setTimeout(() => showFor(target), delay);
    }
  };

  const onPointerOver = (e) => {
    const target = findTooltipTarget(e);
    scheduleFor(target, false);
  };

  const onPointerOut = (e) => {
    const current = activeTarget || pendingTarget;
    if (!current) return;
    const rel = e.relatedTarget;
    if (rel && rel.nodeType === 1 && current.contains(rel)) return;
    if (rel && rel.nodeType === 1) {
      const next = rel.closest?.('[data-mc-tooltip], [title]');
      if (next === current) return;
    }
    hideNow();
  };

  const onFocusIn = (e) => {
    // Only show keyboard-focus tooltips for keyboard focus-visible targets
    const el = findTooltipTarget(e);
    if (el && el.matches?.(':focus-visible')) {
      scheduleFor(el, false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') hideNow();
  };

  // Initial sweep + MutationObserver to eliminate native OS tooltips everywhere
  if (doc.body) sweepRoot(doc.body);
  const rootObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'title') {
        migrateTitle(m.target);
        if (activeTarget && m.target === activeTarget) positionFor(activeTarget);
      } else if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) sweepRoot(node);
        }
        if (activeTarget && !activeTarget.isConnected) hideNow();
      }
    }
  });
  if (doc.body) {
    rootObserver.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title']
    });
  }

  doc.addEventListener('pointerover', onPointerOver, true);
  doc.addEventListener('pointerout', onPointerOut, true);
  doc.addEventListener('pointerdown', hideNow, true);
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', hideNow, true);
  doc.addEventListener('scroll', hideNow, true);
  doc.addEventListener('mouseleave', hideNow);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', hideNow);
  window.addEventListener('resize', hideNow);

  return () => {
    hideNow();
    rootObserver.disconnect();
    doc.removeEventListener('pointerover', onPointerOver, true);
    doc.removeEventListener('pointerout', onPointerOut, true);
    doc.removeEventListener('pointerdown', hideNow, true);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('focusout', hideNow, true);
    doc.removeEventListener('scroll', hideNow, true);
    doc.removeEventListener('mouseleave', hideNow);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', hideNow);
    window.removeEventListener('resize', hideNow);
  };
}
