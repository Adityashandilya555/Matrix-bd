import React from 'react';
import { subscribeSiteDataChanged } from '../services/api/siteEvents.js';

export function useSiteDataRefresh(refresh, { enabled = true } = {}) {
  const refreshRef = React.useRef(refresh);

  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  React.useEffect(() => {
    if (!enabled) return undefined;

    const run = () => refreshRef.current?.();
    const unsubscribe = subscribeSiteDataChanged(run);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
