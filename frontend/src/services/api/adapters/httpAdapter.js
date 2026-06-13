// HTTP adapter — production-ready client against the FastAPI backend.
//
// Responsibilities:
//   1. Inject the Supabase access token on every request (from authToken.js).
//   2. Translate camelCase ⇄ snake_case at the wire boundary so the rest of
//      the frontend stays camelCase only.
//   3. Surface server errors as a typed `ApiError` so SitesContext / UI can
//      render meaningful messages instead of axios "Network Error".
//   4. Time out hung requests so the UI never spins forever.
//   5. Refresh near-expiry tokens and preserve form state on hard expiry.

import axios from 'axios';
import {
  getAuthToken,
  isAuthTokenExpiringSoon,
  notifySessionExpired,
  setAuthToken,
} from '../authToken.js';
import { notifySiteDataChanged } from '../siteEvents.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);
// Multipart uploads relay the body to Supabase Storage (its own 30s budget)
// before responding, so the default 20s client timeout fires first on big
// files / slow links — axios reports a bare "Network Error" while the upload
// actually completes server-side and the user re-uploads needlessly. Give
// uploads the same longer budget designApi already uses. (#127)
const UPLOAD_TIMEOUT_MS = Number(import.meta.env.VITE_API_UPLOAD_TIMEOUT_MS ?? 120000);

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });
let refreshPromise = null;

// The bootstrap auth probes — /auth/whoami fired on app mount and /auth/refresh
// — must NOT themselves pop the session-expired modal. SessionContext owns the
// first-load decision (drop a dead token silently vs. surface the modal only
// mid-session). Without this guard the mount-time whoami 401 from a stale token
// blinks the blocking modal over the public landing page. (#173 regression fix)
function isBootstrapAuthRequest(config) {
  const url = config?.url || '';
  return url.endsWith('/auth/whoami') || url.endsWith('/auth/refresh');
}

