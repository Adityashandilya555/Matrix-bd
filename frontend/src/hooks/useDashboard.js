// skipcq: JS-0833
import React from 'react';
import { getDashboardSummary, getDashboardVersion } from '../services/api/dashboardApi.js';
import { SITE_DATA_CHANGED_EVENT } from '../services/api/siteEvents.js';
import { getAuthToken } from '../services/api/authToken.js';

export const POLL_MS = 15000;

// The last summary is kept for this tab (sessionStorage, like the token), so
// coming back to the dashboard draws it at once and refreshes underneath
// instead of showing an empty skeleton every time. Keyed by the signed-in
// user, so a different account in the same tab never sees someone else's.
function cacheKey(scope, nso) {
  try {
    const part = (getAuthToken() || '').split('.')[1];
    if (!part) return null;
    const { sub } = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return sub ? `zm:dash:${sub}:${nso ? 'nso' : scope}` : null;
  } catch { return null; }
}

function readCache(key) {
  if (!key) return null;
  try {
    const hit = JSON.parse(window.sessionStorage.getItem(key) || 'null');
    return hit && hit.data ? hit : null;
  } catch { return null; }
}

function writeCache(key, data, at) {
  if (!key) return;
  try { window.sessionStorage.setItem(key, JSON.stringify({ data, at })); } catch { /* full or blocked: no cache */ }
}

// Loads the role dashboard and keeps it fresh without reloading it blindly:
// every 15 seconds it asks /dashboard/version (one small query, 304 when nothing
// moved) and reloads the summary only when the version changes. It skips the
// check while the tab is hidden, checks at once when the tab comes back, and
// reloads on the in-app "sites changed" event.
export function useDashboard({ scope = 'module', nso = false } = {}, deps = {}) {
  const api = { getDashboardSummary, getDashboardVersion, ...deps };
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const [state, setState] = React.useState(() => {
    const hit = readCache(cacheKey(scope, nso));
    return hit
      ? { data: hit.data, status: 'ready', error: null, lastUpdatedAt: hit.at }
      : { data: null, status: 'loading', error: null, lastUpdatedAt: null };
  });
  const etagRef = React.useRef(null);
  const seqRef = React.useRef(0);
  const failedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const data = await apiRef.current.getDashboardSummary({ scope, nso });
      if (seq !== seqRef.current) return;
      failedRef.current = false;
      const at = Date.now();
      writeCache(cacheKey(scope, nso), data, at);
      setState({ data, status: 'ready', error: null, lastUpdatedAt: at });
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
      // The guard covers only the version call: a slow summary must not pause
      // polling, and load() already drops stale responses.
      inFlightRef.current = false;
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
    // Version and summary go out together, version first: waiting for the
    // version cost a round trip, and on the admin page it put the summary
    // behind the approval-queue requests (this effect runs before the page's
    // own, so the summary is first in the browser's connection queue). A
    // change landing between the two is caught by the next check at worst.
    let alive = true;
    apiRef.current.getDashboardVersion(null)
      .then(({ etag }) => { if (alive && etagRef.current === null) etagRef.current = etag; })
      .catch(() => { /* the first poll will take it */ });
    load();
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
