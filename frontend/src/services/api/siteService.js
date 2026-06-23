// Public site service — all site reads and writes go through here.
// Components never call adapters or mock/* directly.
// All functions return promises with canonical site shape.

import { adapter } from './adapters/index.js';
import { SiteStatus } from '../../lib/stateMachine.js';

// Coerce a form field (possibly with currency formatting) to a plain number.
// Returns undefined (not null) so callers can spread into objects without
// accidentally writing explicit nulls for fields the backend treats as optional.
function toNumber(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// Core transition function — validates the transition via assertTransition (inside adapter),
// applies the change, writes an audit entry, and returns the updated site.
export async function transitionSite(siteId, nextStatus, payload = {}) {
  return adapter.patchSiteStatus(siteId, nextStatus, payload);
}

// Convenience wrappers — all go through transitionSite

export async function shortlistSite(siteId, by) {
  return transitionSite(siteId, SiteStatus.SHORTLISTED, { by });
}

export async function submitDetails(siteId, formData, by) {
  // Forms collect raw rupee amounts (estSales, rent, cam, deposit, brokerage,
  // capex…) — store them as entered. No unit conversion. The backend column
  // types are NUMERIC and a higher-up renderer is responsible for "₹ X.XX L"
  // / "₹ X k" presentation. Anything else corrupts the data going in.
  // Coerce every numeric field in the form payload before sending. Without
  // this, the backend's status-patch dispatcher (which reads payload.details
  // as a raw dict and skips Pydantic) ends up writing string values straight
  // into NUMERIC columns — which silently fails for some optional-field
  // shapes (capex/deposit/brokerage/escalation/revshare) and surfaces as
  // "details not getting submitted" once any optional field is filled in.
  const coercedDetails = {
    ...formData,
    score:            toNumber(formData.score),
    estSales:         toNumber(formData.estSales),
    nearestStarbucks: toNumber(formData.nearestStarbucks),
    nearestTWC:       toNumber(formData.nearestTWC),
    carpet:           toNumber(formData.carpet),
    cam:              toNumber(formData.cam),
    rent:             toNumber(formData.rent),
    escalation:       toNumber(formData.escalation),
    revshare:         toNumber(formData.revshare),
    rentFreeDays:     toNumber(formData.rentFreeDays),
    cadex:            toNumber(formData.cadex ?? formData.capex),
    capex:            toNumber(formData.capex ?? formData.cadex),
    deposit:          toNumber(formData.deposit),
    brokerage:        toNumber(formData.brokerage),
    lockin:           toNumber(formData.lockin),
    tenure:           toNumber(formData.tenure),
    totalOpCost:      toNumber(formData.totalOpCost),
  };
  return transitionSite(siteId, SiteStatus.DETAILS_SUBMITTED, {
    by,
    details: coercedDetails,
    score:        coercedDetails.score,
    estSales:     coercedDetails.estSales,
    carpet:       coercedDetails.carpet,
    rent:         coercedDetails.rent,
    rentType:     formData.rentType,
    totalOpCost:  coercedDetails.totalOpCost,
    lockin:       coercedDetails.lockin,
    tenure:       coercedDetails.tenure,
    rentFreeDays: coercedDetails.rentFreeDays,
  });
}

export async function approveSite(siteId, days, by) {
  return transitionSite(siteId, SiteStatus.APPROVED, {
    expectedLoiDays: days,
    by,
  });
}

export async function uploadLoi(siteId, file, uploadedBy) {
  return adapter.uploadLoi(siteId, { ...file, uploadedBy });
}

export async function pushToPayments(siteId, by) {
  // Compatibility wrapper for the existing "push" button. After PR #4's
  // workflow change, BD push no longer terminates in Payments; it starts Legal.
  return transitionSite(siteId, SiteStatus.LEGAL_REVIEW, { by });
}

export async function rejectSite(siteId, reasons, comment, by) {
  return adapter.rejectSite(siteId, reasons, comment);
}

export async function archiveSite(siteId, note, by) {
  return adapter.archiveSite(siteId, note);
}

export async function reviveSite(siteId, note) {
  return adapter.reviveSite(siteId, note);
}

// Read operations

export async function listSites(filter = {}) {
  return adapter.listSites(filter);
}

export async function getSite(id) {
  return adapter.getSite(id);
}

export async function getSiteDocuments(id) {
  return adapter.getSiteDocuments(id);
}

// Upload a single photo for a site. Returns { id, url, fileName, fileSizeKb, mimeType }.
export async function uploadPhoto(siteId, file) {
  return adapter.uploadPhoto(siteId, file);
}

// Return all photo documents for a site (filters the documents list by fileType='photo').
export async function listSitePhotos(siteId) {
  const result = await adapter.getSiteDocuments(siteId);
  return (result?.documents || []).filter(d => d.fileType === 'photo');
}

export async function createSite(payload) {
  return adapter.createSite(payload);
}

export async function assignSite(siteId, execId) {
  return adapter.assignSite(siteId, execId);
}

// Save partial details (stays in current status, does not transition).
// Coerce every numeric field on the way out so the backend's site_details
// upsert writes proper NUMERIC values instead of strings — without this,
// some columns (capex/deposit/brokerage/lockin/tenure/escalation/revshare)
// would round-trip back to the UI as empty after a draft save, because the
// FE→BE string write only succeeds opportunistically depending on column
// type and PG version.
export async function saveDraftDetails(siteId, formData) {
  const NUMERIC_FIELDS = [
    'score', 'estSales', 'nearestStarbucks', 'nearestTWC',
    'carpet', 'cam', 'rent', 'escalation', 'revshare',
    'rentFreeDays', 'cadex', 'capex', 'deposit', 'brokerage',
    'lockin', 'tenure', 'totalOpCost',
  ];
  const coerced = { ...formData };
  for (const key of NUMERIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(coerced, key)) {
      coerced[key] = toNumber(coerced[key]);
    }
  }
  return adapter.patchSiteDetails(siteId, { ...coerced, _savedAt: new Date().toISOString() });
}

// ── Shortlist delegations ──────────────────────────────────────────────────

export async function listSiteDelegations(siteId) {
  return adapter.listSiteDelegations(siteId);
}

export async function grantDelegation(siteId, payload) {
  return adapter.grantDelegation(siteId, payload);
}

export async function revokeDelegation(delegationId) {
  return adapter.revokeDelegation(delegationId);
}

export async function listMyDelegations() {
  return adapter.listMyDelegations();
}

export async function listUsers() {
  return adapter.listUsers();
}
