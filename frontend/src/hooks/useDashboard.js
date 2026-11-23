// skipcq: JS-0833
import React from 'react';
import { getDashboardSummary, getDashboardVersion } from '../services/api/dashboardApi.js';
import { SITE_DATA_CHANGED_EVENT } from '../services/api/siteEvents.js';
import { getAuthToken } from '../services/api/authToken.js';

export const POLL_MS = 15000;

// The last summary is kept for this tab (sessionStorage, like the token), so
// coming back to the dashboard draws it at once and refreshes underneath
// instead of showing an empty skeleton every time. Keyed by the signed-in
// user and the view (module, borrowed module, scope), so another account or
// another module in the same tab never sees this one's numbers.
function cacheKey(scope, nso, tag) {
  try {
    const part = (getAuthToken() || '').split('.')[1];
    if (!part) return null;
    const { sub } = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return sub ? `zm:dash:${sub}:${tag || '-'}:${nso ? 'nso' : scope}` : null;
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
export function useDashboard({ scope = 'module', nso = false, cacheTag = '' } = {}, deps = {}) {
  const api = { getDashboardSummary, getDashboardVersion, ...deps };
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const [state, setState] = React.useState(() => {
    const hit = readCache(cacheKey(scope, nso, cacheTag));
    return hit
      ? { data: hit.data, status: 'ready', error: null, lastUpdatedAt: hit.at }
      : { data: null, status: 'loading', error: null, lastUpdatedAt: null };
  });
  const etagRef = React.useRef(null);
  const seqRef = React.useRef(0);
  const failedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    const seq = ++seqRef.current;
    // The key is taken when the request starts: if the account changes while
    // it is in flight, the answer belongs to the old account and is not stored.
    const key = cacheKey(scope, nso, cacheTag);
    try {
      const data = await apiRef.current.getDashboardSummary({ scope, nso });
      if (seq !== seqRef.current) return;
      failedRef.current = false;
      // The server reads the version before the sections, so polling from it
      // catches any change made while the summary was being built.
      if (data && data.version) etagRef.current = `"${data.version}"`;
      const at = Date.now();
      if (key && key === cacheKey(scope, nso, cacheTag)) writeCache(key, data, at);
      setState({ data, status: 'ready', error: null, lastUpdatedAt: at });
    } catch (error) {
      if (seq !== seqRef.current) return;
      failedRef.current = true;
      setState((s) => ({ ...s, status: s.data ? 'ready' : 'error', error }));
    }
  }, [scope, nso, cacheTag]);

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
    // The summary goes out at once and carries its own version, so there is
    // no separate version round trip before it (on the admin page that wait
    // also put the summary behind the approval-queue requests; this effect
    // runs before the page's own, so the summary is first in line).
    load();
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
