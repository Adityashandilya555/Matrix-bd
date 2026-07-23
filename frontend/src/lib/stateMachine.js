// Client-side mirror of backend app/domain/state_machine.py.
// Values MUST match the lowercase strings the backend persists in
// `sites.status` and emits in JSON responses. Mismatched casing here will
// silently hide every site in the UI because SitesContext compares with ===.
export const SiteStatus = {
  DRAFT_SUBMITTED:    'draft_submitted',
  SHORTLISTED:        'shortlisted',
  DETAILS_SUBMITTED:  'details_submitted',
  APPROVED:           'approved',
  LOI_UPLOADED:       'loi_uploaded',
  LEGAL_REVIEW:       'legal_review',
  LEGAL_APPROVED:     'legal_approved',
  LEGAL_REJECTED:     'legal_rejected',
  PUSHED_TO_PAYMENTS: 'pushed_to_payments',
  REJECTED:           'rejected',
  ARCHIVED:           'archived',
};

// Allowed transitions: { fromStatus: [toStatus, ...] }
export const ALLOWED_TRANSITIONS = {
  [SiteStatus.DRAFT_SUBMITTED]:    [SiteStatus.SHORTLISTED, SiteStatus.REJECTED, SiteStatus.ARCHIVED],
  [SiteStatus.SHORTLISTED]:        [SiteStatus.DETAILS_SUBMITTED, SiteStatus.REJECTED, SiteStatus.ARCHIVED],
  [SiteStatus.DETAILS_SUBMITTED]:  [SiteStatus.APPROVED, SiteStatus.REJECTED, SiteStatus.ARCHIVED],
  [SiteStatus.APPROVED]:           [SiteStatus.LOI_UPLOADED, SiteStatus.REJECTED, SiteStatus.ARCHIVED],
  // Send-back loop: a supervisor who rejects the uploaded LOI (wrong file)
  // returns the site to APPROVED so the executive re-uploads through the
  // unchanged APPROVED → LOI_UPLOADED path (see backend loi_service).
  [SiteStatus.LOI_UPLOADED]:       [SiteStatus.LEGAL_REVIEW, SiteStatus.APPROVED,
                                    SiteStatus.REJECTED, SiteStatus.ARCHIVED],
  [SiteStatus.LEGAL_REVIEW]:       [SiteStatus.LEGAL_APPROVED, SiteStatus.LEGAL_REJECTED],
  [SiteStatus.LEGAL_APPROVED]:     [SiteStatus.PUSHED_TO_PAYMENTS],
  // Recovery loop: a CR approval that flips the last failing DD item revives
  // the site back into LEGAL_REVIEW (see backend change_request_service).
  [SiteStatus.LEGAL_REJECTED]:     [SiteStatus.LEGAL_REVIEW],
  [SiteStatus.PUSHED_TO_PAYMENTS]: [], // terminal
  [SiteStatus.REJECTED]:           [], // terminal
  [SiteStatus.ARCHIVED]:           [], // terminal
};

export function canTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

export function assertTransition(fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus)) {
    throw new Error(`Invalid transition: ${fromStatus} -> ${toStatus}`);
  }
}

// LEGACY_STAGE_MAP: maps legacy display stage strings to canonical SiteStatus values.
// Used by SitesContext to back-compat components reading site.stage === 'draft' etc.
export const LEGACY_STAGE_MAP = {
  draft:       SiteStatus.DRAFT_SUBMITTED,
  shortlist:   SiteStatus.SHORTLISTED,
  inReview:    SiteStatus.DETAILS_SUBMITTED,
  staging:     SiteStatus.APPROVED,
  overdue:     SiteStatus.APPROVED,
  uploaded:    SiteStatus.LOI_UPLOADED,
  legal_review: SiteStatus.LEGAL_REVIEW,
  legal_approved: SiteStatus.LEGAL_APPROVED,
  legal_rejected: SiteStatus.LEGAL_REJECTED,
  completed:   SiteStatus.PUSHED_TO_PAYMENTS,
  rejected:    SiteStatus.REJECTED,
  archived:    SiteStatus.ARCHIVED,
};

// Reverse map: canonical SiteStatus -> legacy stage string used by page components.
const STATUS_TO_LEGACY = {
  [SiteStatus.DRAFT_SUBMITTED]:    'draft',
  [SiteStatus.SHORTLISTED]:        'shortlist',
  [SiteStatus.DETAILS_SUBMITTED]:  'shortlist', // inReview is derived separately via inReview boolean
  [SiteStatus.APPROVED]:           'staging',
  [SiteStatus.LOI_UPLOADED]:       'uploaded',
  [SiteStatus.LEGAL_REVIEW]:       'legal_review',
  [SiteStatus.LEGAL_APPROVED]:     'legal_approved',
  [SiteStatus.LEGAL_REJECTED]:     'legal_rejected',
  [SiteStatus.PUSHED_TO_PAYMENTS]: 'completed',
  [SiteStatus.REJECTED]:           'rejected',
  [SiteStatus.ARCHIVED]:           'archived',
};

// Returns the legacy stage string that render bodies expect.
// inReview flag is set separately on DETAILS_SUBMITTED sites.
export function legacyStageFor(status) {
  return STATUS_TO_LEGACY[status] || 'draft';
}
