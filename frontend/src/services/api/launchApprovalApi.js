/**
 * Launch Approval API — the post-NSO *validation loop*.
 *
 * Flow:  pending_admin_review → under_exec_review → under_supervisor_review
 *        → pending_admin_final → ready_to_launch → launched
 *
 * Until the admin's final confirm, edits live only on the backend staging row
 * (launch_approvals) — the canonical site_details/sites rent columns are
 * committed only by finalConfirm().
 */
import axios from 'axios';
import { getAuthToken, notifySessionExpired } from './authToken.js';
import { ApiError, ensureFreshAuthToken, requestCarriedToken } from './adapters/httpAdapter.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

client.interceptors.request.use(async (cfg) => {
  const token = await ensureFreshAuthToken() || getAuthToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

client.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.code === 'ECONNABORTED') {
      throw new ApiError({ status: 0, code: 'TIMEOUT', detail: 'Request timed out', cause: err });
    }
    const status = err.response?.status ?? 0;
    const raw = err.response?.data?.detail || err.message || 'Request failed';
    if (status === 401 && requestCarriedToken(err.config)) notifySessionExpired({ reason: 'unauthorized', detail: raw });
    throw new ApiError({ status, detail: raw, code: err.response?.data?.code, cause: err });
  },
);

/** All launch approval rows (optionally filter by comma-separated status values). */
export async function getLaunchQueue(statusFilter) {
  const params = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
  const r = await client.get(`/launch-approvals/queue${params}`);
  return r.data; // { items, total }
}

/** Full record for a single site (details + dept statuses + verdicts + timeline). */
export async function getLaunchApproval(siteId) {
  const r = await client.get(`/launch-approvals/${siteId}`);
  return r.data;
}

/** Save rent-only staging fields (admin first/final touch, supervisor on review). */
export async function saveLaunchRentFields(siteId, fields) {
  const r = await client.patch(`/launch-approvals/${siteId}/rent-fields`, fields);
  return r.data;
}

/** Admin 1st touch → route to the creating executive. */
export async function sendForReview(siteId, comment) {
  const r = await client.post(`/launch-approvals/${siteId}/send-for-review`, { comment: comment || null });
  return r.data;
}

/** Executive verdict — { verdict: 'approved' | 'rejected', comment }. */
export async function execReview(siteId, { verdict, comment }) {
  const r = await client.post(`/launch-approvals/${siteId}/exec-review`, { verdict, comment: comment || null });
  return r.data;
}

/** Supervisor verdict — { verdict: 'approved' | 'rejected', comment }. */
export async function supervisorReview(siteId, { verdict, comment }) {
  const r = await client.post(`/launch-approvals/${siteId}/supervisor-review`, { verdict, comment: comment || null });
  return r.data;
}

/** Admin final touch → commit agreed rent terms to the DB, unlock Launch. */
export async function finalConfirm(siteId, comment) {
  const r = await client.post(`/launch-approvals/${siteId}/final-confirm`, { comment: comment || null });
  return r.data;
}

/** Final go-live — sets site.is_launched = true. */
export async function launchSite(siteId) {
  const r = await client.post(`/launch-approvals/${siteId}/launch`);
  return r.data;
}
