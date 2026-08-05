import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

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
