// skipcq: JS-0833
// useQueue — the portal's one loader hook.
//
// Extracted from TeamDashboard when the observer portal needed the same thing.
// Both shells hold list state in exactly this shape, and the tab components read
// { status, items, error, refreshing } from it, so a second copy would drift.
//
// `silent` is the distinction that matters: a background refresh keeps the rows
// on screen and only flips `refreshing`, where a foreground load clears to a
// skeleton. Getting that backwards makes a 30-second poll blank the page.
import React from 'react';

export const errMsg = (e) => e?.detail || e?.message || 'Failed to load';

export function useQueue(fetcher) {
  const [state, setState] = React.useState({
    status: 'loading', items: [], total: 0, error: null, refreshing: false,
  });

  const load = React.useCallback(async (silent = false) => {
    setState((s) => (silent
      ? { ...s, refreshing: true }
      : { status: 'loading', items: [], total: 0, error: null, refreshing: false }));
    try {
      const d = await fetcher();
      const items = Array.isArray(d) ? d : (d?.items || []);
      const total = typeof d?.total === 'number' ? d.total : items.length;
      setState({ status: 'ready', items, total, error: null, refreshing: false });
    } catch (e) {
      // A timed-out background poll is not worth surfacing — the rows on screen
      // are still the best answer we have, and the next tick will retry.
      if (silent && e?.code === 'TIMEOUT') {
        setState((s) => ({ ...s, refreshing: false }));
        return;
      }
      setState((s) => (silent && s.items.length
        ? { ...s, error: errMsg(e), refreshing: false }
        : { status: 'error', items: [], total: 0, error: errMsg(e), refreshing: false }));
    }
  }, [fetcher]);

  React.useEffect(() => { load(false); }, [load]);
  return [state, load];
}
