// skipcq: JS-0833
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { SiteStatus, legacyStageFor } from '../lib/stateMachine.js';
import * as siteService from '../services/api/siteService.js';
import { useSession } from './SessionContext.jsx';
import { getAuthToken } from '../services/api/authToken.js';
import { notifySiteDataChanged, subscribeSiteDataChanged } from '../services/api/siteEvents.js';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;

// In HTTP mode the store must stay idle until the user is signed in. The
// provider wraps the WHOLE app (including the public landing), so firing
// /api/sites on mount / on the 30s poll / on window-focus while logged out
// produced tokenless 401s — which the HTTP adapter then surfaced as the
// "session paused" modal right after login (the early /sites 401s resolve on an
// authed route). Gate every fetch on having a token. (popup-on-login fix)
function _isAuthed() {
  return USE_MOCK || Boolean(getAuthToken());
}

// SitesContext — unified site store.
// Single `sites` array with canonical status; components never call setSites
// directly. All mutations go through siteService, then refresh.
//
// Legacy field derivations (computed at selector time, not stored):
//   draft.days           <- daysSince(visitDate)
//   draft.createdBy      <- site.createdBy.name (string for render)
//   shortlist.inReview   <- status === DETAILS_SUBMITTED
//   shortlist.stage      <- legacyStageFor(status)
//   staging.loiUploaded  <- status >= LOI_UPLOADED
//   staging.pushed       <- status in Legal/Payments
//   staging.daysSinceApproval / draftDate / approvedDate / approvedBy / daysToLOI / loiUploadedAt
//   archive.archivedAt   <- site.updatedAt
//   archive.reasons      <- site.rejectionReasons
//   archive.note         <- site.archiveNote

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
    submittedBy: site.submittedBy || site.createdBy?.id || '',
    assignedTo: site.assignedTo || null,
    assignedToId: site.assignedTo?.id || '',
    assignedToName: site.assignedTo?.name || '',
    supervisorId: site.supervisorId || '',
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
  const legalOrPaymentStatus = [
    SiteStatus.LEGAL_REVIEW,
    SiteStatus.LEGAL_APPROVED,
    SiteStatus.PUSHED_TO_PAYMENTS,
  ].includes(site.status);
  const loiUploaded = site.status === SiteStatus.LOI_UPLOADED || legalOrPaymentStatus;
  const pushed = legalOrPaymentStatus;
  return {
    ...site,
    id: site.id,
    code: site.code,
    name: site.name,
    city: site.city,
    submittedBy: site.submittedBy || site.createdBy?.id || '',
    assignedTo: site.assignedTo || null,
    assignedToId: site.assignedTo?.id || '',
    assignedToName: site.assignedTo?.name || '',
    supervisorId: site.supervisorId || '',
    createdBy: site.createdBy?.name || site.createdBy || '',
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
  const { user, session, role, authReady } = useSession();

  // Load on mount AND whenever the signed-in identity or active role changes
  // (re-login or the role switcher). Without the identity key the store kept the
  // first session's cached list, so a delegated executive never saw sites the
  // backend now scopes to them. Keyed on primitives so it doesn't re-run every
  // render.
  const identityKey = session?.userId || session?.id || session?.email || '';
  useEffect(() => {
    let alive = true;
    if (!USE_MOCK && !authReady) { return () => { alive = false; }; }
    // Logged out → don't issue a tokenless /api/sites request (it 401s and would
    // pop the session-expired modal). Reset to a clean empty state instead.
    if (!_isAuthed()) {
      setSites([]);
      setError(null);
      setLoading(false);
      return () => { alive = false; };
    }
    setLoading(true);
    siteService.listSites()
      .then(data => { if (alive) { setSites(data); setLoading(false); } })
      .catch(err => { if (alive) { setError(err.message); setLoading(false); } });
    return () => { alive = false; };
  }, [identityKey, role, authReady]);

  // Refresh helper — re-fetches entire list from service
  const refresh = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);
    try {
      const data = await siteService.listSites();
      setSites(data);
    } catch (err) {
      if (isBackground && err?.code === 'TIMEOUT') return;
      setError(err.message);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  const refreshAndBroadcast = useCallback(async (action) => {
    await refresh();
    notifySiteDataChanged({ source: 'SitesContext', action });
  }, [refresh]);

  useEffect(() => {
    // Never poll while signed out — a tokenless refresh 401s and re-pops the
    // session modal. (popup-on-login fix)
    const run = () => { if (_isAuthed()) refresh(true).catch(err => { if (err?.code !== 'TIMEOUT') setError(err.message); }); };
    const unsubscribe = subscribeSiteDataChanged((detail) => {
      if (detail?.source !== 'SitesContext') run();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', onVisible);
    // Background poll: surfaces cross-session changes — e.g. a supervisor
    // delegating a site to this executive — in the sidebar/queues without a
    // manual refresh or tab re-focus.
    const pollId = window.setInterval(run, 30000);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(pollId);
    };
  }, [refresh]);

  // ---- Derived selectors (memoized) ----
  // Preserve the exact property names that render bodies destructure.

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

  // All staging/downstream sites: APPROVED + LOI_UPLOADED + Legal + Payments.
  const staging = useMemo(() =>
    sites
      .filter(s =>
        s.status === SiteStatus.APPROVED ||
        s.status === SiteStatus.LOI_UPLOADED ||
        s.status === SiteStatus.LEGAL_REVIEW ||
        s.status === SiteStatus.LEGAL_APPROVED ||
        s.status === SiteStatus.PUSHED_TO_PAYMENTS
      )
      .map(toStagingShape),
  [sites]);

  const archive = useMemo(() =>
    sites
      .filter(s => s.status === SiteStatus.ARCHIVED || s.status === SiteStatus.REJECTED || s.status === SiteStatus.LEGAL_REJECTED)
      .map(toArchiveShape),
  [sites]);

  // ---- Action helpers — all go through siteService, then refresh ----

  const moveDraftToShortlist = useCallback(async (draft) => {
    await siteService.shortlistSite(draft.id, 'supervisor');
    await refreshAndBroadcast('shortlist');
  }, [refreshAndBroadcast]);

  const rejectDraft = useCallback(async (draft, reasons, comment) => {
    await siteService.rejectSite(draft.id, reasons, comment, 'supervisor');
    await refreshAndBroadcast('reject');
  }, [refreshAndBroadcast]);

  const archiveDraft = useCallback(async (draft, note) => {
    // Note is mandatory at the backend (see svc_archive_site). We don't paper
    // over a missing reason here — surface the validation error to the UI so
    // the user knows why their click did nothing.
    if (!note || !String(note).trim()) {
      throw new Error('A reason is required to archive a site.');
    }
    await siteService.archiveSite(draft.id, String(note).trim(), 'supervisor');
    await refreshAndBroadcast('archive');
  }, [refreshAndBroadcast]);

  const reviveSite = useCallback(async (site, note) => {
    // Supervisor-only path on the backend; revives an archived site back to
    // the stage it was at when archived (see backend.bd_service.svc_revive_site).
    await siteService.reviveSite(site.id, note);
    await refreshAndBroadcast('revive');
  }, [refreshAndBroadcast]);

  const saveDraftDetails = useCallback(async (item, formData) => {
    // Tag who is editing so a supervisor amending an exec's details is recorded
    // distinctly (yellow flag + eye highlight until the exec re-reads). Over HTTP
    // the server derives this from the JWT and ignores the hint; the mock reads it.
    const editorRole = (role === 'supervisor' || role === 'business_admin') ? 'supervisor' : 'executive';
    await siteService.saveDraftDetails(item.id, { ...formData, _editorRole: editorRole, _actor: user?.name });
    await refreshAndBroadcast('save_details');
  }, [refreshAndBroadcast, role, user]);

  const markSiteViewed = useCallback(async (siteId) => {
    await siteService.markSiteViewed(siteId);
    await refreshAndBroadcast('mark_viewed');
  }, [refreshAndBroadcast]);

  const submitDetailsForReview = useCallback(async (item, formData) => {
    await siteService.submitDetails(item.id, formData, 'exec');
    await refreshAndBroadcast('submit_details');
  }, [refreshAndBroadcast]);

  const approveShortlistToStaging = useCallback(async (item, days) => {
    await siteService.approveSite(item.id, days, 'supervisor');
    await refreshAndBroadcast('approve_shortlist');
  }, [refreshAndBroadcast]);

  const uploadLOI = useCallback(async (site, file) => {
    const blobUrl = file ? URL.createObjectURL(file) : null;
    await siteService.uploadLoi(site.id, {
      name: file?.name || 'loi.pdf',
      size: file?.size,
      type: file?.type,
      blobUrl,
      raw: file,
    }, site.createdBy);
    await refreshAndBroadcast('upload_loi');
  }, [refreshAndBroadcast]);

  const pushSite = useCallback(async (site) => {
    await siteService.pushToPayments(site.id, 'supervisor');
    await refreshAndBroadcast('send_to_legal');
  }, [refreshAndBroadcast]);

  const createDraft = useCallback(async (form, createdByName) => {
    // Pipeline-stage fields (model, googlePin, rentType, expectedRent) are
    // forwarded so they land on the sites row at creation; they stay editable at
    // shortlist and any subsequent edit is diff-logged into the activity feed.
    //
    // createdBy / tenantId: the HTTP backend derives both from the bearer JWT
    // (sub → submitted_by, tenant_id claim → tenant_id). The mock adapter, on
    // the other hand, persists whatever is passed. So we send the session
    // user's identity to keep mock fixtures consistent with the logged-in
    // role switcher, and the HTTP adapter simply ignores these two fields.
    const sessionDisplayName = createdByName || user?.name || session?.email || 'unknown';
    await siteService.createSite({
      name: form.name,
      city: form.city,
      visitDate: form.visitDate,
      model: form.model || null,
      spocName: form.spocName || null,
      googlePin: form.googlePin || null,
      googleMapsUrl: form.googleMapsUrl || null,
      rentType: form.rentType || null,
      expectedRent: ['fixed', 'mg_revshare', 'staggered'].includes(form.rentType) && form.expectedRent ? Number(form.expectedRent) : null,
      expectedEscalationPct: ['fixed', 'mg_revshare'].includes(form.rentType) && form.expectedEscalation ? Number(form.expectedEscalation) : null,
      expectedEscalationYears: ['fixed', 'mg_revshare'].includes(form.rentType) && form.expectedEscalationYears ? Number(form.expectedEscalationYears) : null,
      expectedRevsharePct: ['revshare', 'mg_revshare'].includes(form.rentType) && form.expectedRevshare ? Number(form.expectedRevshare) : null,
      areaSqft: form.areaSqft ? Number(form.areaSqft) : null,
      staggeredEscalation: form.rentType === 'staggered'
        ? (form.staggeredEscalation || [])
            .filter(e => e.year !== '' && e.year != null && e.percent !== '' && e.percent != null)
            .map(e => ({ year: Number(e.year), percent: Number(e.percent) }))
        : null,
      createdBy: { id: session?.id || session?.sub || undefined, name: sessionDisplayName, role },
      role,
      tenantId: user?.tenantId,
    });
    await refreshAndBroadcast('create_draft');
  }, [refreshAndBroadcast, user, session, role]);

  const value = useMemo(() => ({
    drafts, shortlist, staging, archive,
    loading, error,
    moveDraftToShortlist, rejectDraft, archiveDraft, reviveSite,
    saveDraftDetails, submitDetailsForReview, approveShortlistToStaging, markSiteViewed,
    uploadLOI, pushSite, createDraft,
    sites,
    refresh,
  }), [drafts, shortlist, staging, archive, loading, error, moveDraftToShortlist, rejectDraft, archiveDraft, reviveSite, saveDraftDetails, submitDetailsForReview, approveShortlistToStaging, markSiteViewed, uploadLOI, pushSite, createDraft, sites, refresh]);

  return (
    <SitesContext.Provider value={value}>
      {children}
    </SitesContext.Provider>
  );
}

export function useSites() {
  const ctx = useContext(SitesContext);
  if (!ctx) throw new Error('useSites must be used within SitesProvider');
  return ctx;
}
