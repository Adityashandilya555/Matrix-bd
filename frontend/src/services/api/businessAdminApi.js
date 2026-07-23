// Business-admin portal API client. Isolated axios instance (mirrors designApi.js)
// so the /business-admin surface owns its own data access. snake_case wire ↔
// camelCase React. All routes require the business_admin JWT (sent via the
// shared authToken, attached by the request interceptor).
//
// Endpoints:
//   GET  /business-admin/finance-queue                 → sites awaiting payment approval
//   GET  /business-admin/org                           → dept code + supervisors/executives
//   GET  /project/budget-admin-queue                   → sites awaiting budget approval
//   POST /project/{site_id}/budget/admin-review        → budget decision
//   POST /sites/{site_id}/finance/approve              → finance final approval
//   GET  /sites                                        → all tenant sites (admin read)
//   GET  /sites/{site_id}/activity                     → cross-module history feed

import { createApiClient } from './axiosClient.js';
import { notifySiteDataChanged } from './siteEvents.js';

const client = createApiClient();

const num = (v) => (v != null ? Number(v) : null);

// ── Payment / finance approvals ──────────────────────────────────────────────

export async function getFinanceQueue() {
  // main exposes the admin finance queue as a bare list at /business-admin/finance-approvals
  const d = await client.get('/business-admin/finance-approvals').then((r) => r.data);
  const arr = Array.isArray(d) ? d : (d.items || []);
  return {
    items: arr
      .filter((r) => r.finance_status === 'awaiting_admin')
      .map((r) => ({
        siteId: r.site_id, siteCode: r.site_code, siteName: r.site_name, city: r.city,
        caCode: r.ca_code,
        kycVerified: Boolean(r.kyc_verified),
        financeAmount: num(r.finance_amount),
        submittedByName: r.submitted_by_name,
        legalDdStatus: r.legal_dd_status,
        agreementStatus: r.agreement_status,
        licensingStatus: r.licensing_status,
      })),
    total: arr.length,
  };
}

export async function approveFinance(siteId) {
  const result = await client.post(`/business-admin/finance-approvals/${siteId}/approve`).then((r) => r.data);
  notifySiteDataChanged({ source: 'businessAdmin', action: 'finance_approved', siteId });
  return result;
}

// Sends the request back for correction: awaiting_admin → pending (fields unlock
// so the executive can fix KYC / CA code / token amount and re-request).
export async function rejectFinance(siteId, reason) {
  const body = reason ? { reason } : {};
  const result = await client.post(`/business-admin/finance-approvals/${siteId}/reject`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'businessAdmin', action: 'finance_rejected', siteId });
  return result;
}

// ── Project budget approvals ─────────────────────────────────────────────────

export async function getBudgetQueue() {
  const d = await client.get('/project-excellence/budget-admin-queue').then((r) => r.data);
  return {
    items: (d.items || []).map((r) => ({
      siteId: r.site_id, siteCode: r.site_code, siteName: r.site_name, city: r.city,
      budgetStatus: r.budget_status,
      budgetTotal: num(r.budget_total),
      totalIndoorAreaSqft: num(r.total_indoor_area_sqft),
      totalAreaSqft: num(r.total_area_sqft),
      covers: num(r.covers),
      submittedByName: r.submitted_by_name,
    })),
    total: d.total ?? 0,
  };
}

export async function reviewBudget(siteId, { decision, comments, initializationDate } = {}) {
  // The 11-field budget now lives in Project Excellence (post-GFC); the admin
  // tier-2 review targets that module. On approval the admin also sets the
  // project initialization date, which seeds the Project module's
  // initialization (proposed → exec accepts) — forward it so it isn't dropped.
  const body = { decision };
  if (comments) body.comments = comments;
  if (initializationDate) body.initialization_date = initializationDate;
  const result = await client.post(`/project-excellence/${siteId}/budget/admin-review`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'businessAdmin', action: `budget_${decision}`, siteId });
  return result;
}

// Full budget breakdown for the approval drawer — Business Admin-safe detail
// route, separate from the active Project module route.
export async function fetchBudgetDetail(siteId) {
  const d = await client.get(`/project-excellence/budget-admin-detail/${siteId}`).then((r) => r.data);
  return {
    siteId: d.site_id,
    siteCode: d.site_code,
    siteName: d.site_name,
    city: d.city,
    submittedByName: d.submitted_by_name,
    budgetStatus: d.budget_status,
    items: (d.budget_items || []).map((r) => ({ idx: r.idx, label: r.label, amount: num(r.amount) })),
    budgetTotal: num(d.budget_total),
    totalIndoorAreaSqft: num(d.total_indoor_area_sqft),
    totalAreaSqft: num(d.total_area_sqft),
    covers: num(d.covers),
    budgetSupervisorComments: d.budget_supervisor_comments,
    budgetAdminComments: d.budget_admin_comments,
    updatedAt: d.updated_at,
  };
}

