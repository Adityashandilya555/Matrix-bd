import React from 'react';
import { subscribeSiteDataChanged } from '../services/api/siteEvents.js';

export function useSiteDataRefresh(
  refresh,
  { enabled = true, siteId = null, sources = null, actions = null, skipWhen = null } = {},
) {
  const refreshRef = React.useRef(refresh);
  const skipRef = React.useRef(skipWhen);
  const sourceKey = Array.isArray(sources) ? sources.join('|') : '';
  const actionKey = Array.isArray(actions) ? actions.join('|') : '';

  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  React.useEffect(() => {
    skipRef.current = skipWhen;
  }, [skipWhen]);

  React.useEffect(() => {
    if (!enabled) return undefined;

    const sourceSet = Array.isArray(sources) ? new Set(sources) : null;
    const actionSet = Array.isArray(actions) ? new Set(actions) : null;
    const targetSiteId = siteId ? String(siteId) : null;

    const shouldRun = (detail = {}, reason = 'event') => {
      if (skipRef.current?.(detail, reason)) return false;
      if (targetSiteId && detail.siteId && String(detail.siteId) !== targetSiteId) return false;
      if (sourceSet && detail.source && !sourceSet.has(detail.source)) return false;
      if (actionSet && detail.action && !actionSet.has(detail.action)) return false;
      return true;
    };

    // Returning to a tab fires BOTH visibilitychange→visible and window
    // focus back-to-back, which used to issue two identical refetches per
    // page (painful on slow endpoints like /nso/queue). Coalesce bursts.
    let lastRunAt = 0;
    const run = (detail = {}, reason = 'event') => {
      if (!shouldRun(detail, reason)) return;
      const now = Date.now();
      if (reason !== 'event' && now - lastRunAt < 400) return;
      lastRunAt = now;
      refreshRef.current?.(true, detail);
    };

    const unsubscribe = subscribeSiteDataChanged((detail) => run(detail, 'event'));
    const onVisible = () => {
      if (document.visibilityState === 'visible') run({}, 'visible');
    };

    const onFocus = () => run({}, 'focus');

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, siteId, sourceKey, actionKey]);
}
