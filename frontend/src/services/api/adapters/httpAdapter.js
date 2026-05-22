// HTTP adapter — production-ready client against the FastAPI backend.
//
// Responsibilities:
//   1. Inject the Supabase access token on every request (from authToken.js).
//   2. Translate camelCase ⇄ snake_case at the wire boundary so the rest of
//      the frontend stays camelCase only.
//   3. Surface server errors as a typed `ApiError` so SitesContext / UI can
//      render meaningful messages instead of axios "Network Error".
//   4. Time out hung requests so the UI never spins forever.
//   5. Treat 401 as a session-expired signal (clears the local token).

import axios from 'axios';
import { clearAuthToken, getAuthToken } from '../authToken.js';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 20000);

const client = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

client.interceptors.request.use(cfg => {
  const token = getAuthToken();
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
  err => {
    if (err.code === 'ECONNABORTED') {
      throw new ApiError({ status: 0, code: 'TIMEOUT', detail: 'Request timed out', cause: err });
    }
    const status = err.response?.status ?? 0;
    const detail = err.response?.data?.detail || err.message || 'Request failed';
    // Session expiry — drop the local token so the UI can route to login.
    if (status === 401) clearAuthToken();
    throw new ApiError({ status, detail, code: err.response?.data?.code, cause: err });
  },
);

const get   = (url, params) => client.get(url, { params }).then(r => r.data);
const post  = (url, data)   => client.post(url, data).then(r => r.data);
const patch = (url, data)   => client.patch(url, data).then(r => r.data);

// ── snake_case → camelCase response shaping ─────────────────────────────────

function siteFromServer(s) {
  if (!s) return s;
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    city: s.city,
    tenantId: s.tenant_id,
    status: s.status,
    createdBy: { id: undefined, name: s.created_by },
    visitDate: s.visit_date,
    days: s.days,
    stage: s.stage,
    detailsCompletion: s.details_completion,
    model: s.model,
    spocName: s.spoc_name,
    googlePin: s.google_pin,
    expectedRent: s.expected_rent,
    rentType: s.rent_type,
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
    spoc_name: payload.spocName ?? null,
    google_pin: payload.googlePin ?? null,
    expected_rent: payload.expectedRent ?? null,
    rent_type: payload.rentType ?? null,
  };
  return siteFromServer(await post('/sites', body));
}

export async function patchSiteStatus(id, status, payload = {}) {
  return siteFromServer(await patch(`/sites/${id}/status`, { status, payload }));
}

export async function patchSiteDetails(id, details) {
  // The form already uses snake_case-ish keys (see siteService.submitDetails).
  // Pass through; backend tolerates both shapes.
  return patch(`/sites/${id}/details`, { details });
}

export async function getSiteActivity(id) {
  const data = await get(`/sites/${id}/activity`);
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
  });
  return r.data;
}

export async function archiveSite(id, note)               { return post(`/sites/${id}/archive`, { note }); }
export async function rejectSite(id, reasons, comment)    { return post(`/sites/${id}/reject`, { reasons, comment }); }
export async function assignSite(id, execId)              { return post(`/sites/${id}/assign`, { exec_id: execId }); }

// ── Users / auth ────────────────────────────────────────────────────────────

export async function listUsers() {
  const data = await get('/users');
  return (data?.items || []).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, assignedCity: u.assigned_city,
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
