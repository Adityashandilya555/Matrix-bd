// skipcq: JS-0833
// Mock adapter — implements the full adapter interface against in-memory data.
// Components never import this directly; they go through *Service.js.
// All reads and writes await delay() to simulate realistic latency.

import { delay, maybeFail } from '../delay.js';
import { getAllSites, getSiteById, upsertSite } from '../mock/mockSites.js';
import { MOCK_USERS } from '../mock/mockUsers.js';
import { DEFAULT_SESSION, mockLogin } from '../mock/mockAuth.js';
import { SiteStatus, assertTransition } from '../../../lib/stateMachine.js';

// ---- Sites ----

export async function listSites(filter = {}) {
  await delay();
  maybeFail();
  let sites = getAllSites();
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    sites = sites.filter(s => statuses.includes(s.status));
  }
  if (filter.createdBy) {
    sites = sites.filter(s => s.createdBy.name === filter.createdBy || s.createdBy.id === filter.createdBy);
  }
  if (filter.city) {
    sites = sites.filter(s => s.city === filter.city);
  }
  return sites;
}

export async function getSite(id) {
  await delay();
  maybeFail();
  const site = getSiteById(id);
  if (!site) throw new Error(`Site not found: ${id}`);
  return site;
}

export async function createSite(payload) {
  await delay(200, 500);
  maybeFail();
  const id = 'site_' + Math.random().toString(36).slice(2, 10);
  const cityCode = (payload.city || 'UNK').slice(0, 3).toUpperCase();
  // Every draft — including a supervisor's own — enters the pipeline as
  // DRAFT_SUBMITTED and is shortlisted through the normal approval step. Mirrors
  // bd_service.svc_create_draft: there is no supervisor auto-promote.
  const submittedBy = payload.createdBy?.id || 'mock_user';
  const site = {
    id,
    code: 'BT-' + cityCode + '-' + Math.floor(Math.random() * 900 + 100),
    name: payload.name,
    city: payload.city,
    tenantId: payload.tenantId || 'bt-tenant-001',
    status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: payload.createdBy,
    submittedBy,
    supervisorId: null,
    assignedTo: null,
    visitDate: payload.visitDate,
    expectedLoiDays: null,
    loiUrl: null,
    details: null,
    rejectionReasons: null,
    archiveNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    auditTrail: [
      { id: 'a_' + Math.random().toString(36).slice(2, 8), action: 'create_draft',
        actor: payload.createdBy?.name || 'unknown',
        toStatus: SiteStatus.DRAFT_SUBMITTED,
        detail: null,
        createdAt: new Date().toISOString() },
    ],
    // Pipeline-stage fields — also rendered into the shortlist edit form.
    model: payload.model ?? '',
    googlePin: payload.googlePin ?? '',
    googleMapsUrl: payload.googleMapsUrl ?? '',
    rentType: payload.rentType ?? '',
    expectedRent: payload.expectedRent ?? null,
    expectedEscalationPct: payload.expectedEscalationPct ?? null,
    expectedEscalationYears: payload.expectedEscalationYears ?? null,
    expectedRevsharePct: payload.expectedRevsharePct ?? null,
    areaSqft: payload.areaSqft ?? null,
    staggeredEscalation: payload.staggeredEscalation ?? null,
    score: '', estSales: '', carpet: '', rent: payload.expectedRent ?? '', totalOpCost: 0,
    hue: Math.round(Math.random() * 360),
  };
  return upsertSite(site);
}