async function refreshBearerToken() {
  const token = getAuthToken();
  if (!token) return null;
  if (!refreshPromise) {
    refreshPromise = axios.post(
      `${BASE_URL}/auth/refresh`,
      {},
      {
        timeout: TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}` },
      },
    )
      .then((response) => {
        const next = response.data?.access_token;
        if (next) setAuthToken(next);
        return next || null;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function ensureFreshAuthToken() {
  let token = getAuthToken();
  if (token && isAuthTokenExpiringSoon(token)) {
    try {
      token = await refreshBearerToken() || getAuthToken();
    } catch (err) {
      // Proactive refresh failed. Do NOT pop the session-expired modal here —
      // let the actual request proceed with the current token; if it really is
      // dead the response interceptor (and SessionContext's first-load logic)
      // decide what to do. Firing here blinked the modal on app boot before any
      // data even loaded. (#173 regression fix)
      // eslint-disable-next-line no-console
      console.warn('[auth] proactive token refresh failed — proceeding with current token', err);
    }
  }
  return token;
}

client.interceptors.request.use(async cfg => {
  const token = await ensureFreshAuthToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ── Error wrapper ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor({ status, detail, code, cause }) {
    super(detail || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
    if (cause) this.cause = cause;
  }
}

client.interceptors.response.use(
  r => r,
  async err => {
    if (err.code === 'ECONNABORTED') {
      throw new ApiError({ status: 0, code: 'TIMEOUT', detail: 'Request timed out', cause: err });
    }
    const status = err.response?.status ?? 0;
    const rawDetail = err.response?.data?.detail;
    const parsedDetail = Array.isArray(rawDetail)
      ? rawDetail.map((item) => item?.msg || item?.message || JSON.stringify(item)).join('; ')
      : rawDetail && typeof rawDetail === 'object'
        ? rawDetail.message || rawDetail.detail || JSON.stringify(rawDetail)
        : rawDetail || err.message || 'Request failed';
    const detail = status === 0 && parsedDetail === 'Network Error'
      ? `Network Error contacting API at ${BASE_URL}. Check backend deployment, CORS, and database migration status.`
      : parsedDetail;

    if (status === 401 && !err.config?._retriedAfterRefresh) {
      try {
        const token = await refreshBearerToken();
        if (token) {
          const retryConfig = {
            ...err.config,
            _retriedAfterRefresh: true,
            headers: {
              ...(err.config?.headers || {}),
              Authorization: `Bearer ${token}`,
            },
          };
          return client.request(retryConfig);
        }
      } catch (refreshErr) {
        if (!isBootstrapAuthRequest(err.config)) {
          notifySessionExpired({ reason: 'unauthorized', error: refreshErr });
        }
      }
    }
    if (status === 401 && !isBootstrapAuthRequest(err.config)) {
      notifySessionExpired({ reason: 'unauthorized', detail });
    }
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

const get   = (url, params) => client.get(url, { params }).then(r => r.data);
const post  = (url, data)   => client.post(url, data).then(r => r.data);
const patch = (url, data)   => client.patch(url, data).then(r => r.data);

function detailsToServer(details = {}) {
  if (!details || typeof details !== 'object') return details;
  const clean = (value) => value === '' ? null : value;
  return {
    model: clean(details.model ?? null),
    google_pin: clean(details.google_pin ?? details.googlePin ?? null),
    score: clean(details.score ?? null),
    est_sales: clean(details.est_sales ?? details.estSales ?? null),
    nearest_starbucks: clean(details.nearest_starbucks ?? details.nearestStarbucks ?? null),
    nearest_twc: clean(details.nearest_twc ?? details.nearestTWC ?? null),
    carpet: clean(details.carpet ?? null),
    cam: clean(details.cam ?? null),
    rent_type: clean(details.rent_type ?? details.rentType ?? null),
    rent: clean(details.rent ?? null),
    escalation: clean(details.escalation ?? null),
    revshare: clean(details.revshare ?? null),
    rent_free_days: clean(details.rent_free_days ?? details.rentFreeDays ?? null),
    cadex: clean(details.cadex ?? null),
    deposit: clean(details.deposit ?? null),
    brokerage: clean(details.brokerage ?? null),
    lockin: clean(details.lockin ?? null),
    tenure: clean(details.tenure ?? null),
    total_op_cost: clean(details.total_op_cost ?? details.totalOpCost ?? null),
  };
}

// ── snake_case → camelCase response shaping ─────────────────────────────────

// Whole-day difference between two dates (or a Date.now() number). Returns null
// if either side is missing/unparseable. Used to derive the LOI SLA clocks the
// staging pages read (#115).
function _dayDiff(a, b) {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.max(0, Math.floor((db - da) / 86400000));
}

export function siteFromServer(s) {
  if (!s) return s;
  // LOI SLA tracking — previously supplied ONLY by the mock adapter, so the
  // staging tracker rendered fabricated 0s in production. Map the real wire
  // fields and derive the day counts the staging shapes consume. (#115)
  const _approvedDate = s.approved_at ? String(s.approved_at).slice(0, 10) : '';
  const _loiUploadedAt = s.loi_uploaded_at ?? null;
  const _daysToLOI = (s.approved_at && s.loi_uploaded_at)
    ? _dayDiff(s.approved_at, s.loi_uploaded_at)
    : null;
  const _daysSinceApproval = s.approved_at ? (_dayDiff(s.approved_at, Date.now()) ?? 0) : 0;
  const details = {
    name: s.name,
    visitDate: s.visit_date,
    city: s.city,
    model: s.model ?? '',
    spocName: s.spoc_name ?? '',
    googlePin: s.google_pin ?? '',
    rentType: s.rent_type ?? '',
    rent: s.rent ?? s.expected_rent ?? '',
    revshare: s.revshare ?? s.expected_revshare_pct ?? '',
    _savedAt: s.details_saved_at ?? '',
    score: s.score ?? '',
    estSales: s.est_sales ?? '',
    nearestStarbucks: s.nearest_starbucks ?? '',
    nearestTWC: s.nearest_twc ?? '',
    carpet: s.carpet ?? '',
    cam: s.cam ?? '',
    escalation: s.escalation ?? s.expected_escalation_pct ?? '',
    rentFreeDays: s.rent_free_days ?? '',
    cadex: s.cadex ?? '',
    deposit: s.deposit ?? '',
    brokerage: s.brokerage ?? '',
    lockin: s.lockin ?? '',
    tenure: s.tenure ?? '',
    totalOpCost: s.total_op_cost ?? '',
    photos: [],
  };
  const hasSavedDetails = [
    s.score, s.est_sales, s.nearest_starbucks, s.nearest_twc, s.carpet, s.cam,
    s.escalation, s.revshare, s.rent_free_days, s.cadex, s.deposit, s.brokerage, s.lockin, s.tenure,
    s.details_saved_at,
  ].some((v) => v !== null && v !== undefined);
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    city: s.city,
    tenantId: s.tenant_id,
    status: s.status,
    createdBy: { id: s.submitted_by, name: s.created_by },
    submittedBy: s.submitted_by,
    assignedTo: s.assigned_to
      ? { id: s.assigned_to, name: s.assigned_to_name || s.assigned_to }
      : null,
    supervisorId: s.supervisor_id,
    visitDate: s.visit_date,
    days: s.days,
    stage: s.stage,
    detailsCompletion: s.details_completion,
    model: s.model,
    spocName: s.spoc_name,
    googlePin: s.google_pin,
    googleMapsUrl: s.google_maps_url,
    expectedRent: s.expected_rent,
    rentType: s.rent_type,
    expectedEscalationPct: s.expected_escalation_pct,
    expectedEscalationYears: s.expected_escalation_years,
    expectedRevsharePct: s.expected_revshare_pct,
    score: s.score,
    estSales: s.est_sales,
    nearestStarbucks: s.nearest_starbucks,
    nearestTWC: s.nearest_twc,
    carpet: s.carpet,
    cam: s.cam,
    rent: s.rent,
    revshare: s.revshare,
    totalOpCost: s.total_op_cost,
    rentFreeDays: s.rent_free_days,
    cadex: s.cadex,
    deposit: s.deposit,
    brokerage: s.brokerage,
    lockin: s.lockin,
    tenure: s.tenure,
    details: hasSavedDetails ? details : null,
    legalDdStatus: s.legal_dd_status,
    agreementStatus: s.agreement_status,
    licensingStatus: s.licensing_status,
    designStatus: s.design_status,
    projectStatus: s.project_status,
    projectCurrentStage: s.project_current_stage,
    projectBudgetStatus: s.project_budget_status,
    nsoStatus: s.nso_status ?? null,
    nsoCurrentStage: s.nso_current_stage ?? null,
    launchStatus: s.launch_status ?? null,
    isLaunched: Boolean(s.is_launched),
    launchedAt: s.launched_at ?? null,
    // Finance / CA mirror columns — Payments and Launch render off these
    // without a per-site /tracker call.
    financeStatus: s.finance_status,
    kycVerified: s.kyc_verified ?? false,
    caCode: s.ca_code ?? null,
    financeAmount: s.finance_amount ?? null,
    // LOI SLA tracking (staging pages read these) (#115)
    expectedLoiDays: s.expected_loi_days ?? null,
    _approvedDate,
    _approvedBy: s.approved_by ?? '',
    _daysSinceApproval,
    _loiUploadedAt,
    _daysToLOI,
    // Reject / archive justification (Archive page Reason column) (#126)
    rejectionReason: s.rejection_reason ?? null,
    rejectionReasons: s.rejection_reason ? [s.rejection_reason] : [],
    archiveNote: s.archive_note ?? '',
    updatedAt: s.updated_at,
    _archivedAt: s.archived_at ? String(s.archived_at).slice(0, 10) : undefined,
  };
}

function listFromServer(payload) {
  return { items: (payload?.items || []).map(siteFromServer), total: payload?.total ?? 0 };
}

// ── Sites ───────────────────────────────────────────────────────────────────

export async function listSites(filter = {}) {
  const params = {};
  if (filter.status) params.status = Array.isArray(filter.status) ? filter.status.join(',') : filter.status;
  if (filter.city) params.city = filter.city;
  // Mock adapter returns a flat array of canonical sites; match that shape
  // so SitesContext consumes both backends identically.
  return listFromServer(await get('/sites', params)).items;
}

export async function getSite(id) {
  return siteFromServer(await get(`/sites/${id}`));
}

export async function createSite(payload) {
  const body = {
    name: payload.name,
    city: payload.city,
    visit_date: payload.visitDate,
    model: payload.model ?? null,
    google_pin: payload.googlePin ?? null,
    google_maps_url: payload.googleMapsUrl ?? null,
    expected_rent: payload.expectedRent ?? null,
    rent_type: payload.rentType ?? null,
    expected_escalation_pct: payload.expectedEscalationPct ?? null,
    expected_escalation_years: payload.expectedEscalationYears ?? null,
    expected_revshare_pct: payload.expectedRevsharePct ?? null,
  };
  return siteFromServer(await post('/sites', body));
}

export async function patchSiteStatus(id, status, payload = {}) {
  const nextPayload = payload?.details
    ? { ...payload, details: detailsToServer(payload.details) }
    : payload;
  return siteFromServer(await patch(`/sites/${id}/status`, { status, payload: nextPayload }));
}

export async function patchSiteDetails(id, details) {
  // The UI form is camelCase; the API contract is snake_case.
  return patch(`/sites/${id}/details`, { details: detailsToServer(details) });
}

export async function getSiteActivity(id, options = {}) {
  const params = options?.module ? { module: options.module } : undefined;
  const data = await get(`/audit/site/${id}`, params);
  const items = (data?.items || []).map(e => ({
    id: e.id,
    siteId: e.site_id,
    actor: e.actor,
    action: e.action,
    fromStatus: e.from_status ?? null,
    toStatus: e.to_status ?? null,
    fieldName: e.field_name ?? null,
    fromValue: e.from_value ?? null,
    toValue: e.to_value ?? null,
    detail: e.detail ?? null,
    createdAt: e.created_at,
  }));
  return { items, total: data?.total ?? items.length };
}

export async function getSiteDocuments(id) {
  const data = await get(`/sites/${id}/documents`);
  return {
    siteId: data.site_id,
    documents: (data.documents || []).map(d => ({
      id: d.id, fileName: d.file_name, fileType: d.file_type,
      fileSizeKb: d.file_size_kb, mimeType: d.mime_type,
      uploadedAt: d.uploaded_at, uploadedBy: d.uploaded_by, url: d.url,
    })),
  };
}

export async function uploadLoi(id, file) {
  const form = new FormData();
  // The backend route takes the raw file under the field name "file".
  const blob = file?.blob || file?.raw || file?.fileBytes;
  if (blob instanceof Blob) {
    form.append('file', blob, file.name || 'loi.pdf');
  } else if (file instanceof Blob) {
    form.append('file', file, file.name || 'loi.pdf');
  } else {
    // Fallback: server enforces the multipart contract anyway.
    form.append('file', new Blob([], { type: 'application/pdf' }), file?.name || 'loi.pdf');
  }
  const r = await client.post(`/sites/${id}/loi`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  });
  return r.data;
}

export async function uploadPhoto(id, file) {
  const form = new FormData();
  if (file instanceof File || file instanceof Blob) {
    form.append('file', file, file.name || 'photo.jpg');
  } else {
    throw new Error('uploadPhoto: expected a File or Blob');
  }
  const r = await client.post(`/sites/${id}/photos`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  });
  // Backend returns { id, url, file_name, file_size_kb, mime_type }
  return {
    id:         r.data.id,
    url:        r.data.url,
    fileName:   r.data.file_name,
    fileSizeKb: r.data.file_size_kb,
    mimeType:   r.data.mime_type,
  };
}

export async function archiveSite(id, note) {
  const result = await post(`/sites/${id}/archive`, { note });
  notifySiteDataChanged({ source: 'bd', action: 'archived', siteId: id });
  return result;
}
export async function reviveSite(id, note) {
  const result = await post(`/sites/${id}/revive`, { note: note || null });
  notifySiteDataChanged({ source: 'bd', action: 'revived', siteId: id });
  return result;
}
export async function rejectSite(id, reasons, comment) {
  const result = await post(`/sites/${id}/reject`, { reasons, comment });
  notifySiteDataChanged({ source: 'bd', action: 'rejected', siteId: id });
  return result;
}
export async function assignSite(id, execId) {
  const result = await post(`/sites/${id}/assign`, { exec_id: execId });
  notifySiteDataChanged({ source: 'bd', action: 'assigned', siteId: id });
  return result;
}

// ── Users / auth ────────────────────────────────────────────────────────────

export async function listUsers() {
  const data = await get('/users');
  return (data?.items || []).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, module: u.module ?? null, assignedCity: u.assigned_city,
  }));
}

export async function me() {
  // Backend now exposes the decoded session under /auth/whoami.
  return get('/auth/whoami');
}

export async function logout() { return post('/auth/logout'); }

// `login` is intentionally NOT exported. With Supabase the sign-in happens on
// the client via the Supabase JS SDK; the resulting token is fed to
// authToken.setAuthToken(token). See frontend/src/services/api/supabaseAuth.js.

// ── Tenancy / team management ──────────────────────────────────────────────

export async function getWorkspaceInfo() {
  const d = await get('/tenancy/workspace-info');
  return {
    id:             d.id,
    name:           d.name,
    slug:           d.slug,
    plan:           d.plan,
    workspaceCode:  d.workspace_code,
    seatLimit:      d.seat_limit,
    usedSeats:      d.used_seats,
    pendingSeats:   d.pending_seats,
  };
}

export async function listPendingUsers() {
  const d = await get('/users/pending');
  return (d?.items || []).map(u => ({
    id:        u.id,
    email:     u.email,
    name:      u.name,
    role:      u.role,
    createdAt: u.created_at,
  }));
}

export async function assignUserRole(userId, { role, city, name }) {
  const d = await post(`/users/${userId}/assign-role`, { role, city, name });
  return {
    userId:  d.user_id,
    role:    d.role,
    city:    d.city,
    message: d.message,
  };
}

// ── Delegations ────────────────────────────────────────────────────────────

function delegationFromServer(d) {
  return {
    id:              d.id,
    siteId:          d.site_id,
    delegateUserId:  d.delegate_user_id,
    delegateEmail:   d.delegate_email,
    delegateName:    d.delegate_name,
    grantedBy:       d.granted_by,
    grantedAt:       d.granted_at,
    notes:           d.notes,
    siteCode:        d.site_code,
    siteName:        d.site_name,
    siteCity:        d.site_city,
  };
}

export async function listSiteDelegations(siteId) {
  const d = await get(`/sites/${siteId}/delegations`);
  return (d?.items || []).map(delegationFromServer);
}

export async function grantDelegation(siteId, { delegateUserId, notes }) {
  const d = await post(`/sites/${siteId}/delegations`, {
    delegate_user_id: delegateUserId,
    notes: notes || null,
  });
  return delegationFromServer(d);
}

export async function revokeDelegation(delegationId) {
  return client.delete(`/delegations/${delegationId}`).then(r => r.data);
}

export async function listMyDelegations() {
  const d = await get('/delegations/mine');
  return (d?.items || []).map(delegationFromServer);
}

// ── Business admin (dept codes + pending-supervisor approvals) ─────────────

export async function getDeptCodes() {
  const data = await get('/business-admin/dept-codes');
  const items = data?.items || data || [];
  return items.map(d => ({
    id:        d.id,
    module:    d.module,
    code:      d.code,
    createdAt: d.created_at,
    rotatedAt: d.rotated_at,
  }));
}

export async function rotateDeptCode(moduleKey) {
  const d = await post(`/business-admin/dept-codes/${moduleKey}/rotate`);
  return { module: d.module, code: d.code };
}

export async function listPendingSupervisors(moduleKey) {
  const params = moduleKey ? { module: moduleKey } : undefined;
  const data = await get('/business-admin/pending-supervisors', params);
  const items = data?.items || data || [];
  return items.map(u => ({
    id:        u.id,
    email:     u.email,
    module:    u.module,
    createdAt: u.created_at,
  }));
}

export async function approveSupervisor(userId, moduleKey) {
  return post(`/business-admin/pending-supervisors/${userId}/approve`, { module: moduleKey });
}

export async function rejectSupervisor(userId) {
  return post(`/business-admin/pending-supervisors/${userId}/reject`);
}

export async function listBusinessAdminSites(limit = 80) {
  const data = await get('/business-admin/sites', { limit });
  const items = data?.items || data || [];
  return items.map(row => ({
    siteId:             row.site_id,
    siteCode:           row.site_code,
    siteName:           row.site_name,
    city:               row.city,
    siteStatus:         row.site_status,
    submittedByName:    row.submitted_by_name,
    assignedToName:     row.assigned_to_name,
    supervisorName:     row.supervisor_name,
    legalDdStatus:      row.legal_dd_status,
    agreementStatus:    row.agreement_status,
    licensingStatus:    row.licensing_status,
    financeStatus:      row.finance_status,
    designStatus:       row.design_status,
    projectStatus:      row.project_status,
    projectCurrentStage: row.project_current_stage,
    projectBudgetStatus: row.project_budget_status,
    projectCompletedAt: row.project_completed_at,
    nsoStatus:          row.nso_status,
    nsoCurrentStage:    row.nso_current_stage,
    launchStatus:       row.launch_status,
    isLaunched:         Boolean(row.is_launched),
    launchedAt:         row.launched_at,
    caCode:             row.ca_code,
    financeAmount:      row.finance_amount,
    kycVerified:        row.kyc_verified,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
    draftSubmittedAt:   row.draft_submitted_at,
    shortlistedAt:      row.shortlisted_at,
    detailsSubmittedAt: row.details_submitted_at,
    approvedAt:         row.approved_at,
    loiUploadedAt:      row.loi_uploaded_at,
    legalReviewAt:      row.legal_review_at,
    legalApprovedAt:    row.legal_approved_at,
    legalRejectedAt:    row.legal_rejected_at,
    pushedToPaymentsAt: row.pushed_to_payments_at,
    designApprovedAt:   row.design_approved_at,
    rejectionReason:    row.rejection_reason,
  }));
}

export async function listFinanceApprovals() {
  const data = await get('/business-admin/finance-approvals');
  const items = data?.items || data || [];
  return items.map(row => ({
    siteId:          row.site_id,
    siteCode:        row.site_code,
    siteName:        row.site_name,
    city:            row.city,
    siteStatus:      row.site_status,
    submittedByName: row.submitted_by_name,
    caCode:          row.ca_code,
    financeAmount:   row.finance_amount,
    kycVerified:     row.kyc_verified,
    financeStatus:   row.finance_status,
    updatedAt:       row.updated_at,
  }));
}

export async function approveFinanceApproval(siteId) {
  const result = await post(`/business-admin/finance-approvals/${siteId}/approve`, {});
  notifySiteDataChanged({ source: 'businessAdmin', action: 'approve_finance_admin', siteId });
  return result;
}

export async function getTenantAudit(limit = 50) {
  const data = await get('/audit', { limit });
  const items = data?.items || [];
  return {
    total: data?.total ?? items.length,
    items: items.map(e => ({
      id: e.id,
      siteId: e.site_id,
      actor: e.actor,
      action: e.action,
      fromStatus: e.from_status ?? null,
      toStatus: e.to_status ?? null,
      fieldName: e.field_name ?? null,
      fromValue: e.from_value ?? null,
      toValue: e.to_value ?? null,
      detail: e.detail ?? '',
      createdAt: e.created_at,
    })),
  };
}

// ── Per-supervisor invite codes & pending-executive approvals ──────────────

function inviteCodeFromServer(d) {
  if (!d) return null;
  return {
    module:    d.module,
    code:      d.code,
    createdAt: d.created_at,
    rotatedAt: d.rotated_at,
  };
}

export async function getMyInviteCode(module) {
  return inviteCodeFromServer(await get(`/supervisor-codes/me/${module}`));
}

export async function rotateMyInviteCode(module) {
  return inviteCodeFromServer(await post(`/supervisor-codes/me/${module}/rotate`));
}

export async function listMyPendingExecutives(module) {
  const d = await get(`/supervisor-codes/me/${module}/pending-executives`);
  const items = Array.isArray(d) ? d : (d?.items || []);
  return items.map(u => ({
    id:        u.id,
    email:     u.email,
    module:    u.module,
    createdAt: u.created_at,
  }));
}

export async function listMyTeam(module) {
  const d = await get(`/supervisor-codes/me/${module}/team`);
  const items = Array.isArray(d) ? d : (d?.items || []);
  return items.map(u => ({
    id:       u.id,
    email:    u.email,
    name:     u.name,
    module:   u.module,
    joinedAt: u.joined_at,
  }));
}

export async function approveMyPendingExecutive(userId, module) {
  return client.post(
    `/supervisor-codes/me/pending-executives/${userId}/approve`,
    null,
    { params: { module } },
  ).then(r => r.data);
}

export async function rejectMyPendingExecutive(userId) {
  return post(`/supervisor-codes/me/pending-executives/${userId}/reject`);
}
