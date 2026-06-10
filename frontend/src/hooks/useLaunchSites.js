import { useCallback, useEffect, useState } from 'react';
import { listSites } from '../services/api/siteService.js';
import { getSiteTrackerView } from '../services/api/siteTrackerApi.js';
import { useSiteDataRefresh } from './useSiteDataRefresh.js';

// useLaunchSites — sites that finished the Project module and were handed to
// NSO for launch. BD has no direct NSO endpoint (the /project and /nso queues
// are module-gated), so this derives launch membership from the BD-safe
// tracker projection: site.status is terminal (pushed_to_payments) AND the
// tracker reports projectStatus === 'done' (quality audit approved → NSO push).
//
// Shared by the Overview "Launch" KPI (count) and the /launch tab (rows).
export function useLaunchSites() {
  const [state, setState] = useState({ loading: true, rows: [], error: null });

  const refresh = useCallback(() => {
    let cancelled = false;
    listSites({ status: 'pushed_to_payments' })
      .then((sites) => Promise.all(
        (sites || []).map((site) =>
          getSiteTrackerView(site.id)
            .then((tracker) => ({ site, tracker }))
            .catch(() => null),
        ),
      ))
      .then((pairs) => {
        if (cancelled) return;
        const rows = (pairs || [])
          .filter(Boolean)
          .filter(({ tracker }) => tracker?.projectStatus === 'done');
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
