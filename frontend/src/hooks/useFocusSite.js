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
    let observer = null;
    let fallbackTimer = null;

    const focusEl = (el) => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('zm-focus-target');
      setTimeout(() => el.classList.remove('zm-focus-target'), 2600);
    };

    const tryFind = () => {
      const esc = window.CSS?.escape ? window.CSS.escape(focusId) : focusId.replace(/"/g, '\\"');
      return document.querySelector(`[data-site-id="${esc}"]`);
    };

    const startObserver = () => {
      if (cancelled) return;
      // Try immediately before setting up the observer.
      const el = tryFind();
      if (el) { focusEl(el); return; }

      observer = new MutationObserver(() => {
        const found = tryFind();
        if (found) {
          observer.disconnect();
          observer = null;
          clearTimeout(fallbackTimer);
          focusEl(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // 6 s hard-stop — give up if the element never appears.
      fallbackTimer = setTimeout(() => {
        if (observer) { observer.disconnect(); observer = null; }
      }, 6000);
    };

    // Delay the first attempt past the App-shell effect that resets the main
    // scroll container to top on every pathname change — running in the same
    // commit, that reset lands AFTER this page effect and would cancel the
    // smooth scrollIntoView (most visible on long lists like Sites in process).
    const initialTimer = setTimeout(startObserver, 120);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearTimeout(fallbackTimer);
      if (observer) { observer.disconnect(); observer = null; }
    };
  }, [focusId]);

  return focusId;
}