export async function patchSiteStatus(id, newStatus, payload = {}) {
  await delay(200, 500);
  maybeFail();
  const site = getSiteById(id);
  if (!site) throw new Error(`Site not found: ${id}`);
  assertTransition(site.status, newStatus);
  const auditEntry = {
    id: Math.random().toString(36).slice(2, 10),
    at: new Date().toISOString(),
    by: payload.by || 'system',
    fromStatus: site.status,
    toStatus: newStatus,
    action: `${site.status} -> ${newStatus}`,
    note: payload.note || '',
  };
  const updated = {
    ...site,
    status: newStatus,
    auditTrail: [...(site.auditTrail || []), auditEntry],
    updatedAt: new Date().toISOString(),
  };
  // Apply payload fields
  if (payload.expectedLoiDays != null) updated.expectedLoiDays = payload.expectedLoiDays;
  if (payload.rejectionReasons != null) updated.rejectionReasons = payload.rejectionReasons;
  if (payload.archiveNote != null) updated.archiveNote = payload.archiveNote;
  if (payload.details != null) updated.details = payload.details;
  if (payload.score != null) updated.score = payload.score;
  if (payload.estSales != null) updated.estSales = payload.estSales;
  if (payload.carpet != null) updated.carpet = payload.carpet;
  if (payload.rent != null) updated.rent = payload.rent;
  if (payload.rentType != null) updated.rentType = payload.rentType;
  if (payload.totalOpCost != null) updated.totalOpCost = payload.totalOpCost;
  if (payload.hue != null) updated.hue = payload.hue;
  // Staging display fields preserved when transitioning to APPROVED
  if (newStatus === SiteStatus.APPROVED) {
    updated._draftDate = site.visitDate;
    updated._approvedDate = new Date().toISOString().slice(0, 10);
    updated._approvedBy = payload.by || 'Supervisor';
    updated._daysSinceApproval = 0;
    updated._daysToLOI = null;
  }
  return upsertSite(updated);
}

export async function uploadLoi(id, file) {
  await delay(600, 1200);
  maybeFail();
  const site = getSiteById(id);
  if (!site) throw new Error(`Site not found: ${id}`);
  const ts = Date.now();
  const url = file.blobUrl || `mock-storage/loi-${id}-${ts}.pdf`;
  const uploadedAt = new Date().toISOString().slice(0, 10);
  // Transition to LOI_UPLOADED
  assertTransition(site.status, SiteStatus.LOI_UPLOADED);
  const auditEntry = {
    id: Math.random().toString(36).slice(2, 10),
    at: new Date().toISOString(),
    by: file.uploadedBy || 'exec',
    fromStatus: site.status,
    toStatus: SiteStatus.LOI_UPLOADED,
    action: `${site.status} -> LOI_UPLOADED`,
    note: `LOI file: ${file.name || 'loi.pdf'}`,
  };
  const updated = {
    ...site,
    status: SiteStatus.LOI_UPLOADED,
    loiUrl: url,
    auditTrail: [...(site.auditTrail || []), auditEntry],
    updatedAt: new Date().toISOString(),
    _loiUploadedAt: uploadedAt,
    _daysToLOI: site._daysSinceApproval ?? 0,
  };
  upsertSite(updated);
  return { url, uploadedAt };
}

export async function archiveSite(id, note) {
  await delay(200, 400);
  maybeFail();
  const site = getSiteById(id);
  // Capture where the site came from so Revive can restore it. Mirrors the
  // backend `archived_from_status` column.
  return patchSiteStatus(id, SiteStatus.ARCHIVED, {
    archiveNote: note,
    note,
    archivedFromStatus: site?.status,
  });
}

export async function reviveSite(id, note) {
  await delay(200, 400);
  maybeFail();
  const site = getSiteById(id);
  if (!site) throw new Error(`Site not found: ${id}`);
  // Restore to whichever stage the site was at when it was archived. If the
  // bookkeeping was lost, fall back to DRAFT_SUBMITTED so the site re-enters
  // the pipeline at the top instead of staying stuck.
  const restoreTo = site._archivedFromStatus || site.archivedFromStatus || SiteStatus.DRAFT_SUBMITTED;
  const updated = {
    ...site,
    status: restoreTo,
    archiveNote: null,
    _archivedFromStatus: null,
    archivedFromStatus: null,
    _archivedAt: null,
    updatedAt: new Date().toISOString(),
    auditTrail: [
      ...(site.auditTrail || []),
      { actor: 'supervisor', action: 'revive_site', timestamp: new Date().toISOString(), note: note || null },
    ],
  };
  return upsertSite(updated);
}

export async function rejectSite(id, reasons, comment) {
  await delay(200, 400);
  maybeFail();
  return patchSiteStatus(id, SiteStatus.REJECTED, { rejectionReasons: reasons, note: comment });
}

