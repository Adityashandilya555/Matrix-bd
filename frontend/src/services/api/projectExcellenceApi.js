import { createApiClient, UPLOAD_TIMEOUT_MS } from './axiosClient.js';
import { notifySiteDataChanged } from './siteEvents.js';
import { toNumberOrNull } from './_utils.js';

const client = createApiClient();

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

export async function getPEQueue({ limit, offset } = {}) {
  // limit/offset only travel when the caller supplies them (default page intact).
  const params = {};
  if (limit != null) params.limit = limit;
  if (offset != null) params.offset = offset;
  const data = await client.get('/project-excellence/queue', { params }).then((r) => r.data);
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

export async function revokePEAllocation(siteId, userId) {
  const data = await client.delete(`/project-excellence/${siteId}/allocate/${userId}`).then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: 'revoke_allocation', siteId });
  return data;
}

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
    qaBeforeUploadedAt: row.qa_before_uploaded_at,
    qaBeforePushedAt: row.qa_before_pushed_at,
    qaAfterUploadedAt: row.qa_after_uploaded_at,
    qaAfterPushedAt: row.qa_after_pushed_at,
    qaReportUnread: row.qa_report_unread,
    qaReportDelegateName: row.qa_report_delegate_name,
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

// ── Quality-audit reports (before/after PDFs) ────────────────────────────────
export async function uploadQAReport(siteId, kind, file) {
  const form = new FormData();
  form.append('file', file);
  const data = await client
    .post(`/project-excellence/${siteId}/quality-audit/report/${kind}/upload`, form, { timeout: UPLOAD_TIMEOUT_MS })
    .then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: 'qa_report_upload', siteId });
  return data;
}

export async function pushQAReport(siteId, kind) {
  const data = await client.post(`/project-excellence/${siteId}/quality-audit/report/${kind}/push`).then((r) => r.data);
  // 'project' so the NSO Handover tab (View button / push gating) refreshes too.
  notifySiteDataChanged({ source: 'project_excellence', action: 'qa_report_push', siteId });
  notifySiteDataChanged({ source: 'project', action: 'qa_report_push', siteId });
  return data;
}

export async function listQADelegations(siteId) {
  const data = await client.get(`/project-excellence/${siteId}/quality-audit/delegations`).then((r) => r.data);
  return { items: (data.items || []).map(delegationFromServer), total: data.total ?? 0 };
}

export async function allocateQA(siteId, executiveId, notes) {
  const data = await client
    .post(`/project-excellence/${siteId}/quality-audit/allocate`, { executive_id: executiveId, notes })
    .then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: 'qa_allocate', siteId });
  return data;
}

export async function revokeQAAllocation(siteId, userId) {
  const data = await client
    .delete(`/project-excellence/${siteId}/quality-audit/allocate/${userId}`)
    .then((r) => r.data);
  notifySiteDataChanged({ source: 'project_excellence', action: 'qa_revoke_allocation', siteId });
  return data;
}