// A phase's budget attachments (kind='excellence' from PE, 'closure' from
// Financial Closure) — shown read-only in the approval drawer so the admin can
// open exactly what was submitted. business_admin passes the role-gated
// documents endpoint (DocMember) for both kinds.
export async function fetchBudgetDocuments(siteId, kind = 'excellence') {
  const d = await client
    .get(`/project-excellence/${siteId}/documents`, { params: { kind } })
    .then((r) => r.data);
  return (d.documents || []).map((r) => ({
    id: r.id,
    fileName: r.file_name,
    fileSizeKb: r.file_size_kb,
    mimeType: r.mime_type,
    url: r.url,
  }));
}

// ── Quality-audit confirmation (business-admin, second tier) ─────────────────

export async function getQualityAuditQueue() {
  const d = await client.get('/project/quality-audit/admin-queue').then((r) => r.data);
  return {
    items: (d.items || []).map((r) => ({
      siteId: r.site_id, siteCode: r.site_code, siteName: r.site_name, city: r.city,
      inspectionDate: r.inspection_date,
      submittedByName: r.submitted_by_name,
    })),
    total: d.total ?? 0,
  };
}

export async function confirmQualityAudit(siteId, { decision, comments } = {}) {
  const body = { decision };
  if (comments) body.comments = comments;
  const result = await client.post(`/project/${siteId}/quality-audit/admin-confirm`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'businessAdmin', action: `quality_${decision}`, siteId });
  return result;
}

// ── Financial closure (business-admin finalize) ──────────────────────────────

export async function getClosureAdminQueue() {
  const d = await client.get('/financial-closure/admin-queue').then((r) => r.data);
  return {
    items: (d.items || []).map((r) => ({
      siteId: r.site_id, siteCode: r.site_code, siteName: r.site_name, city: r.city,
      closureStatus: r.closure_status,
      gfcBudgetTotal: num(r.gfc_budget_total),
      closureBudgetTotal: num(r.closure_budget_total),
      variationTotal: num(r.variation_total),
      submittedByName: r.submitted_by_name,
    })),
    total: d.total ?? 0,
  };
}

export async function finalizeClosure(siteId, { decision, comments } = {}) {
  const body = { decision };
  if (comments) body.comments = comments;
  const result = await client.post(`/financial-closure/${siteId}/finalize`, body).then((r) => r.data);
  notifySiteDataChanged({ source: 'businessAdmin', action: `closure_${decision}`, siteId });
  return result;
}

// Full closure breakdown for the approval drawer — the 11 GFC/closure/variation
// lines + totals + area/covers, from the existing Business-Admin-safe detail
// route (mirrors fetchBudgetDetail for the PE budget).
export async function fetchClosureDetail(siteId) {
  const d = await client.get(`/financial-closure/admin-detail/${siteId}`).then((r) => r.data);
  return {
    siteId: d.site_id,
    closureStatus: d.closure_status,
    submittedByName: d.submitted_by_name,
    lines: (d.lines || []).map((r) => ({
      idx: r.idx, label: r.label,
      gfcAmount: num(r.gfc_amount), closureAmount: num(r.closure_amount), variation: num(r.variation),
    })),
    gfcBudgetTotal: num(d.gfc_budget_total),
    closureBudgetTotal: num(d.closure_budget_total),
    variationTotal: num(d.variation_total),
    totalIndoorAreaSqft: num(d.total_indoor_area_sqft),
    totalAreaSqft: num(d.total_area_sqft),
    covers: num(d.covers),
    supervisorComments: d.supervisor_comments,
    adminComments: d.admin_comments,
  };
}

// The before/after quality-audit report PDFs (signed URLs) for the closure
// review card — actor-agnostic service behind a Business-Admin-gated route.
export async function fetchClosureQAReports(siteId) {
  const d = await client.get(`/financial-closure/admin-detail/${siteId}/qa-reports`).then((r) => r.data);
  const map = (r) => (r ? { kind: r.kind, fileName: r.file_name, uploadedAt: r.uploaded_at, pushedAt: r.pushed_at, downloadUrl: r.download_url } : null);
  return { before: map(d.before), after: map(d.after) };
}

// ── Department org tree ──────────────────────────────────────────────────────

