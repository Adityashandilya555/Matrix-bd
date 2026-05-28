// Public site service — all site reads and writes go through here.
// Components never call adapters or mock/* directly.
// All functions return promises with canonical site shape.

import { adapter } from './adapters/index.js';
import { SiteStatus } from '../../lib/stateMachine.js';

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
  // cadex…) — store them as entered. No unit conversion. The backend column
  // types are NUMERIC and a higher-up renderer is responsible for "₹ X.XX L"
  // / "₹ X k" presentation. Anything else corrupts the data going in.
  const toNumber = (v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(String(v).replace(/[,\s₹]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };
  return transitionSite(siteId, SiteStatus.DETAILS_SUBMITTED, {
    by,
    details: formData,
    score:       toNumber(formData.score),
    estSales:    toNumber(formData.estSales),
    carpet:      toNumber(formData.carpet),
    rent:        toNumber(formData.rent),
    rentType:    formData.rentType,
    totalOpCost: toNumber(formData.totalOpCost),
  });
}

export async function approveSite(siteId, days, by, spocName) {
  return transitionSite(siteId, SiteStatus.APPROVED, {
    expectedLoiDays: days,
    by,
    spocName,
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

export async function createSite(payload) {
  return adapter.createSite(payload);
}

export async function assignSite(siteId, execId) {
  return adapter.assignSite(siteId, execId);
}

// Save partial details (stays in current status, does not transition)
export async function saveDraftDetails(siteId, formData) {
  return adapter.patchSiteDetails(siteId, { ...formData, _savedAt: new Date().toISOString() });
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
