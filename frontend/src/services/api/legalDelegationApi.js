// Legal delegation API client — backs the supervisor's "Delegate to executive"
// button on the DDR page and the executive's "assigned to me" queue.
//
// Endpoints (see backend/app/routers/legal.py):
//   POST   /legal/{site_id}/delegate         {executive_id, notes?}  (supervisor)
//   DELETE /legal/{site_id}/delegate/{user_id}                       (supervisor)
//   GET    /legal/{site_id}/delegations                              (supervisor view)
//   GET    /legal/delegations/me                                     (executive)
//
// We translate snake_case → camelCase at the wire boundary to match the
// pattern in legalApi.js.

import axios from 'axios';
import { getAuthToken, notifySessionExpired } from './authToken.js';
import { ApiError, ensureFreshAuthToken, requestCarriedToken } from './adapters/httpAdapter.js';
import { notifySiteDataChanged } from './siteEvents.js';

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
    const detail = err.response?.data?.detail || err.message || 'Request failed';
    if (status === 401 && requestCarriedToken(err.config)) notifySessionExpired({ reason: 'unauthorized', detail });
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

function delegationFromServer(row) {
  if (!row) return row;
  return {
    id:               row.id,
    siteId:           row.site_id,
    siteCode:         row.site_code,
    siteName:         row.site_name,
    city:             row.city,
    module:           row.module,
    delegateUserId:   row.delegate_user_id,
    delegateEmail:    row.delegate_email,
    delegateName:     row.delegate_name,
    grantedBy:        row.granted_by,
    grantedAt:        row.granted_at,
    notes:            row.notes,
    // Executive-assignment-list extras
    siteStatus:       row.site_status,
    legalDdStatus:    row.legal_dd_status,
    legalReviewAt:    row.legal_review_at,
  };
}

// ── Supervisor writes ───────────────────────────────────────────────────────

export async function delegateLegal(siteId, executiveId, notes) {
  const body = { executive_id: executiveId };
  if (notes) body.notes = notes;
  const data = await client.post(`/legal/${siteId}/delegate`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'legal_delegated', siteId });
  return delegationFromServer(data);
}

export async function revokeLegalDelegation(siteId, userId) {
  const data = await client.delete(`/legal/${siteId}/delegate/${userId}`).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'legal_delegation_revoked', siteId });
  return data; // { ok, message }
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listLegalDelegationsForSite(siteId) {
  const data = await client.get(`/legal/${siteId}/delegations`).then((r) => r.data);
  return {
    items: (data?.items || []).map(delegationFromServer),
    total: data?.total ?? 0,
  };
}

export async function listMyLegalAssignments() {
  const data = await client.get('/legal/delegations/me').then((r) => r.data);
  return {
    items: (data?.items || []).map(delegationFromServer),
    total: data?.total ?? 0,
  };
}
