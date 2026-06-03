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

function budgetItemFromServer(row) {
  return {
    id: row.id,
    idx: row.idx,
    label: row.label,
    amount: row.amount,
  };
}

function queueItemFromServer(row) {
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    designStatus: row.design_status,
    projectStatus: row.project_status,
    currentStage: row.current_stage,
    budgetStatus: row.budget_status,
    allocatedToName: row.allocated_to_name,
    submittedByName: row.submitted_by_name,
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
    designStatus: row.design_status,
    projectStatus: row.project_status,
    currentStage: row.current_stage,
    allocatedTo: row.allocated_to,
    allocatedToName: row.allocated_to_name,
    budgetStatus: row.budget_status,
    budgetTotal: row.budget_total,
    budgetItems: (row.budget_items || []).map(budgetItemFromServer),
    budgetSupervisorComments: row.budget_supervisor_comments,
    budgetAdminComments: row.budget_admin_comments,
    initializationDate: row.initialization_date,
    initializationStatus: row.initialization_status,
    initializationComments: row.initialization_comments,
    expectedCompletionDate: row.expected_completion_date,
    expectedCompletionStatus: row.expected_completion_status,
    expectedCompletionComments: row.expected_completion_comments,
    inspectionDate: row.inspection_date,
    qualityAuditStatus: row.quality_audit_status,
    qualityAuditComments: row.quality_audit_comments,
    finalCompletionDate: row.final_completion_date,
    projectCompletedAt: row.project_completed_at,
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

export async function getProjectQueue() {
  const data = await client.get('/project/queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function getProject(siteId) {
  const data = await client.get(`/project/${siteId}`).then((r) => r.data);
  return stateFromServer(data);
}

export async function listProjectDelegations(siteId) {
  const data = await client.get(`/project/${siteId}/delegations`).then((r) => r.data);
  return { items: (data.items || []).map(delegationFromServer), total: data.total ?? 0 };
}

export async function allocateProject(siteId, executiveId, notes) {
  const body = { executive_id: executiveId };
  if (notes) body.notes = notes;
  const data = await client.post(`/project/${siteId}/allocate`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'allocate', siteId });
  return stateFromServer(data);
}

export async function saveProjectBudget(siteId, { items, action = 'save' }) {
  const data = await client.post(`/project/${siteId}/budget`, {
    action,
    items: (items || []).map((item) => ({
      idx: Number(item.idx),
      label: item.label || null,
      amount: item.amount === '' || item.amount == null ? null : Number(item.amount),
    })),
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: `budget_${action}`, siteId });
  return stateFromServer(data);
}

export async function reviewProjectBudget(siteId, { decision, comments }) {
  const data = await client.post(`/project/${siteId}/budget/review`, { decision, comments: comments || null }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'budget_supervisor_review', siteId });
  return stateFromServer(data);
}

export async function getProjectBudgetAdminQueue() {
  const data = await client.get('/project/budget-admin-queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function adminReviewProjectBudget(siteId, { decision, comments }) {
  const data = await client.post(`/project/${siteId}/budget/admin-review`, { decision, comments: comments || null }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'budget_admin_review', siteId });
  return stateFromServer(data);
}

export async function submitProjectMilestone(siteId, field, value) {
  const data = await client.post(`/project/${siteId}/milestone/${field}`, { value }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'milestone_submit', siteId });
  return stateFromServer(data);
}

export async function reviewProjectMilestone(siteId, field, { decision, comments }) {
  const data = await client.post(`/project/${siteId}/milestone/${field}/review`, { decision, comments: comments || null }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'milestone_review', siteId });
  return stateFromServer(data);
}

export async function pushQualityAudit(siteId) {
  const data = await client.post(`/project/${siteId}/quality-audit/push`, {}).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'quality_push', siteId });
  return stateFromServer(data);
}

export async function reviewQualityAudit(siteId, { decision, comments }) {
  const data = await client.post(`/project/${siteId}/quality-audit/review`, { decision, comments: comments || null }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'quality_review', siteId });
  return stateFromServer(data);
}
