// skipcq: JS-0833
// ThemedPortal — render an overlay at document.body, keeping the app's theme.
//
// WHY A PORTAL. position: fixed resolves against the viewport only while no
// ancestor establishes a containing block for fixed descendants. transform,
// filter, backdrop-filter, perspective, will-change and contain all do — and so
// does an element with a transform ANIMATION still in effect. The business-admin
// shell wraps every tab panel in `.ac-fade-in`, whose keyframes animate transform
// with `animation-fill-mode: both`, so the animation keeps applying after it
// finishes and the wrapper is a containing block permanently. A fixed overlay
// inside it is sized and clipped to the panel instead of the screen.
//
// Portalling out of the tree is the durable answer: it fixes the class of bug
// rather than the one container that happens to trigger it today.
//
// WHY NOT ModalPortal. business-admin/ui/kit.jsx has one, but it finds the theme
// with `.ac-root[data-theme]` — a selector matching only the admin shell. The BD
// root (App.jsx) carries data-theme without that class, so ModalPortal would
// leave BD overlays unthemed. This reads the attribute generically instead.
//
// WHY THE THEME MUST TRAVEL. Dark tokens are declared as
// `[data-theme="dark"] { --zm-… }` (public/colors_and_type.css), an attribute
// selector on an ancestor — not a media query, and never set on <html>. Portal to
// body without carrying it and every --zm-* token silently falls back to light.
//
// COMMENT STYLE: line comments only, no JSDoc blocks — see launchRentAdapter.js.
import React from 'react';
import { createPortal } from 'react-dom';

const readTheme = () => {
  if (typeof document === 'undefined') return 'light';
  return document.querySelector('[data-theme]')?.getAttribute('data-theme') || 'light';
};

export default function ThemedPortal({ children }) {
  const [theme, setTheme] = React.useState(readTheme);

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.querySelector('[data-theme]');
    // Re-read on mount: the themed root may have appeared, or its value changed,
    // between the initial state and this effect.
    setTheme(readTheme());
    if (!root) return undefined;
    // A theme toggled while the overlay is open must follow it.
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  if (typeof document === 'undefined') return null;
  // Deliberately no .ac-root class: that carries the admin shell's own
  // full-height flex layout, which would fight an overlay.
  return createPortal(<div data-theme={theme}>{children}</div>, document.body);
}