export async function assignSite(id, execId) {
  await delay(150, 300);
  maybeFail();
  const site = getSiteById(id);
  if (!site) throw new Error(`Site not found: ${id}`);
  const exec = MOCK_USERS.find(u => u.id === execId);
  const updated = {
    ...site,
    assignedTo: exec ? { id: exec.id, name: exec.name } : null,
    updatedAt: new Date().toISOString(),
  };
  return upsertSite(updated);
}

// Patch details in place without transitioning status (for save-draft-details).
// Emits one `pipeline_field_edited` audit row per changed pipeline-stage field so the
// site activity tab can render the diff (mirrors the backend service contract).
const PIPELINE_FIELDS_FE = [
  ['model', 'model'],
  ['googlePin', 'google_pin'],
  ['rentType', 'rent_type'],
  // In the form the rent number lives in `rent`; on the site it lives on `expectedRent`.
  ['rent', 'expected_rent'],
];

function diffPipelineEntries(site, incoming, actor, action = 'pipeline_field_edited') {
  const entries = [];
  for (const [formKey, fieldName] of PIPELINE_FIELDS_FE) {
    const nextRaw = incoming[formKey];
    if (nextRaw === undefined || nextRaw === '' || nextRaw === null) continue;
    const prevRaw = fieldName === 'expected_rent' ? site.expectedRent : site[formKey];
    const next = String(nextRaw);
    const prev = prevRaw == null ? null : String(prevRaw);
    if (prev === next) continue;
    entries.push({
      id: 'a_' + Math.random().toString(36).slice(2, 8),
      at: new Date().toISOString(),
      by: actor,
      action,
      fieldName, fromValue: prev, toValue: next,
    });
  }
  return entries;
}

export async function patchSiteDetails(id, details) {
  await delay(150, 400);
  maybeFail();
  const site = getSiteById(id);
  if (!site) throw new Error(`Site not found: ${id}`);
  const actor = details._actor || site.createdBy?.name || 'exec';
  // A supervisor amending an exec's details tags the diffs distinctly and flags
  // the changed fields until the exec re-reads them (mirrors the backend).
  const bySupervisor = details._editorRole === 'supervisor';
  const action = bySupervisor ? 'supervisor_field_edited' : 'pipeline_field_edited';
  const diffEntries = diffPipelineEntries(site, details, actor, action);
  const changedFields = diffEntries.map(e => e.fieldName);
  const supervisorEditedFields = bySupervisor
    ? Array.from(new Set([...(site.supervisorEditedFields || []), ...changedFields]))
    : (site.supervisorEditedFields || []);
  const updated = {
    ...site,
    details: { ...(site.details || {}), ...details },
    // Promote the pipeline-stage fields back onto the site row (single source of truth).
    model: details.model ?? site.model,
    googlePin: details.googlePin ?? site.googlePin,
    rentType: details.rentType ?? site.rentType,
    expectedRent: details.rent != null && details.rent !== '' ? Number(details.rent) : site.expectedRent,
    supervisorEditedFields,
    auditTrail: [...(site.auditTrail || []), ...diffEntries],
    updatedAt: new Date().toISOString(),
  };
  return upsertSite(updated);
}

// Acknowledge supervisor edits: clear the flag and log the exec-viewed marker,
// but only when there is actually something unseen (keeps the feed clean).
export async function markSiteViewed(id) {
  await delay(60, 160);
  const site = getSiteById(id);
  if (!site) throw new Error(`Site not found: ${id}`);
  if (!(site.supervisorEditedFields || []).length) return { ok: true, message: 'nothing to acknowledge' };
  const updated = {
    ...site,
    supervisorEditedFields: [],
    auditTrail: [...(site.auditTrail || []), {
      id: 'a_' + Math.random().toString(36).slice(2, 8),
      at: new Date().toISOString(),
      by: site.createdBy?.name || 'exec',
      action: 'exec_viewed_details',
      detail: 'Executive reviewed supervisor edits',
    }],
    updatedAt: new Date().toISOString(),
  };
  upsertSite(updated);
  return { ok: true, message: 'acknowledged' };
}

