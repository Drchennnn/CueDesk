import React, { useEffect, useRef, useState } from 'react';

function detectCursorKind(target) {
  if (!target || typeof target.closest !== 'function') return 'default';
  if (target.closest('.mc-wb-divider')) return 'col-resize';
  if (target.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"]')) return 'text';
  if (target.closest('button, a, select, label, [role="button"], [role="switch"], [role="tab"], .mc-qcard, .mc-side-tab')) return 'pointer';
  return 'default';
}

/**
 * Security-mode virtual SVG cursor overlay.
 * When active, hides the real OS cursor over the floating window (`cursor: none !important`)
 * and renders a lightweight SVG pointer inside the content-protected Electron surface so the
 * cursor cannot leak during screen sharing while remaining sharp for the user.
 */
export function VirtualCursor({ active }) {
  const [visible, setVisible] = useState(false);
  const [kind, setKind] = useState('default');
  const cursorRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      root.classList.remove('mc-hide-real-cursor');
      setVisible(false);
      return;
    }
    root.classList.add('mc-hide-real-cursor');

    const onMove = (e) => {
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      }
      setVisible(true);
      const nextKind = detectCursorKind(e.target);
      setKind(prev => (prev === nextKind ? prev : nextKind));
    };
    const onLeave = () => setVisible(false);

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      root.classList.remove('mc-hide-real-cursor');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div
      ref={cursorRef}
      className="mc-virtual-cursor"
      aria-hidden="true"
      data-click-through-passive="true"
      style={{
        opacity: visible ? 1 : 0,
        transform: 'translate3d(-999px, -999px, 0)'
      }}
    >
      {kind === 'text' ? (
        <svg width="16" height="20" viewBox="0 0 16 20" style={{ marginLeft: -8, marginTop: -10 }}>
          <path d="M5 2h6M5 18h6M8 2v16" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M5 2h6M5 18h6M8 2v16" stroke="#111827" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : kind === 'col-resize' ? (
        <svg width="20" height="16" viewBox="0 0 20 16" style={{ marginLeft: -10, marginTop: -8 }}>
          <path d="M2 8h16M5 5l-3 3 3 3M15 5l3 3-3 3" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 8h16M5 5l-3 3 3 3M15 5l3 3-3 3" fill="none" stroke="#111827" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : kind === 'pointer' ? (
        <svg width="20" height="22" viewBox="0 0 20 22" style={{ marginLeft: -5, marginTop: -2 }}>
          <path
            d="M6.5 2.5a1.5 1.5 0 0 1 3 0V9h1a1.4 1.4 0 0 1 1.4 1.4V10h1a1.4 1.4 0 0 1 1.4 1.4v.3h.6a1.4 1.4 0 0 1 1.4 1.4v2.6c0 2.9-2.2 4.8-5.1 4.8h-1.8c-2 0-3.7-1.1-4.7-2.8L2.6 14a1.4 1.4 0 0 1 2.1-1.8l1.8 1.6V2.5z"
            fill="#ffffff"
            stroke="#111827"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="18" height="22" viewBox="0 0 18 22" style={{ marginLeft: -2, marginTop: -2 }}>
          <path
            d="M2.5 2L14.5 12.2L9.2 12.8L11.8 18.6L9.4 19.6L6.8 13.8L2.5 17.2Z"
            fill="#111827"
            stroke="#ffffff"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
