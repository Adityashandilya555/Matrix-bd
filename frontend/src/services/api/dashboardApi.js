// skipcq: JS-0833
// Role dashboards (backend: app/routers/dashboard.py, /nso/summary in nso.py).
//   GET /dashboard/version   cheap change check; 304 when If-None-Match matches
//   GET /dashboard/summary   the caller's sections; scope=module|team for supervisors
//   GET /nso/summary         NSO supervisor view (NSO-grant executives are
//                            supervisors only on /nso/*, so they read it here)
import { createApiClient } from './axiosClient.js';

const client = createApiClient();

export async function getDashboardSummary({ scope = 'module', nso = false } = {}) {
  const url = nso ? '/nso/summary' : '/dashboard/summary';
  const params = nso ? undefined : { scope };
  return (await client.get(url, { params })).data;
}

// Returns { changed, etag }. A 304 means nothing the dashboard shows has moved.
export async function getDashboardVersion(etag) {
  const res = await client.get('/dashboard/version', {
    headers: etag ? { 'If-None-Match': etag } : undefined,
    validateStatus: (s) => s === 200 || s === 304,
  });
  if (res.status === 304) return { changed: false, etag };
  return { changed: true, etag: res.headers?.etag || `"${res.data?.version}"` };
}
