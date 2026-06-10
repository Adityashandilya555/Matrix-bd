import { useCallback, useEffect, useState } from 'react';
import { listSites } from '../services/api/siteService.js';
import { useSiteDataRefresh } from './useSiteDataRefresh.js';

// useLaunchSites — sites that finished the Project module and were handed to
// NSO for launch: site.status is terminal (pushed_to_payments) AND the
// project_status mirror on GET /sites reports 'done' (quality audit approved
// → NSO push). One request total — no per-site tracker fan-out.
//
// Shared by the Overview "Launch" KPI (count) and the /launch tab (rows).
export function useLaunchSites() {
  const [state, setState] = useState({ loading: true, rows: [], error: null });

  const refresh = useCallback(() => {
    let cancelled = false;
    listSites({ status: 'pushed_to_payments' })
      .then((sites) => {
        if (cancelled) return;
        const rows = (sites || []).filter((s) => s.projectStatus === 'done');
        setState({ loading: false, rows, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, rows: [], error: err?.detail || err?.message || 'Failed to load launch sites' });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => refresh(), [refresh]);
  useSiteDataRefresh(refresh);

  return { ...state, refresh };
}
