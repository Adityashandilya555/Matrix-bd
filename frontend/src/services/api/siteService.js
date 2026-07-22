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
  // Coerce every numeric field before sending. Form inputs are raw strings;
  // the backend's status-patch dispatcher writes payload.details straight to
  // NUMERIC columns without Pydantic — string values silently corrupt optional
  // fields (capex, deposit, escalation, revshare, etc.). No unit conversion:
  // amounts are stored as entered and rendered as "₹ X L" / "₹ X k" by the UI.
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
    areaSqft:         toNumber(formData.areaSqft),
    staggeredEscalation: formData.rentType === 'staggered'
      ? (formData.staggeredEscalation || [])
          .filter(e => e.year !== '' && e.year != null && e.percent !== '' && e.percent != null)
          .map(e => ({ year: Number(e.year), percent: Number(e.percent) }))
      : undefined,
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

// Signed URL + metadata for the uploaded LOI, so a supervisor can preview it
// before pushing to Legal or sending it back.
export async function viewLoi(siteId) {
  return adapter.viewLoi(siteId);
}

export async function sendBackLoi(siteId, comments) {
  return adapter.sendBackLoi(siteId, comments);
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

// Saves partial details in place (does not transition status).
// Same numeric coercion as submitDetails — avoids optional fields round-tripping
// back as empty when the adapter writes strings to NUMERIC columns.
export async function saveDraftDetails(siteId, formData) {
  const NUMERIC_FIELDS = [
    'score', 'estSales', 'nearestStarbucks', 'nearestTWC',
    'carpet', 'cam', 'rent', 'escalation', 'revshare',
    'rentFreeDays', 'cadex', 'capex', 'deposit', 'brokerage',
    'lockin', 'tenure', 'totalOpCost', 'areaSqft',
  ];
  const coerced = { ...formData };
  for (const key of NUMERIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(coerced, key)) {
      coerced[key] = toNumber(coerced[key]);
    }
  }
  // Only send the staggered schedule for staggered rent, and drop partial/empty
  // rows. The form always seeds a [{ year: 1, percent: '' }] row, and the backend
  // StaggeredEscalationItem.percent is a required float — sending percent: ''
  // (e.g. on a revshare draft) fails numeric validation. Mirrors submitDetails.
  coerced.staggeredEscalation = formData.rentType === 'staggered'
    ? (formData.staggeredEscalation || [])
        .filter(e => e.year !== '' && e.year != null && e.percent !== '' && e.percent != null)
        .map(e => ({ year: Number(e.year), percent: Number(e.percent) }))
    : undefined;
  return adapter.patchSiteDetails(siteId, { ...coerced, _savedAt: new Date().toISOString() });
}

// Acknowledge supervisor edits on a site so its yellow flag + per-field eye
// highlight clear for the executive. No-op server-side when nothing is unseen.
export async function markSiteViewed(siteId) {
  return adapter.markSiteViewed(siteId);
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
