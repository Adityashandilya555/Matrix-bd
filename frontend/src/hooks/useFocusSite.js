import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// useFocusSite — deep-link "scroll to this site" support.
//
// The overview site list navigates to the owning tab with `?focus=<id|code>`.
// Pages that render site rows mark each row root with `data-site-id` and call
// this hook; it polls briefly (rows may still be loading from the API), then
// scrolls the row into view and flashes it via the `zm-focus-target` class
// (keyframes live in index.html with the rest of the zm interaction CSS).
export function useFocusSite() {
  const location = useLocation();
  const focusId = new URLSearchParams(location.search).get('focus');

  useEffect(() => {
    if (!focusId) return undefined;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const esc = window.CSS?.escape ? window.CSS.escape(focusId) : focusId.replace(/"/g, '\\"');
      const el = document.querySelector(`[data-site-id="${esc}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('zm-focus-target');
        setTimeout(() => el.classList.remove('zm-focus-target'), 2600);
      } else if (++attempts < 30) {
        setTimeout(tick, 200);
      }
    };
    // Delay the first attempt past the App-shell effect that resets the main
    // scroll container to top on every pathname change — running in the same
    // commit, that reset lands AFTER this page effect and would cancel the
    // smooth scrollIntoView (most visible on long lists like Sites in process).
    const t = setTimeout(tick, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [focusId]);

  return focusId;
}
