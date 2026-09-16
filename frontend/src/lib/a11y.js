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
//
// But capture+stopPropagation ALONE is positional, not semantic: whoever
// registered in the earliest phase wins, which is not the same as "the overlay
// on top". An overlay opened INSIDE a consumer of this hook (ImageLightbox
// inside ClosureDetailsDrawer) is the topmost thing on screen yet loses every
// key to the drawer behind it — Escape closed the drawer instead of the preview,
// and Tab was confined to the drawer's panel while a lightbox was over it (#497).
//
// So ownership is tracked explicitly. Every active dialog pushes onto a shared
// stack, and a handler acts only while its own entry is on top. Same counted-
// module shape as lib/scrollLock.js, and for the same reason: with two overlays
// open at once, the correct answer depends on the pair, not on either alone.
//
// Order is registration order, which is opening order — an overlay opened from
// inside another arms this hook later and therefore wins. Two overlays armed in
// the SAME commit would register inner-first (React runs child effects before
// parent ones); nothing opens that way today, since an overlay renders nothing
// and arms nothing until it is actually opened.
const stack = [];

export function useDialogFocus(active, panelRef, onEscape) {
  const escapeRef = React.useRef(onEscape);
  React.useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);

  React.useEffect(() => {
    if (!active) return undefined;
    const trigger = document.activeElement;
    // Identity only — the array position is the ordering, and splice-by-identity
    // on cleanup keeps it correct when overlays close out of order.
    const entry = {};
    stack.push(entry);

    const onKey = (e) => {
      // Not the topmost overlay: this press belongs to whoever is above us, who
      // has their own listener. Falling through would close the wrong thing.
      if (stack[stack.length - 1] !== entry) return;
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
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(frame);
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
    };
  }, [active, panelRef]);
}
