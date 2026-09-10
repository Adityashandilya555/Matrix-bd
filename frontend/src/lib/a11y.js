// skipcq: JS-0833
import React from 'react';

export function keyActivate(fn) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn(e);
    }
  };
}

export const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Make an open dialog behave like one: move focus in, keep Tab inside it, hand
// Escape to the caller, and put focus back where it came from on close.
//
// aria-modal="true" is a PROMISE that focus is contained. Without this, keyboard
// and screen-reader users can tab straight out to the controls behind the
// dialog and operate the very thing the dialog is asking them about — which is
// worse than not marking it modal at all.
//
// `onEscape` is captured in a ref so a caller passing an inline arrow does not
// tear down and rebuild the listener on every render.
//
// The keydown listener is CAPTURE-phase and stops propagation, because the
// surfaces these dialogs sit on (Drawer, LaunchReviewModal) register their own
// Escape handlers on window. Without capturing, one press would dismiss the
// dialog and the surface behind it together.
export function useDialogFocus(active, panelRef, onEscape) {
  const escapeRef = React.useRef(onEscape);
  React.useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);

  React.useEffect(() => {
    if (!active) return undefined;
    const trigger = document.activeElement;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = panelRef.current;
      if (!el) return;
      const items = Array.from(el.querySelectorAll(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);

    const frame = requestAnimationFrame(() => {
      const el = panelRef.current;
      if (el) (el.querySelector(FOCUSABLE) || el).focus();
    });

    return () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(frame);
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
    };
  }, [active, panelRef]);
}
