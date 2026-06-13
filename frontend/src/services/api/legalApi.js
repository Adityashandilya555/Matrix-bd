// Legal/Payment module API client — talks to the FastAPI routes shipped in
// PR #4 (backend/app/routers/legal.py). The Pydantic schemas there use
// snake_case keys, so we translate at the wire boundary (mirroring the
// pattern in httpAdapter.js) and expose camelCase to React.
//
// Endpoints used:
//   GET  /legal/queue
//   GET  /legal/rejected-sites
//   GET  /legal/{site_id}
//   POST /legal/{site_id}/dd/items        (supervisor OR executive)
//   POST /legal/{site_id}/dd/finalize     (supervisor only)
//   POST /legal/{site_id}/agreement       (supervisor only)
//   POST /legal/{site_id}/licensing       (supervisor or delegated executive)

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

// ── Response shaping (snake → camel) ────────────────────────────────────────

function queueItemFromServer(row) {
  return {
    siteId:           row.site_id,
    siteCode:         row.site_code,
    siteName:         row.site_name,
    city:             row.city,
    legalDdStatus:    row.legal_dd_status,
    agreementStatus:  row.agreement_status,
    ddFinalVerdict:   row.dd_final_verdict,
    ddStage:          row.dd_stage || 'published',
    legalReviewAt:    row.legal_review_at,
    submittedByName:  row.submitted_by_name,
  };
}

function rejectedSiteFromServer(row) {
  return {
    siteId:          row.site_id,
    siteCode:        row.site_code,
    siteName:        row.site_name,
    city:            row.city,
    submittedByName: row.submitted_by_name,
    rejectionReason: row.rejection_reason,
    legalRejectedAt: row.legal_rejected_at,
  };
}

function historyItemFromServer(row) {
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    submittedByName: row.submitted_by_name,
    siteStatus: row.site_status,
    legalDdStatus: row.legal_dd_status,
    agreementStatus: row.agreement_status,
    licensingStatus: row.licensing_status,
    rejectionReason: row.rejection_reason,
    legalReviewAt: row.legal_review_at,
    legalApprovedAt: row.legal_approved_at,
    legalRejectedAt: row.legal_rejected_at,
    updatedAt: row.updated_at,
  };
}

function reviewFromServer(row) {
  if (!row) return row;
  // Surface the staging gate on each child row so the UI can render the chip
  // and gate edits/submits. Missing `stage` (pre-migration) → 'published'.
  const dd = row.dd ? { ...row.dd, stage: row.dd.stage || 'published' } : null;
  const licensing = row.licensing
    ? { ...row.licensing, stage: row.licensing.stage || 'published' }
    : null;
  return {
    siteId:           row.site_id,
    siteCode:         row.site_code,
    siteName:         row.site_name,
    city:             row.city,
    submittedByName:  row.submitted_by_name,
    tenantId:         row.tenant_id,
    siteStatus:       row.site_status,
    legalDdStatus:    row.legal_dd_status,
    agreementStatus:  row.agreement_status,
    licensingStatus:  row.licensing_status,
    dd,
    agreement:        row.agreement ? { ...row.agreement } : null,
    licensing,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getLegalQueue() {
  const data = await client.get('/legal/queue').then((r) => r.data);
  return {
    items: (data.items || []).map(queueItemFromServer),
    total: data.total ?? 0,
  };
}

export async function listLegalRejectedSites() {
  const data = await client.get('/legal/rejected-sites').then((r) => r.data);
  return {
    items: (data.items || []).map(rejectedSiteFromServer),
    total: data.total ?? 0,
  };
}

export async function listLegalHistory(statusFilter = 'all') {
  const data = await client.get('/legal/history', { params: { status_filter: statusFilter } }).then((r) => r.data);
  return {
    items: (data.items || []).map(historyItemFromServer),
    total: data.total ?? 0,
  };
}

export async function getLegalReview(siteId) {
  const data = await client.get(`/legal/${siteId}`).then((r) => r.data);
  return reviewFromServer(data);
}

// ── Writes ──────────────────────────────────────────────────────────────────

// Step 1 — supervisor OR executive may save individual DD items.
export async function saveDdItems(siteId, body) {
  const data = await client.post(`/legal/${siteId}/dd/items`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'save_dd', siteId });
  return reviewFromServer(data);
}

// Step 2 — supervisor only. Pass { finalVerdict, rejectionReason?, overrideReason? }.
export async function finalizeDd(siteId, { finalVerdict, rejectionReason, overrideReason }) {
  const body = { final_verdict: finalVerdict };
  if (rejectionReason) body.rejection_reason = rejectionReason;
  if (overrideReason) body.override_reason = overrideReason;
  const data = await client.post(`/legal/${siteId}/dd/finalize`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'finalize_dd', siteId });
  return reviewFromServer(data);
}

// Step 3 — supervisor only. Mark agreement signed/registered.
export async function saveAgreement(siteId, { signed, registered, documentUrl }) {
  const body = { signed: !!signed, registered: !!registered };
  if (documentUrl) body.document_url = documentUrl;
  const data = await client.post(`/legal/${siteId}/agreement`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'save_agreement', siteId });
  return reviewFromServer(data);
}

// Step 4 — supervisor or delegated executive. Supervisor all-yes saves publish
// licensing and auto-transition the site to LEGAL_APPROVED.
export async function saveLicensing(siteId, items) {
  const data = await client.post(`/legal/${siteId}/licensing`, items).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'save_licensing', siteId });
  return reviewFromServer(data);
}

// Stage submit — delegated executive (or supervisor) flips the DD checklist
// stage from 'draft' → 'pending_review'. Returns the refreshed review.
export async function submitDdForReview(siteId) {
  const data = await client.post(`/legal/${siteId}/dd/submit-for-review`).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'submit_dd_review', siteId });
  return reviewFromServer(data);
}

// Stage submit — same shape for the licensing row.
export async function submitLicensingForReview(siteId) {
  const data = await client.post(`/legal/${siteId}/licensing/submit-for-review`).then((r) => r.data);
  notifySiteDataChanged({ source: 'legalApi', action: 'submit_licensing_review', siteId });
  return reviewFromServer(data);
}
