import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { SiteStatus, legacyStageFor } from '../lib/stateMachine.js';
import * as siteService from '../services/api/siteService.js';
import { useSession } from './SessionContext.jsx';

// ============================================================
// SitesContext — unified site store.
// All site data lives in one `sites` array with canonical status.
// Components NEVER call setSites directly. All mutations go through siteService.
//
// LEGACY FIELD DERIVATIONS (computed at selector time, not stored):
//   draft.days           <- computed from visitDate vs today
//   draft.createdBy      <- mapped from site.createdBy.name (string for render)
//   shortlist.inReview   <- status === DETAILS_SUBMITTED
//   shortlist.stage      <- legacyStageFor(status)
//   staging.loiUploaded  <- status === LOI_UPLOADED || status === PUSHED_TO_PAYMENTS
//   staging.pushed       <- status === PUSHED_TO_PAYMENTS
//   staging.daysSinceApproval <- site._daysSinceApproval (stored on canonical site)
//   staging.draftDate    <- site._draftDate
//   staging.approvedDate <- site._approvedDate
//   staging.approvedBy   <- site._approvedBy
//   staging.daysToLOI    <- site._daysToLOI
//   staging.spocName     <- site._spocName || site.details?.spocName
//   staging.loiUploadedAt <- site._loiUploadedAt
//   archive.archivedAt   <- site.updatedAt (date site moved to ARCHIVED)
//   archive.reasons      <- site.rejectionReasons
//   archive.note         <- site.archiveNote
// ============================================================

const SitesContext = createContext(null);

// Helper: compute days between a visitDate ISO string and today
function daysSince(isoDate) {
  if (!isoDate) return 0;
  const d = new Date(isoDate + 'T00:00');
  const now = new Date();
  return Math.max(0, Math.round((now - d) / 86400000));
}

// Map canonical site to legacy draft shape expected by DraftsPage render bodies
function toDraftShape(site) {
  return {
    ...site,
    id: site.id,
    code: site.code,
    name: site.name,
    city: site.city,
    visitDate: site.visitDate,
    days: daysSince(site.visitDate),
    createdBy: site.createdBy?.name || site.createdBy || '',
    stage: legacyStageFor(site.status),
  };
}

// Map canonical site to legacy shortlist shape expected by ShortlistPage render bodies
function toShortlistShape(site) {
  return {
    ...site,
    code: site.code,
    name: site.name,
    city: site.city,
    visitDate: site.visitDate,
    createdBy: site.createdBy?.name || site.createdBy || '',
    score: site.score,
    estSales: site.estSales,
    carpet: site.carpet,
    rent: site.rent,
    rentType: site.rentType,
    totalOpCost: site.totalOpCost,
    hue: site.hue,
    inReview: site.status === SiteStatus.DETAILS_SUBMITTED,
    stage: legacyStageFor(site.status),
    details: site.details,
  };
}

// Map canonical site to legacy staging shape expected by ExecStagingPage and SupervisorStagingPage
function toStagingShape(site) {
  const loiUploaded = site.status === SiteStatus.LOI_UPLOADED || site.status === SiteStatus.PUSHED_TO_PAYMENTS;
  const pushed = site.status === SiteStatus.PUSHED_TO_PAYMENTS;
  return {
    ...site,
    id: site.id,
    code: site.code,
    name: site.name,
    city: site.city,
    createdBy: site.createdBy?.name || site.createdBy || '',
    spocName: site._spocName || site.details?.spocName || site.createdBy?.name || '',
    draftDate: site._draftDate || site.visitDate,
    approvedDate: site._approvedDate || '',
    approvedBy: site._approvedBy || '',
    expectedLoiDays: site.expectedLoiDays || 14,
    daysSinceApproval: site._daysSinceApproval || 0,
    loiUploaded,
    loiUploadedAt: site._loiUploadedAt || null,
    daysToLOI: site._daysToLOI ?? null,
    pushed,
    stage: legacyStageFor(site.status),
    loiUrl: site.loiUrl,
  };
}

// Map canonical site to legacy archive shape expected by ArchivePage render bodies
function toArchiveShape(site) {
  return {
    ...site,
    id: site.id,
    code: site.code,
    name: site.name,
    city: site.city,
    createdBy: site.createdBy?.name || site.createdBy || '',
    archivedAt: site._archivedAt || site.updatedAt?.slice(0, 10) || '',
    reasons: site.rejectionReasons || [],
    note: site.archiveNote || '',
    stage: 'archived',
  };
}

