// Mock adapter — implements the full adapter interface against in-memory data.
// Components never import this directly; they go through *Service.js.
// All reads and writes await delay() to simulate realistic latency.

import { delay, maybeFail } from '../delay.js';
import { getAllSites, getSiteById, upsertSite } from '../mock/mockSites.js';
import { MOCK_USERS } from '../mock/mockUsers.js';
import { DEFAULT_SESSION, mockLogin } from '../mock/mockAuth.js';
import { SiteStatus } from '../../../lib/stateMachine.js';
import { assertTransition } from '../../../lib/stateMachine.js';

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
  const site = {
    id,
    code: 'BT-' + cityCode + '-' + Math.floor(Math.random() * 900 + 100),
    name: payload.name,
    city: payload.city,
    tenantId: payload.tenantId || 'bt-tenant-001',
    status: SiteStatus.DRAFT_SUBMITTED,
    createdBy: payload.createdBy,
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
        toStatus: SiteStatus.DRAFT_SUBMITTED, createdAt: new Date().toISOString() },
    ],
    // Pipeline-stage fields — also rendered into the shortlist edit form.
    model: payload.model ?? '',
    spocName: payload.spocName ?? '',
    googlePin: payload.googlePin ?? '',
    rentType: payload.rentType ?? '',
    expectedRent: payload.expectedRent ?? null,
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
    updated._spocName = payload.spocName || site.details?.spocName || site.createdBy.name;
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
  return patchSiteStatus(id, SiteStatus.ARCHIVED, { archiveNote: note, note });
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
  ['spocName', 'spoc_name'],
  ['googlePin', 'google_pin'],
  ['rentType', 'rent_type'],
  // In the form the rent number lives in `rent`; on the site it lives on `expectedRent`.
  ['rent', 'expected_rent'],
];

function diffPipelineEntries(site, incoming, actor) {
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
      action: 'pipeline_field_edited',
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
  const diffEntries = diffPipelineEntries(site, details, actor);
  const updated = {
    ...site,
    details: { ...(site.details || {}), ...details },
    // Promote the 5 pipeline-stage fields back onto the site row (single source of truth).
    model: details.model ?? site.model,
    spocName: details.spocName ?? site.spocName,
    googlePin: details.googlePin ?? site.googlePin,
    rentType: details.rentType ?? site.rentType,
    expectedRent: details.rent != null && details.rent !== '' ? Number(details.rent) : site.expectedRent,
    auditTrail: [...(site.auditTrail || []), ...diffEntries],
    updatedAt: new Date().toISOString(),
  };
  return upsertSite(updated);
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

// ---- Users ----

export async function listUsers() {
  await delay();
  return [...MOCK_USERS];
}

export async function me() {
  await delay(50, 150);
  return { ...DEFAULT_SESSION };
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
