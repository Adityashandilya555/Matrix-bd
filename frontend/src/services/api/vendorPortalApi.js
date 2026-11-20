// skipcq: JS-0833
// Vendor portal API — the outside fit-out vendor's own surface.
//
// Endpoints (all under /vendor, vendor role only; the server scopes every call
// to the caller's vendor company and refuses vendor tokens everywhere else):
//   GET  /vendor/me                              → user, vendor, portal branding
//   GET  /vendor/home                            → KPIs, alerts, allocated sites
//   GET  /vendor/projects/{id}                   → one site in full
//   POST /vendor/projects/{id}/accept            → accept the PO, confirm start
//   PUT  /vendor/projects/{id}/initiation        → supervisor, crew, plan, checklist
//   GET  /vendor/projects/{id}/updates           → daily-update log
//   PUT  /vendor/projects/{id}/updates/today     → submit or edit today's update
//   GET  /vendor/staff                           → staff, pending requests, staff code
//   POST /vendor/staff/code/rotate               → new staff code
//   POST /vendor/staff/pending/{userId}/approve  → admit a staff member
//   POST /vendor/staff/pending/{userId}/reject
//
// snake_case on the wire, camelCase here (vendorCase.js).
import { createApiClient } from './axiosClient.js';
import { camelize } from './vendorCase.js';

const client = createApiClient();
const get = async (url) => camelize((await client.get(url)).data);
const post = async (url, body) => camelize((await client.post(url, body)).data);
const put = async (url, body) => camelize((await client.put(url, body)).data);

export const getVendorMe = () => get('/vendor/me');
export const getVendorHome = () => get('/vendor/home');
export const getVendorProject = (id) => get(`/vendor/projects/${encodeURIComponent(id)}`);
export const listVendorUpdates = (id) => get(`/vendor/projects/${encodeURIComponent(id)}/updates`);

export const acceptVendorPo = (id, startDate) =>
  post(`/vendor/projects/${encodeURIComponent(id)}/accept`, { start_date: startDate });

export const saveVendorInitiation = (id, f) =>
  put(`/vendor/projects/${encodeURIComponent(id)}/initiation`, {
    supervisor_name: f.supervisorName,
    supervisor_phone: f.supervisorPhone,
    crew_size: f.crewSize,
    delivery_plan: f.deliveryPlan,
    checks: f.checks,
  });

export const submitVendorUpdate = (id, f) =>
  put(`/vendor/projects/${encodeURIComponent(id)}/updates/today`, {
    progress: f.progress,
    manpower: f.manpower,
    supervisor_on_site: f.supervisorOnSite,
    ppe_ok: f.ppeOk,
    material: f.material,
    note: f.note,
    hindrance_text: f.hindranceText,
  });

export const getVendorStaff = () => get('/vendor/staff');
export const rotateVendorStaffCode = () => post('/vendor/staff/code/rotate');
export const decideVendorStaff = (userId, approve) =>
  post(`/vendor/staff/pending/${encodeURIComponent(userId)}/${approve ? 'approve' : 'reject'}`);
