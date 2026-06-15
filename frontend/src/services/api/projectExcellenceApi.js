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
    const raw = err.response?.data?.detail || err.message || 'Request failed';
    const detail = status === 0 && raw === 'Network Error'
      ? `Network Error contacting API at ${BASE_URL}. Check backend deployment, CORS, and that the backend is running.`
      : raw;
    if (status === 401 && requestCarriedToken(err.config)) notifySessionExpired({ reason: 'unauthorized', detail });
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

function budgetItemFromServer(row) {
  return { id: row.id, idx: row.idx, label: row.label, amount: row.amount };
}

function queueItemFromServer(row) {
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    projectStatus: row.project_status,
    excellenceStatus: row.excellence_status,
    budgetStatus: row.budget_status,
    allocatedToName: row.allocated_to_name,
    submittedByName: row.submitted_by_name,
    budgetTotal: row.budget_total,
  };
}

function stateFromServer(row) {
  if (!row) return row;
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    tenantId: row.tenant_id,
    submittedByName: row.submitted_by_name,
    siteStatus: row.site_status,
    projectStatus: row.project_status,
    excellenceStatus: row.excellence_status,
    currentStage: row.current_stage,
    allocatedTo: row.allocated_to,
    allocatedToName: row.allocated_to_name,
    budgetStatus: row.budget_status,
    budgetTotal: row.budget_total,
    totalIndoorAreaSqft: row.total_indoor_area_sqft,
    totalAreaSqft: row.total_area_sqft,
    covers: row.covers,
    budgetItems: (row.budget_items || []).map(budgetItemFromServer),
    budgetSupervisorComments: row.budget_supervisor_comments,
    budgetAdminComments: row.budget_admin_comments,
    updatedAt: row.updated_at,
  };
}

function delegationFromServer(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    module: row.module,
    delegateUserId: row.delegate_user_id,
    delegateEmail: row.delegate_email,
    delegateName: row.delegate_name,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    notes: row.notes,
  };
}

export async function getPEQueue() {
  const data = await client.get('/project-excellence/queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function getPE(siteId) {
  const data = await client.get(`/project-excellence/${siteId}`).then((r) => r.data);
  return stateFromServer(data);
}

export async function listPEDelegations(siteId) {
  const data = await client.get(`/project-excellence/${siteId}/delegations`).then((r) => r.data);
  return { items: (data.items || []).map(delegationFromServer), total: data.total ?? 0 };
}

export async function allocatePE(siteId, executiveId, notes) {
  const body = { executive_id: executiveId };
  if (notes) body.notes = notes;
  const data = await client.post(`/project-excellence/${siteId}/allocate`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: 'allocate', siteId });
  return stateFromServer(data);
}

const toNumberOrNull = (value) =>
  value === '' || value == null ? null : Number(value);

export async function savePEBudget(siteId, { items, action = 'save', totalIndoorAreaSqft, totalAreaSqft, covers }) {
  const data = await client.post(`/project-excellence/${siteId}/budget`, {
    action,
    items: (items || []).map((item) => ({
      idx: Number(item.idx),
      label: item.label || null,
      amount: toNumberOrNull(item.amount),
    })),
    total_indoor_area_sqft: toNumberOrNull(totalIndoorAreaSqft),
    total_area_sqft: toNumberOrNull(totalAreaSqft),
    covers: toNumberOrNull(covers),
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: `budget_${action}`, siteId });
  return stateFromServer(data);
}

export async function reviewPEBudget(siteId, { decision, comments }) {
  const data = await client.post(`/project-excellence/${siteId}/budget/review`, {
    decision, comments: comments || null,
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: 'budget_supervisor_review', siteId });
  return stateFromServer(data);
}

export async function getPEBudgetAdminQueue() {
  const data = await client.get('/project-excellence/budget-admin-queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function adminReviewPEBudget(siteId, { decision, comments }) {
  const data = await client.post(`/project-excellence/${siteId}/budget/admin-review`, {
    decision, comments: comments || null,
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: 'budget_admin_review', siteId });
  return stateFromServer(data);
}

// ── Quality-audit completion (PE supervisor is the final sign-off) ────────────
// The queue returns Project-module queue items (quality_audit_status + completion
// date), so map those field names rather than the PE budget shape.
function qaItemFromServer(row) {
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    qualityAuditStatus: row.quality_audit_status,
    inspectionDate: row.inspection_date,
    projectCompletedAt: row.project_completed_at,
    allocatedToName: row.allocated_to_name,
    submittedByName: row.submitted_by_name,
  };
}

export async function getPEQualityAuditQueue() {
  const data = await client.get('/project-excellence/quality-audit/queue').then((r) => r.data);
  return { items: (data.items || []).map(qaItemFromServer), total: data.total ?? 0 };
}

export async function completePEQualityAudit(siteId) {
  const data = await client.post(`/project-excellence/${siteId}/quality-audit/complete`).then((r) => r.data);
  // 'project' so the Project module's NSO Handover tab refreshes too.
  notifySiteDataChanged({ source: 'project_excellence', action: 'quality_audit_completed', siteId });
  notifySiteDataChanged({ source: 'project', action: 'quality_audit_completed', siteId });
  return data;
}