export async function getOrg() {
  const d = await client.get('/business-admin/org').then((r) => r.data);
  const person = (p) => ({ id: p.id, email: p.email, name: p.name, joinedAt: p.joined_at });
  // Returns a bare array of dept modules (consumed via the shell's queue hook).
  return (d.modules || []).map((m) => ({
    module: m.module,
    code: m.code ?? null,
    supervisors: (m.supervisors || []).map((s) => ({ ...person(s), executives: (s.executives || []).map(person) })),
    unassignedExecutives: (m.unassigned_executives || []).map(person),
    // Supervisor-only modules (NSO) hide all executive UI.
    executivesEnabled: m.executives_enabled !== false,
  }));
}

// ── All sites + per-site cross-module history ────────────────────────────────

const PAGE_SIZE = 200;

function _mapSiteRow(s) {
  return {
    siteId: s.site_id, siteCode: s.site_code || '', siteName: s.site_name, city: s.city, status: s.site_status,
    createdByName: s.submitted_by_name, assignedToName: s.assigned_to_name,
    legalDdStatus: s.legal_dd_status, agreementStatus: s.agreement_status, licensingStatus: s.licensing_status,
    designStatus: s.design_status, projectStatus: s.project_status, financeStatus: s.finance_status,
    nsoStatus: s.nso_status, launchStatus: s.launch_status, isLaunched: Boolean(s.is_launched),
  };
}

export async function getAllSites() {
  // Auto-paginate: fetch pages of PAGE_SIZE until we have all sites.
  const allItems = [];
  let total = 0;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const d = await client.get('/business-admin/sites', { params: { limit: PAGE_SIZE, offset } }).then((r) => r.data);
    const pageItems = (d.items || []).map(_mapSiteRow);
    allItems.push(...pageItems);
    total = d.total ?? allItems.length;

    // Stop when we've fetched everything or the server returned fewer than a full page
    if (allItems.length >= total || pageItems.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { items: allItems, total };
}

// ── Undo: business-admin 2D/3D deliverable decisions ────────────────────────
//
// Only decisions the CALLING admin made and has not already undone come back
// here, because only they may undo one. An empty list means no Undo buttons.

export async function getReversibleActions(siteId) {
  const d = await client.get(`/design/${siteId}/reversible-actions`).then((r) => r.data);
  return {
    items: (d.items || []).map((r) => ({
      id: r.id,
      auditLogId: r.audit_log_id ?? null,
      action: r.action,
      entityType: r.entity_type,
      createdAt: r.created_at,
    })),
    total: d.total ?? 0,
  };
}

export async function undoAdminReview(siteId, reversibleId) {
  return client
    .post(`/design/${siteId}/reversible-actions/${reversibleId}/undo`)
    .then((r) => r.data);
}

export async function getSiteHistory(siteId) {
  // /audit/site/{id} already allows business_admin and returns the cross-module feed.
  const d = await client.get(`/audit/site/${siteId}`).then((r) => r.data);
  return {
    items: (d.items || []).map((e) => ({
      id: e.id, siteId: e.site_id, actor: e.actor, action: e.action,
      fromStatus: e.from_status ?? null, toStatus: e.to_status ?? null,
      fieldName: e.field_name ?? null, fromValue: e.from_value ?? null, toValue: e.to_value ?? null,
      detail: e.detail ?? null, createdAt: e.created_at,
    })),
    total: d.total ?? 0,
  };
}

export async function getAdminSiteDocuments(siteId) {
  // Aggregated documents (site_files + design deliverables) with signed URLs;
  // business_admin-gated and works even on closed sites.
  const d = await client.get(`/business-admin/sites/${siteId}/documents`).then((r) => r.data);
  return {
    siteId: d.site_id,
    documents: (d.documents || []).map((it) => ({
      id: it.id, fileName: it.file_name, fileType: it.file_type, module: it.module,
      uploadedAt: it.uploaded_at, uploadedBy: it.uploaded_by, url: it.url,
    })),
  };
}

// ── Supervisor Executive Access Requests ─────────────────────────────────────

export async function getExecutiveRequests() {
  const d = await client.get('/business-admin/executive-requests').then((r) => r.data);
  return (d || []).map((r) => ({
    id: r.id,
    supervisorId: r.supervisor_id,
    supervisorEmail: r.supervisor_email,
    supervisorName: r.supervisor_name,
    module: r.module,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export async function approveExecutiveRequest(requestId) {
  const result = await client.post(`/business-admin/executive-requests/${requestId}/approve`).then((r) => r.data);
  notifySiteDataChanged({ source: 'businessAdmin', action: 'executive_request_approved' });
  return result;
}

export async function rejectExecutiveRequest(requestId) {
  const result = await client.post(`/business-admin/executive-requests/${requestId}/reject`).then((r) => r.data);
  notifySiteDataChanged({ source: 'businessAdmin', action: 'executive_request_rejected' });
  return result;
}
