// Design module API client — talks to backend/app/routers/design.py.
// snake_case wire ↔ camelCase React, mirroring legalApi.js / legalDelegationApi.js.
//
// Endpoints:
//   GET    /design/queue
//   GET    /design/{site_id}
//   GET    /design/{site_id}/delegations
//   POST   /design/{site_id}/allocate                    {executive_id, notes?}   (supervisor)
//   DELETE /design/{site_id}/allocate/{user_id}                                   (supervisor)
//   POST   /design/{site_id}/deliverables/{kind}         {file_url?, file_name?, estimated_amount?}
//   POST   /design/{site_id}/deliverables/{kind}/review  {decision, comments?}    (supervisor)
//   GET    /design/gfc-queue                                                      (business_admin)
//   GET    /design/gfc/{site_id}                                                  (business_admin)
//   POST   /design/gfc/{site_id}                         {decision, comments?}    (business_admin)

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
    // A bare axios "Network Error" (no HTTP response) almost always means CORS
    // or the backend being unreachable — surface that instead of a cryptic string.
    const detail = status === 0 && raw === 'Network Error'
      ? `Network Error contacting API at ${BASE_URL}. Check backend deployment, CORS (Railway CORS_ORIGINS must include this site's domain), and that the backend is running.`
      : raw;
    if (status === 401) clearAuthToken();
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

// ── Response shaping (snake → camel) ────────────────────────────────────────

function queueItemFromServer(row) {
  return {
    siteId:          row.site_id,
    siteCode:        row.site_code,
    siteName:        row.site_name,
    city:            row.city,
    designStatus:    row.design_status,
    currentStage:    row.current_stage,
    legalDdStatus:   row.legal_dd_status,
    allocatedToName: row.allocated_to_name,
    submittedByName: row.submitted_by_name,
  };
}

function deliverableFromServer(d) {
  return {
    kind:               d.kind,
    status:             d.status,
    fileUrl:            d.file_url,
    fileName:           d.file_name,
    estimatedAmount:    d.estimated_amount,
    supervisorComments: d.supervisor_comments,
    submittedBy:        d.submitted_by,
    submittedAt:        d.submitted_at,
    reviewedBy:         d.reviewed_by,
    reviewedAt:         d.reviewed_at,
    adminStatus:        d.admin_status,
    adminComments:      d.admin_comments,
    downloadUrl:        d.download_url,
    updatedAt:          d.updated_at,
  };
}

function adminQueueSiteFromServer(s) {
  return {
    siteId:   s.site_id,
    siteCode: s.site_code,
    siteName: s.site_name,
    city:     s.city,
    deliverables: (s.deliverables || []).map((d) => ({
      kind:        d.kind,
      status:      d.status,
      fileName:    d.file_name,
      downloadUrl: d.download_url,
      submittedAt: d.submitted_at,
    })),
  };
}

function reviewFromServer(row) {
  if (!row) return row;
  return {
    siteId:          row.site_id,
    siteCode:        row.site_code,
    siteName:        row.site_name,
    city:            row.city,
    submittedByName: row.submitted_by_name,
    tenantId:        row.tenant_id,
    siteStatus:      row.site_status,
    designStatus:    row.design_status,
    legalDdStatus:   row.legal_dd_status,
    currentStage:    row.current_stage,
    gfcStatus:       row.gfc_status,
    gfcComments:     row.gfc_comments,
    gfcDecidedAt:    row.gfc_decided_at,
    deliverables:    (row.deliverables || []).map(deliverableFromServer),
  };
}

function delegationFromServer(row) {
  if (!row) return row;
  return {
    id:             row.id,
    siteId:         row.site_id,
    module:         row.module,
    delegateUserId: row.delegate_user_id,
    delegateEmail:  row.delegate_email,
    delegateName:   row.delegate_name,
    grantedBy:      row.granted_by,
    grantedAt:      row.granted_at,
    notes:          row.notes,
  };
}

function gfcQueueItemFromServer(row) {
  return {
    siteId:             row.site_id,
    siteCode:           row.site_code,
    siteName:           row.site_name,
    city:               row.city,
    boqEstimatedAmount: row.boq_estimated_amount,
    submittedByName:    row.submitted_by_name,
  };
}

function historyItemFromServer(row) {
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    submittedByName: row.submitted_by_name,
    designStatus: row.design_status,
    currentStage: row.current_stage,
    gfcStatus: row.gfc_status,
    legalDdStatus: row.legal_dd_status,
    financeStatus: row.finance_status,
    updatedAt: row.updated_at,
  };
}

// ── Queue / read ────────────────────────────────────────────────────────────

