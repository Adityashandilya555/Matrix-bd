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
// The keydown listener is CAPTURE-phase and stops propagation: the surfaces
// these dialogs sit on (Drawer, LaunchReviewModal) register their own Escape
// handlers on window, and one press must not dismiss both.
//
// But phase alone is positional, not semantic — earliest registrant wins, which
// is not "the overlay on top". An overlay opened INSIDE a consumer (ImageLightbox
// inside ClosureDetailsDrawer) lost every key to the drawer behind it (#497). So
// ownership is explicit: each active dialog pushes onto a shared stack and a
// handler acts only while its entry is on top. Same shape as lib/scrollLock.js.
//
// Order is opening order. Two dialogs armed in the same commit would register
// inner-first (child effects run before parent), but nothing opens that way — an
// overlay arms nothing until it is actually opened.
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
