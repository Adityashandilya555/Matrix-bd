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

import axios from 'axios';
import { getAuthToken, clearAuthToken } from './authToken.js';
import { ApiError } from './adapters/httpAdapter.js';

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
        caCode: r.ca_code, financeAmount: num(r.finance_amount), submittedByName: r.submitted_by_name,
      })),
    total: arr.length,
  };
}

export async function approveFinance(siteId) {
  return client.post(`/business-admin/finance-approvals/${siteId}/approve`).then((r) => r.data);
}

// ── Project budget approvals ─────────────────────────────────────────────────

export async function getBudgetQueue() {
  const d = await client.get('/project/budget-admin-queue').then((r) => r.data);
  return {
    items: (d.items || []).map((r) => ({
      siteId: r.site_id, siteCode: r.site_code, siteName: r.site_name, city: r.city,
      budgetTotal: num(r.budget_total), submittedByName: r.submitted_by_name,
    })),
    total: d.total ?? 0,
  };
}

export async function reviewBudget(siteId, { decision, comments, initializationDate } = {}) {
  const body = { decision };
  if (comments) body.comments = comments;
  // On approve, the admin also sets the project initialization date.
  if (decision === 'approve' && initializationDate) body.initialization_date = initializationDate;
  return client.post(`/project/${siteId}/budget/admin-review`, body).then((r) => r.data);
}

// Full budget breakdown for the approval drawer — 11 investment heads, total,
// and the (distinct-but-related) area / cover inputs that drive the metrics.
// GET /project/{site_id} is tenant-scoped, not role-gated, so the admin reads it.
export async function fetchBudgetDetail(siteId) {
  const d = await client.get(`/project/${siteId}`).then((r) => r.data);
  return {
    items: (d.budget_items || []).map((r) => ({ idx: r.idx, label: r.label, amount: num(r.amount) })),
    budgetTotal: num(d.budget_total),
    totalIndoorAreaSqft: num(d.total_indoor_area_sqft),
    totalAreaSqft: num(d.total_area_sqft),
    covers: num(d.covers),
  };
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
  }));
}

// ── All sites + per-site cross-module history ────────────────────────────────

export async function getAllSites() {
  // main exposes a business-admin-scoped site list with all cross-module statuses.
  const d = await client.get('/business-admin/sites').then((r) => r.data);
  return {
    items: (d.items || []).map((s) => ({
      siteId: s.site_id, siteCode: s.site_code || '', siteName: s.site_name, city: s.city, status: s.site_status,
      createdByName: s.submitted_by_name, assignedToName: s.assigned_to_name,
      legalDdStatus: s.legal_dd_status, agreementStatus: s.agreement_status, licensingStatus: s.licensing_status,
      designStatus: s.design_status, projectStatus: s.project_status, financeStatus: s.finance_status,
    })),
    total: d.total ?? 0,
  };
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
