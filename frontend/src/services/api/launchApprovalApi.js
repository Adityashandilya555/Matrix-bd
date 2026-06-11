/**
 * Launch Approval API — post-NSO multi-step sign-off chain.
 *
 * Flow: pending → admin_approved → bd_confirmed → supervisor_approved
 *       → launched (site.is_launched = true)
 *
 * Legacy rows may still pass through super_admin_approved; the compatibility
 * endpoint remains exported, but current UI launches after supervisor approval.
 */
import axios from 'axios';
import { getAuthToken, clearAuthToken } from './authToken.js';
import { ApiError } from './adapters/httpAdapter.js';
import { notifySiteDataChanged } from './siteEvents.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

client.interceptors.request.use((cfg) => {
  const token = getAuthToken();
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
    if (status === 401) clearAuthToken();
    throw new ApiError({ status, detail: raw, code: err.response?.data?.code, cause: err });
  },
);

/** Fetch all launch approval rows (optionally filter by comma-separated status values) */
export async function getLaunchQueue(statusFilter) {
  const params = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
  const r = await client.get(`/launch-approvals/queue${params}`);
  return r.data; // { items, total }
}

/** Full detail for a single site's approval record */
export async function getLaunchApproval(siteId) {
  const r = await client.get(`/launch-approvals/${siteId}`);
  return r.data;
}

/** Admin saves editable commercial fields (PATCH — partial update) */
export async function saveLaunchFields(siteId, fields) {
  const r = await client.patch(`/launch-approvals/${siteId}/fields`, fields);
  notifySiteDataChanged({ source: 'launch', action: 'fields_saved', siteId });
  return r.data;
}

/** Admin approves after reviewing/editing fields */
export async function adminApproveLaunch(siteId) {
  const r = await client.post(`/launch-approvals/${siteId}/admin-approve`);
  notifySiteDataChanged({ source: 'launch', action: 'admin_approve', siteId });
  return r.data;
}

/** BD (executive / supervisor) confirms the commercial terms */
export async function bdConfirmLaunch(siteId) {
  const r = await client.post(`/launch-approvals/${siteId}/bd-confirm`);
  notifySiteDataChanged({ source: 'launch', action: 'bd_confirm', siteId });
  return r.data;
}

/** Supervisor approves after BD confirmation */
export async function supervisorApproveLaunch(siteId) {
  const r = await client.post(`/launch-approvals/${siteId}/supervisor-approve`);
  notifySiteDataChanged({ source: 'launch', action: 'supervisor_approve', siteId });
  return r.data;
}

/** Legacy compatibility approval. Current UI launches after supervisor approval. */
export async function superAdminApproveLaunch(siteId) {
  const r = await client.post(`/launch-approvals/${siteId}/super-admin-approve`);
  notifySiteDataChanged({ source: 'launch', action: 'super_admin_approve', siteId });
  return r.data;
}

/** Final launch — sets site.is_launched = true */
export async function launchSite(siteId) {
  const r = await client.post(`/launch-approvals/${siteId}/launch`);
  // Broadcast with 'launch' source so NSO, Project, BD pages refresh the LAUNCHED banner.
  notifySiteDataChanged({ source: 'launch', action: 'launched', siteId });
  return r.data;
}
