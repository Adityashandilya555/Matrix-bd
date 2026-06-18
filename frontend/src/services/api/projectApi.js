import { createApiClient } from './axiosClient.js';
import { notifySiteDataChanged } from './siteEvents.js';
import { toNumberOrNull } from './_utils.js';

const client = createApiClient();

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
    qualityAuditStatus: row.quality_audit_status,
    inspectionDate: row.inspection_date,
    projectCompletedAt: row.project_completed_at,
    allocatedToName: row.allocated_to_name,
    submittedByName: row.submitted_by_name,
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
    projectStatus: row.project_status,
    currentStage: row.current_stage,
    budgetStatus: row.budget_status,
    projectCompletedAt: row.project_completed_at,
    updatedAt: row.updated_at,
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
    totalIndoorAreaSqft: row.total_indoor_area_sqft,
    totalAreaSqft: row.total_area_sqft,
    covers: row.covers,
    budgetItems: (row.budget_items || []).map(budgetItemFromServer),
    budgetSupervisorComments: row.budget_supervisor_comments,
    budgetAdminComments: row.budget_admin_comments,
    initializationDate: row.initialization_date,
    initializationStatus: row.initialization_status,
    initializationComments: row.initialization_comments,
    expectedCompletionDate: row.expected_completion_date,
    expectedCompletionStatus: row.expected_completion_status,
    expectedCompletionComments: row.expected_completion_comments,
    midProjectVisitDate: row.mid_project_visit_date,
    inspectionDate: row.inspection_date,
    qualityAuditStatus: row.quality_audit_status,
    qualityAuditComments: row.quality_audit_comments,
    qualityAuditSupervisorApprovedAt: row.quality_audit_supervisor_approved_at,
    qualityAuditAdminConfirmedAt: row.quality_audit_admin_confirmed_at,
    qualityAuditAdminNotes: row.quality_audit_admin_notes,
    finalCompletionDate: row.final_completion_date,
    projectCompletedAt: row.project_completed_at,
    nsoStatus: row.nso_status,
    pushedToNsoAt: row.pushed_to_nso_at,
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

export async function listProjectHistory(statusFilter = 'all') {
  const data = await client.get('/project/history', { params: { status_filter: statusFilter } }).then((r) => r.data);
  return { items: (data.items || []).map(historyItemFromServer), total: data.total ?? 0 };
}

export async function getProject(siteId) {
  const data = await client.get(`/project/${siteId}`).then((r) => r.data);
  return stateFromServer(data);
}

export async function getProjectHistoryDetail(siteId) {
  const data = await client.get(`/project/history/${siteId}`).then((r) => r.data);
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

export async function saveProjectBudget(
  siteId,
  { items, action = 'save', totalIndoorAreaSqft, totalAreaSqft, covers },
) {
  const data = await client.post(`/project/${siteId}/budget`, {
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

// Executive accepts / rejects the admin-proposed initialization date.
// Supervisor proposes the initialization date when the PE handover left it
// unset (status still 'pending') — recovery path so the exchange can start.
export async function proposeInitialization(siteId, value) {
  const data = await client.post(`/project/${siteId}/initialization/propose`, { value }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'init_propose', siteId });
  return stateFromServer(data);
}

export async function respondInitialization(siteId, { decision, comments }) {
  const data = await client.post(`/project/${siteId}/initialization/respond`, { decision, comments: comments || null }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'init_respond', siteId });
  return stateFromServer(data);
}

// Supervisor sets the final initialization date after an executive rejection.
export async function finalizeInitialization(siteId, value) {
  const data = await client.post(`/project/${siteId}/initialization/finalize`, { value }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'init_finalize', siteId });
  return stateFromServer(data);
}

// Supervisor sets the mid-project visit date.
export async function setMidProjectVisit(siteId, value) {
  const data = await client.post(`/project/${siteId}/mid-project-visit`, { value }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'mid_visit', siteId });
  return stateFromServer(data);
}

// Executive records the quality-audit inspection DATE (calendar, no document).
export async function submitQualityAuditInspectionDate(siteId, value) {
  const data = await client.post(`/project/${siteId}/quality-audit/inspection-date`, { value }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'quality_inspection_date', siteId });
  return stateFromServer(data);
}

// First tier: project supervisor approves the inspection date.
export async function supervisorApproveQualityAudit(siteId, { decision, comments }) {
  const data = await client.post(`/project/${siteId}/quality-audit/supervisor-approve`, { decision, comments: comments || null }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'quality_supervisor_review', siteId });
  return stateFromServer(data);
}

// Second tier: business_admin confirms → project completes.
export async function adminConfirmQualityAudit(siteId, { decision, comments, adminNotes }) {
  const data = await client.post(`/project/${siteId}/quality-audit/admin-confirm`, {
    decision, comments: comments || null, admin_notes: adminNotes || null,
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'quality_admin_confirm', siteId });
  return stateFromServer(data);
}

export async function getNsoQueue() {
  const data = await client.get('/project/nso-queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

// NSO Handover tab — project-completed sites awaiting the supervisor's push to NSO.
export async function getNsoHandoverQueue() {
  const data = await client.get('/project/nso-handover').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

// Supervisor pushes a project-completed site into NSO (opens the record at stage three).
export async function pushToNso(siteId) {
  const data = await client.post(`/project/${siteId}/push-to-nso`, {}).then((r) => r.data);
  notifySiteDataChanged({ source: 'project', action: 'push_to_nso', siteId });
  return stateFromServer(data);
}