// Activity feed for one site — canonical entry shape consumed by SiteActivityTab.
// See frontend/src/services/api/audit.js for the canonical contract.
export async function getSiteActivity(siteId) {
  await delay(80, 200);
  const site = getSiteById(siteId);
  if (!site) return { items: [], total: 0 };
  const items = (site.auditTrail || [])
    .slice()
    .reverse()
    .map(e => ({
      id: e.id,
      siteId,
      actor: e.by || e.actor || 'system',
      action: e.action || 'edit',
      fromStatus: e.fromStatus || null,
      toStatus: e.toStatus || null,
      fieldName: e.fieldName || null,
      fromValue: e.fromValue ?? null,
      toValue: e.toValue ?? null,
      detail: e.note || e.detail || null,
      createdAt: e.at || e.createdAt || new Date().toISOString(),
    }));
  return { items, total: items.length };
}

// In-memory photo store for mock mode (keyed by siteId)
const _mockPhotos = {};

export async function uploadPhoto(siteId, file) {
  await delay(400, 900);
  maybeFail();
  const id = 'photo_' + Math.random().toString(36).slice(2, 10);
  // Keep the object URL alive for the mock session
  const url = (file instanceof Blob || file instanceof File)
    ? URL.createObjectURL(file)
    : `mock-storage/photo-${siteId}-${Date.now()}.jpg`;
  const entry = {
    id,
    fileName: file?.name || 'photo.jpg',
    fileType: 'photo',
    fileSizeKb: file?.size ? Math.max(1, Math.round(file.size / 1024)) : 50,
    mimeType:  file?.type || 'image/jpeg',
    uploadedAt: new Date().toISOString(),
    uploadedBy: 'exec',
    url,
  };
  if (!_mockPhotos[siteId]) _mockPhotos[siteId] = [];
  _mockPhotos[siteId].push(entry);
  return { id, url, fileName: entry.fileName, fileSizeKb: entry.fileSizeKb, mimeType: entry.mimeType };
}

export async function getSiteDocuments(siteId) {
  await delay(80, 200);
  const site = getSiteById(siteId);
  const docs = [];
  if (site?.loiUrl) {
    docs.push({
      id: `loi_${siteId}`,
      fileName: 'LOI uploaded.pdf',
      fileType: 'loi',
      fileSizeKb: null,
      mimeType: 'application/pdf',
      uploadedAt: site._loiUploadedAt || site.updatedAt || new Date().toISOString(),
      uploadedBy: site.createdBy?.name || site.createdBy || 'BD',
      url: site.loiUrl,
    });
  }
  // Include any photos uploaded via uploadPhoto() this session
  const photos = _mockPhotos[siteId] || [];
  return { siteId, documents: [...docs, ...photos] };
}

// ---- Users ----

export async function listUsers() {
  await delay();
  return [...MOCK_USERS];
}

export async function requestExecutiveAccess() {
  await delay(300, 600);
  // Just simulate success. The frontend reloads the page on success anyway,
  // but to correctly reflect it in mock mode without a backend, we'd theoretically
  // modify the mock session. But for now, returning success is enough.
  return null;
}

// ---- Delegations (mock) ----
// In-memory store keyed by siteId. Mock mode doesn't need to persist these
// across reloads — the page just needs the grant/revoke loop to be visible.
const _mockDelegations = new Map(); // siteId -> [{ id, ... }]

export async function listSiteDelegations(siteId) {
  await delay(80, 160);
  return [...(_mockDelegations.get(siteId) || [])];
}

export async function grantDelegation(siteId, { delegateUserId, notes }) {
  await delay(120, 240);
  const delegate = MOCK_USERS.find(u => u.id === delegateUserId);
  if (!delegate) throw new Error('Delegate user not found in workspace.');
  const list = _mockDelegations.get(siteId) || [];
  if (list.some(d => d.delegateUserId === delegateUserId)) {
    const err = new Error('Active delegation for this user already exists.');
    err.status = 409;
    throw err;
  }
  const row = {
    id: 'dlg_' + Math.random().toString(36).slice(2, 9),
    siteId,
    delegateUserId,
    delegateEmail: delegate.email,
    delegateName: delegate.name,
    grantedBy: 'supervisor',
    grantedAt: new Date().toISOString(),
    notes: notes || null,
  };
  _mockDelegations.set(siteId, [...list, row]);
  return row;
}