export function SitesProvider({ children }) {
  // Single source of truth — canonical site objects
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initial load from service
  useEffect(() => {
    siteService.listSites()
      .then(data => { setSites(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  // Refresh helper — re-fetches entire list from service
  const refresh = useCallback(async () => {
    const data = await siteService.listSites();
    setSites(data);
  }, []);

  // ---- Derived selectors (memoized) ----
  // These preserve the exact property names that render bodies destructure.

  const drafts = useMemo(() =>
    sites
      .filter(s => s.status === SiteStatus.DRAFT_SUBMITTED)
      .map(toDraftShape),
  [sites]);

  const shortlist = useMemo(() =>
    sites
      .filter(s => s.status === SiteStatus.SHORTLISTED || s.status === SiteStatus.DETAILS_SUBMITTED)
      .map(toShortlistShape),
  [sites]);

  // All staging sites: APPROVED + LOI_UPLOADED + PUSHED_TO_PAYMENTS
  const staging = useMemo(() =>
    sites
      .filter(s =>
        s.status === SiteStatus.APPROVED ||
        s.status === SiteStatus.LOI_UPLOADED ||
        s.status === SiteStatus.PUSHED_TO_PAYMENTS
      )
      .map(toStagingShape),
  [sites]);

  const archive = useMemo(() =>
    sites
      .filter(s => s.status === SiteStatus.ARCHIVED || s.status === SiteStatus.REJECTED)
      .map(toArchiveShape),
  [sites]);

  // ---- Action helpers — all go through siteService, then refresh ----

  const moveDraftToShortlist = useCallback(async (draft) => {
    await siteService.shortlistSite(draft.id, 'supervisor');
    await refresh();
  }, [refresh]);

  const rejectDraft = useCallback(async (draft, reasons, comment) => {
    await siteService.rejectSite(draft.id, reasons, comment, 'supervisor');
    await refresh();
  }, [refresh]);

  const archiveDraft = useCallback(async (draft) => {
    await siteService.archiveSite(draft.id, 'Archived for future reference', 'supervisor');
    await refresh();
  }, [refresh]);

  const saveDraftDetails = useCallback(async (item, formData) => {
    await siteService.saveDraftDetails(item.id, formData);
    await refresh();
  }, [refresh]);

  const submitDetailsForReview = useCallback(async (item, formData) => {
    await siteService.submitDetails(item.id, formData, 'exec');
    await refresh();
  }, [refresh]);

  const approveShortlistToStaging = useCallback(async (item, days) => {
    await siteService.approveSite(item.id, days, 'supervisor', item.details?.spocName || item.createdBy);
    await refresh();
  }, [refresh]);

  const uploadLOI = useCallback(async (site, file) => {
    const blobUrl = file ? URL.createObjectURL(file) : null;
    await siteService.uploadLoi(site.id, {
      name: file?.name || 'loi.pdf',
      size: file?.size,
      type: file?.type,
      blobUrl,
    }, site.createdBy);
    await refresh();
  }, [refresh]);

  const pushSite = useCallback(async (site) => {
    await siteService.pushToPayments(site.id, 'supervisor');
    await refresh();
  }, [refresh]);

  const createDraft = useCallback(async (form, createdByName) => {
    // Pipeline-stage fields (model, spocName, googlePin, rentType, expectedRent) are
    // forwarded so they land on the sites row at creation; they stay editable at
    // shortlist and any subsequent edit is diff-logged into the activity feed.
    await siteService.createSite({
      name: form.name,
      city: form.city,
      visitDate: form.visitDate,
      model: form.model || null,
      spocName: form.spocName || null,
      googlePin: form.googlePin || null,
      rentType: form.rentType || null,
      expectedRent: form.expectedRent ? Number(form.expectedRent) : null,
      createdBy: { id: 'user_riya', name: createdByName },
      tenantId: 'bt-tenant-001',
    });
    await refresh();
  }, [refresh]);

  return (
    <SitesContext.Provider value={{
      // Derived legacy-compatible arrays
      drafts, shortlist, staging, archive,
      // Loading/error state
      loading, error,
      // Action methods — all async, all go through siteService
      moveDraftToShortlist, rejectDraft, archiveDraft,
      saveDraftDetails, submitDetailsForReview, approveShortlistToStaging,
      uploadLOI, pushSite, createDraft,
      // Raw sites array for advanced use
      sites,
      refresh,
    }}>
      {children}
    </SitesContext.Provider>
  );
}

export function useSites() {
  const ctx = useContext(SitesContext);
  if (!ctx) throw new Error('useSites must be used within SitesProvider');
  return ctx;
}
