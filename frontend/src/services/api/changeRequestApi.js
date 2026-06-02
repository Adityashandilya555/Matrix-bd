// Cross-module change-request API client.
// BD opens requests to flip legal fields; legal supervisor approves/rejects.
//
// Endpoints used:
//   GET  /bd/sites/{site_id}/legal-status       (BD view-status page)
//   GET  /bd/dd-failed                          (BD due-diligence-failed tab)
//   POST /bd/change-requests                    (BD opens a change request)
//   GET  /bd/change-requests/mine               (BD lists own requests)
//   GET  /legal/change-requests/pending         (Legal queue tab)
//   POST /legal/change-requests/{id}/approve    (Legal supervisor approves)
//   POST /legal/change-requests/{id}/reject     (Legal supervisor rejects)

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
    const detail = err.response?.data?.detail || err.message || 'Request failed';
    if (status === 401) clearAuthToken();
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

// ── Response shaping (snake → camel) ────────────────────────────────────────

function changeRequestFromServer(row) {
  if (!row) return row;
  return {
    id:                row.id,
    siteId:            row.site_id,
    siteCode:          row.site_code,
    siteName:          row.site_name,
    targetTable:       row.target_table,
    fieldName:         row.field_name,
    currentValue:      row.current_value,
    requestedValue:    row.requested_value,
    justification:     row.justification,
    status:            row.status,
    requestedBy:       row.requested_by,
    requestedByName:   row.requested_by_name,
    reviewedBy:        row.reviewed_by,
    reviewedByName:    row.reviewed_by_name,
    reviewerNote:      row.reviewer_note,
    createdAt:         row.created_at,
    reviewedAt:        row.reviewed_at,
  };
}

function bdSiteStatusFromServer(row) {
  if (!row) return row;
  return {
    siteId:           row.site_id,
    siteCode:         row.site_code,
    siteName:         row.site_name,
    city:             row.city,
    siteStatus:       row.site_status,
    legalDdStatus:    row.legal_dd_status,
    agreementStatus:  row.agreement_status,
    licensingStatus:  row.licensing_status,
    dd:               row.dd        ? { ...row.dd } : null,
    agreement:        row.agreement ? { ...row.agreement } : null,
    licensing:        row.licensing ? { ...row.licensing } : null,
    submittedBy:      row.submitted_by,
    submittedByName:  row.submitted_by_name,
    changeRequests:   (row.change_requests || []).map(changeRequestFromServer),
  };
}

function ddFailedItemFromServer(row) {
  return {
    siteId:            row.site_id,
    siteCode:          row.site_code,
    siteName:          row.site_name,
    city:              row.city,
    submittedByName:   row.submitted_by_name,
    rejectionReason:   row.rejection_reason,
    legalRejectedAt:   row.legal_rejected_at,
  };
}

// ── BD reads ────────────────────────────────────────────────────────────────

export async function getBdSiteStatus(siteId) {
  const data = await client.get(`/bd/sites/${siteId}/legal-status`).then((r) => r.data);
  return bdSiteStatusFromServer(data);
}

export async function getDdFailedQueue() {
  const data = await client.get('/bd/dd-failed').then((r) => r.data);
  return {
    items: (data.items || []).map(ddFailedItemFromServer),
    total: data.total ?? 0,
  };
}

export async function listMyChangeRequests() {
  const data = await client.get('/bd/change-requests/mine').then((r) => r.data);
  return {
    items: (data.items || []).map(changeRequestFromServer),
    total: data.total ?? 0,
  };
}

// ── BD writes ───────────────────────────────────────────────────────────────

export async function createChangeRequest({
  siteId, targetTable, fieldName, requestedValue, justification,
}) {
  const body = {
    site_id: siteId,
    target_table: targetTable,
    field_name: fieldName,
    requested_value: requestedValue,
  };
  if (justification) body.justification = justification;
  const data = await client.post('/bd/change-requests', body).then((r) => r.data);
  notifySiteDataChanged({ action: 'create_change_request', siteId });
  return changeRequestFromServer(data);
}

// ── Legal reads ─────────────────────────────────────────────────────────────

export async function listPendingChangeRequests() {
  const data = await client.get('/legal/change-requests/pending').then((r) => r.data);
  return {
    items: (data.items || []).map(changeRequestFromServer),
    total: data.total ?? 0,
  };
}

// ── Legal writes ────────────────────────────────────────────────────────────

export async function approveChangeRequest(requestId, { reviewerNote } = {}) {
  const body = {};
  if (reviewerNote) body.reviewer_note = reviewerNote;
  const data = await client.post(`/legal/change-requests/${requestId}/approve`, body).then((r) => r.data);
  notifySiteDataChanged({ action: 'approve_change_request', requestId });
  return changeRequestFromServer(data);
}

export async function rejectChangeRequest(requestId, { reviewerNote } = {}) {
  const body = {};
  if (reviewerNote) body.reviewer_note = reviewerNote;
  const data = await client.post(`/legal/change-requests/${requestId}/reject`, body).then((r) => r.data);
  notifySiteDataChanged({ action: 'reject_change_request', requestId });
  return changeRequestFromServer(data);
}