export async function revokeDelegation(delegationId) {
  await delay(80, 160);
  for (const [siteId, list] of _mockDelegations.entries()) {
    const next = list.filter(d => d.id !== delegationId);
    if (next.length !== list.length) {
      _mockDelegations.set(siteId, next);
      return { ok: true, message: 'Delegation revoked.' };
    }
  }
  const err = new Error('Delegation not found.');
  err.status = 404;
  throw err;
}

export async function listMyDelegations() {
  await delay(60, 140);
  return [];
}

export async function me() {
  await delay(50, 150);
  return { ...DEFAULT_SESSION };
}

// ---- Finance (mock) ----
// Finance state lives on the site object so getSite() / getSiteTrackerView()
// automatically pick it up without an extra round-trip.

export async function saveFinanceDraft(siteId, { kycVerified, caCode, financeAmount } = {}) {
  await delay(100, 300);
  const site = getSiteById(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);
  if ((site.financeStatus ?? 'pending') !== 'pending') {
    const err = new Error(`Finance is already in '${site.financeStatus}' — fields are locked.`);
    err.status = 422;
    throw err;
  }
  const updated = { ...site };
  if (kycVerified !== undefined) updated.kycVerified = kycVerified;
  if (caCode !== undefined) updated.caCode = caCode || null;
  if (financeAmount !== undefined) updated.financeAmount = financeAmount;
  upsertSite(updated);
  return {
    kyc_verified:   updated.kycVerified ?? false,
    ca_code:        updated.caCode ?? null,
    finance_amount: updated.financeAmount ?? null,
    finance_status: updated.financeStatus ?? 'pending',
  };
}

export async function requestFinanceApproval(siteId, { kycVerified, caCode, financeAmount } = {}) {
  await delay(200, 400);
  const site = getSiteById(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);
  const draft = { ...site };
  if (kycVerified !== undefined) draft.kycVerified = kycVerified;
  if (caCode !== undefined) draft.caCode = caCode || null;
  if (financeAmount !== undefined) draft.financeAmount = financeAmount;
  if (!draft.kycVerified) {
    const err = new Error('KYC must be verified before requesting approval.');
    err.status = 422;
    throw err;
  }
  if (!draft.caCode) {
    const err = new Error('CA code must be entered before requesting approval.');
    err.status = 422;
    throw err;
  }
  if (draft.financeAmount == null) {
    const err = new Error('Amount must be entered before requesting approval.');
    err.status = 422;
    throw err;
  }
  const updated = { ...draft, financeStatus: 'awaiting_supervisor' };
  upsertSite(updated);
  return {
    kyc_verified:   updated.kycVerified ?? false,
    ca_code:        updated.caCode ?? null,
    finance_amount: updated.financeAmount ?? null,
    finance_status: 'awaiting_supervisor',
  };
}

export async function approveFinance(siteId) {
  await delay(200, 400);
  const site = getSiteById(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);
  const current = site.financeStatus ?? 'pending';
  let next;
  if (current === 'awaiting_supervisor') next = 'awaiting_admin';
  else if (current === 'awaiting_admin') next = 'approved';
  else {
    const err = new Error(`Cannot approve from status: ${current}`);
    err.status = 422;
    throw err;
  }
  const updated = { ...site, financeStatus: next };
  upsertSite(updated);
  return {
    kyc_verified:   updated.kycVerified ?? false,
    ca_code:        updated.caCode ?? null,
    finance_amount: updated.financeAmount ?? null,
    finance_status: next,
  };
}

// ---- Auth ----

export async function login(credentials) {
  await delay(300, 600);
  return mockLogin(credentials);
}

export async function logout() {
  await delay(100, 200);
  return { ok: true };
}
