import { createApiClient } from './axiosClient.js';
import { notifySiteDataChanged } from './siteEvents.js';
import { toNumberOrNull } from './_utils.js';

const client = createApiClient();

function lineFromServer(row) {
  return {
    idx: row.idx,
    label: row.label,
    gfcAmount: row.gfc_amount,
    closureAmount: row.closure_amount,
    variation: row.variation,
  };
}

function queueItemFromServer(row) {
  return {
    siteId: row.site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    closureStatus: row.closure_status,
    financialClosureStatus: row.financial_closure_status,
    allocatedToName: row.allocated_to_name,
    submittedByName: row.submitted_by_name,
    gfcBudgetTotal: row.gfc_budget_total,
    closureBudgetTotal: row.closure_budget_total,
    variationTotal: row.variation_total,
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
    isLaunched: row.is_launched,
    financialClosureStatus: row.financial_closure_status,
    closureStatus: row.closure_status,
    allocatedTo: row.allocated_to,
    allocatedToName: row.allocated_to_name,
    gfcBudgetTotal: row.gfc_budget_total,
    closureBudgetTotal: row.closure_budget_total,
    variationTotal: row.variation_total,
    totalIndoorAreaSqft: row.total_indoor_area_sqft,
    totalAreaSqft: row.total_area_sqft,
    covers: row.covers,
    lines: (row.lines || []).map(lineFromServer),
    supervisorComments: row.supervisor_comments,
    adminComments: row.admin_comments,
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

export async function sendForFinancialClosure(siteId) {
  const data = await client.post(`/financial-closure/${siteId}/send`, {}).then((r) => r.data);
  notifySiteDataChanged({ source: 'financial_closure', action: 'send', siteId });
  return stateFromServer(data);
}

export async function getFCQueue({ limit, offset } = {}) {
  // limit/offset only travel when the caller supplies them (default page intact).
  const params = {};
  if (limit != null) params.limit = limit;
  if (offset != null) params.offset = offset;
  const data = await client.get('/financial-closure/queue', { params }).then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function getFC(siteId) {
  const data = await client.get(`/financial-closure/${siteId}`).then((r) => r.data);
  return stateFromServer(data);
}

export async function listFCDelegations(siteId) {
  const data = await client.get(`/financial-closure/${siteId}/delegations`).then((r) => r.data);
  return { items: (data.items || []).map(delegationFromServer), total: data.total ?? 0 };
}

export async function allocateFC(siteId, executiveId, notes) {
  const body = { executive_id: executiveId };
  if (notes) body.notes = notes;
  const data = await client.post(`/financial-closure/${siteId}/allocate`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'financial_closure', action: 'allocate', siteId });
  return stateFromServer(data);
}

export async function revokeFCAllocation(siteId, userId) {
  const data = await client.delete(`/financial-closure/${siteId}/allocate/${userId}`).then((r) => r.data);
  notifySiteDataChanged({ source: 'financial_closure', action: 'revoke', siteId });
  return data;
}

export async function saveFCBudget(siteId, { items, action = 'save', comments }) {
  const data = await client.post(`/financial-closure/${siteId}/budget`, {
    action,
    comments: comments || null,
    items: (items || []).map((item) => ({
      idx: Number(item.idx),
      label: item.label || null,
      amount: toNumberOrNull(item.amount),
    })),
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'financial_closure', action: `budget_${action}`, siteId });
  return stateFromServer(data);
}

export async function reviewFCBudget(siteId, { decision, comments }) {
  const data = await client.post(`/financial-closure/${siteId}/budget/review`, {
    decision, comments: comments || null,
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'financial_closure', action: 'supervisor_review', siteId });
  return stateFromServer(data);
}

export async function getFCAdminQueue() {
  const data = await client.get('/financial-closure/admin-queue').then((r) => r.data);
  return { items: (data.items || []).map(queueItemFromServer), total: data.total ?? 0 };
}

export async function getFCAdminDetail(siteId) {
  const data = await client.get(`/financial-closure/admin-detail/${siteId}`).then((r) => r.data);
  return stateFromServer(data);
}

export async function finalizeFinancialClosure(siteId, { decision, comments }) {
  const data = await client.post(`/financial-closure/${siteId}/finalize`, {
    decision, comments: comments || null,
  }).then((r) => r.data);
  notifySiteDataChanged({ source: 'financial_closure', action: 'finalize', siteId });
  return stateFromServer(data);
}
