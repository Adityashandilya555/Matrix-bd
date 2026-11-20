// skipcq: JS-0833
// Vendor platform administration — the Blue Tokai side.
//
// Business admin (Vendors tab in the business-admin portal):
//   GET/PUT  /vendor-admin/settings                      admission, cutoff, durations, branding
//   POST     /vendor-admin/settings/logo                 portal logo (multipart)
//   GET/PUT  /vendor-admin/templates/phases              plan phases per site type
//   GET/PUT  /vendor-admin/templates/checklists          mobilisation checklist items
//   GET/POST /vendor-admin/vendors                       vendor companies
//   PATCH    /vendor-admin/vendors/{id}                  edit / suspend
//   POST     /vendor-admin/vendors/{id}/codes/staff/rotate    staff code
//   POST     /vendor-admin/vendors/{id}/invite-owner     owner account
//   GET      /vendor-admin/pending                       people waiting for approval
//   POST     /vendor-admin/pending/{userId}/approve|reject
// Project module (Vendor fit-out page) and business admin:
//   GET/POST /vendor-admin/projects                      list / issue a PO
//   GET      /vendor-admin/projects/{id}                 detail + update log
import { createApiClient } from './axiosClient.js';
import { camelize } from './vendorCase.js';

const client = createApiClient();
const get = async (url) => camelize((await client.get(url)).data);
const send = async (method, url, body) => camelize((await client[method](url, body)).data);
const id = (v) => encodeURIComponent(v);

export const getVendorSettings = () => get('/vendor-admin/settings');
export const updateVendorSettings = (s) => send('put', '/vendor-admin/settings', {
  admission_mode: s.admissionMode,
  update_cutoff_local: s.updateCutoffLocal,
  timezone: s.timezone,
  mall_duration_days: Number(s.mallDurationDays),
  non_mall_duration_days: Number(s.nonMallDurationDays),
  portal_title: s.portalTitle,
  accent_color: s.accentColor,
  welcome_text: s.welcomeText,
  support_contact: s.supportContact,
});
export const uploadVendorLogo = (file) => {
  const form = new FormData();
  form.append('file', file);
  return send('post', '/vendor-admin/settings/logo', form);
};

export const getVendorPhases = () => get('/vendor-admin/templates/phases');
export const saveVendorPhases = (siteType, phases) => send('put', '/vendor-admin/templates/phases', {
  site_type: siteType,
  phases: phases.map((p, i) => ({
    phase_key: p.phaseKey, name: p.name, start_day: Number(p.startDay),
    end_day: Number(p.endDay), weight: Number(p.weight), sort_order: i,
  })),
});
export const getVendorChecklists = () => get('/vendor-admin/templates/checklists');
export const saveVendorChecklists = (items) => send('put', '/vendor-admin/templates/checklists', {
  items: items.map((it, i) => ({ id: it.id || null, kind: it.kind, label: it.label, active: it.active !== false, sort_order: i })),
});

export const listVendors = () => get('/vendor-admin/vendors');
export const createVendor = (v) => send('post', '/vendor-admin/vendors', {
  name: v.name, legal_name: v.legalName || null, gstin: v.gstin || null, owner_email: v.ownerEmail || null,
});
export const updateVendor = (vendorId, v) => send('patch', `/vendor-admin/vendors/${id(vendorId)}`, {
  name: v.name, legal_name: v.legalName, gstin: v.gstin, status: v.status,
});
export const rotateVendorCode = (vendorId, kind) =>
  send('post', `/vendor-admin/vendors/${id(vendorId)}/codes/${id(kind)}/rotate`);
export const inviteVendorOwner = (vendorId, email, name) =>
  send('post', `/vendor-admin/vendors/${id(vendorId)}/invite-owner`, { email, name: name || null });

export const listVendorPending = () => get('/vendor-admin/pending');
export const decideVendorPending = (userId, approve) =>
  send('post', `/vendor-admin/pending/${id(userId)}/${approve ? 'approve' : 'reject'}`);

export const listVendorProjects = () => get('/vendor-admin/projects');
export const getVendorProjectAdmin = (projectId) => get(`/vendor-admin/projects/${id(projectId)}`);
export const createVendorProject = (p) => send('post', '/vendor-admin/projects', {
  vendor_id: p.vendorId, site_id: p.siteId || null, ca_code: p.caCode || null, name: p.name,
  city: p.city, brand: p.brand || null, site_type: p.siteType, po_number: p.poNumber,
  po_value: Number(p.poValue), po_date: p.poDate, start_date: p.startDate,
});
