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

  const inFlightRef = React.useRef(false);
  const check = React.useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    // visibilitychange and focus often fire together: one check at a time.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { changed, etag } = await apiRef.current.getDashboardVersion(etagRef.current);
      const first = etagRef.current === null;
      etagRef.current = etag;
      // Reload when the version moved, and retry after a failed load (the
      // version alone would not move to trigger it).
      if ((changed && !first) || failedRef.current) await load();
    } catch {
      // A failed check is retried on the next tick; the data on screen stays.
    } finally {
      inFlightRef.current = false;
    }
  }, [load]);

  React.useEffect(() => {
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading' }));
    // Take the version first, then the summary, so a change landing between
    // the two shows up on the next check instead of being missed.
    let alive = true;
    (async () => {
      try {
        const { etag } = await apiRef.current.getDashboardVersion(null);
        if (alive) etagRef.current = etag;
      } catch { /* the first poll will take it */ }
      if (alive) load();
    })();
    const id = window.setInterval(check, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const onChanged = () => load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(SITE_DATA_CHANGED_EVENT, onChanged);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(SITE_DATA_CHANGED_EVENT, onChanged);
    };
  }, [load, check]);

  return { ...state, refresh: load };
}