export async function getDesignQueue() {
  const data = await client.get('/design/queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function getDesignReview(siteId) {
  const data = await client.get(`/design/${siteId}`).then((r) => r.data);
  return reviewFromServer(data);
}

export async function listDesignHistory(statusFilter = 'all') {
  const data = await client.get('/design/history', { params: { status_filter: statusFilter } }).then((r) => r.data);
  return { items: (data.items || []).map(historyItemFromServer), total: data.total ?? 0 };
}

export async function listDesignDelegationsForSite(siteId) {
  const data = await client.get(`/design/${siteId}/delegations`).then((r) => r.data);
  return { items: (data?.items || []).map(delegationFromServer), total: data?.total ?? 0 };
}

// ── Allocation (supervisor) ─────────────────────────────────────────────────

export async function allocateDesign(siteId, executiveId, notes) {
  const body = { executive_id: executiveId };
  if (notes) body.notes = notes;
  const data = await client.post(`/design/${siteId}/allocate`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'design', action: 'allocate', siteId });
  return reviewFromServer(data);
}

export async function revokeDesignAllocation(siteId, userId) {
  const data = await client.delete(`/design/${siteId}/allocate/${userId}`).then((r) => r.data);
  notifySiteDataChanged({ source: 'design', action: 'revoke_allocation', siteId });
  return data; // { ok, message }
}

// ── Deliverables ────────────────────────────────────────────────────────────

export async function submitDeliverable(siteId, kind, { fileUrl, fileName, estimatedAmount } = {}) {
  const body = {};
  if (fileUrl != null && fileUrl !== '') body.file_url = fileUrl;
  if (fileName != null && fileName !== '') body.file_name = fileName;
  if (estimatedAmount != null && estimatedAmount !== '') body.estimated_amount = Number(estimatedAmount);
  const data = await client.post(`/design/${siteId}/deliverables/${kind}`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'design', action: 'submit_deliverable', siteId });
  return reviewFromServer(data);
}

export async function reviewDeliverable(siteId, kind, { decision, comments }) {
  const body = { decision };
  if (comments) body.comments = comments;
  const data = await client.post(`/design/${siteId}/deliverables/${kind}/review`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'design', action: 'review_deliverable', siteId });
  return reviewFromServer(data);
}

// ── Business-admin GFC gate ─────────────────────────────────────────────────

export async function getDesignGfcQueue() {
  const data = await client.get('/design/gfc-queue').then((r) => r.data);
  return { items: (data.items || []).map(gfcQueueItemFromServer), total: data.total ?? 0 };
}

export async function getDesignGfcReview(siteId) {
  const data = await client.get(`/design/gfc/${siteId}`).then((r) => r.data);
  return reviewFromServer(data);
}

export async function decideGfc(siteId, { decision, comments }) {
  const body = { decision };
  if (comments) body.comments = comments;
  const data = await client.post(`/design/gfc/${siteId}`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'design', action: 'gfc_decision', siteId });
  return reviewFromServer(data);
}

// ── Document upload (recce / 2d / 3d) ────────────────────────────────────────

// Uploads carry the file body to the backend, which then relays it to Supabase
// Storage (its own 30s budget) before responding. The default 20s client
// timeout fires first on big files / slow links, so axios reports a bare
// "Network Error" while the upload actually completes server-side — the user
// re-uploads needlessly. Give uploads their own, much larger budget.
const UPLOAD_TIMEOUT_MS = Number(import.meta.env.VITE_UPLOAD_TIMEOUT_MS ?? 120000);

export async function uploadDeliverable(siteId, kind, file) {
  const form = new FormData();
  form.append('file', file);
  // axios sets the multipart Content-Type (with boundary) automatically for FormData.
  const data = await client
    .post(`/design/${siteId}/deliverables/${kind}/upload`, form, { timeout: UPLOAD_TIMEOUT_MS })
    .then((r) => r.data);
  notifySiteDataChanged({ source: 'design', action: 'upload_deliverable', siteId });
  return reviewFromServer(data);
}

// ── Business-admin 2D/3D approval (second tier) ──────────────────────────────

export async function getDesignAdminQueue() {
  const data = await client.get('/design/admin-queue').then((r) => r.data);
  return { items: (data.items || []).map(adminQueueSiteFromServer), total: data.total ?? 0 };
}

export async function adminReviewDeliverable(siteId, kind, { decision, comments }) {
  const body = { decision };
  if (comments) body.comments = comments;
  const data = await client.post(`/design/${siteId}/deliverables/${kind}/admin-review`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'design', action: 'admin_review_deliverable', siteId });
  return reviewFromServer(data);
}
