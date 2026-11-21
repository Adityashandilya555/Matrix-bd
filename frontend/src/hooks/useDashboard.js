// skipcq: JS-0833
import React from 'react';
import { getDashboardSummary, getDashboardVersion } from '../services/api/dashboardApi.js';
import { SITE_DATA_CHANGED_EVENT } from '../services/api/siteEvents.js';

export const POLL_MS = 15000;

// Loads the role dashboard and keeps it fresh without reloading it blindly:
// every 15 seconds it asks /dashboard/version (one small query, 304 when nothing
// moved) and reloads the summary only when the version changes. It skips the
// check while the tab is hidden, checks at once when the tab comes back, and
// reloads on the in-app "sites changed" event.
export function useDashboard({ scope = 'module', nso = false } = {}, deps = {}) {
  const api = { getDashboardSummary, getDashboardVersion, ...deps };
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const [state, setState] = React.useState({ data: null, status: 'loading', error: null, lastUpdatedAt: null });
  const etagRef = React.useRef(null);
  const seqRef = React.useRef(0);
  const failedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const data = await apiRef.current.getDashboardSummary({ scope, nso });
      if (seq !== seqRef.current) return;
      failedRef.current = false;
      setState({ data, status: 'ready', error: null, lastUpdatedAt: Date.now() });
    } catch (error) {
      if (seq !== seqRef.current) return;
      failedRef.current = true;
      setState((s) => ({ ...s, status: s.data ? 'ready' : 'error', error }));
    }
  }, [scope, nso]);

  const check = React.useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      const { changed, etag } = await apiRef.current.getDashboardVersion(etagRef.current);
      const first = etagRef.current === null;
      etagRef.current = etag;
      // Reload when the version moved, and retry after a failed load (the
      // version alone would not move to trigger it).
      if ((changed && !first) || failedRef.current) await load();
    } catch {
      // A failed check is retried on the next tick; the data on screen stays.
    }
  }, [load]);

  React.useEffect(() => {
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading' }));
    load();
    check();
    const id = window.setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const onChanged = () => load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(SITE_DATA_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(SITE_DATA_CHANGED_EVENT, onChanged);
    };
  }, [load, check]);

  return { ...state, refresh: load };
}
