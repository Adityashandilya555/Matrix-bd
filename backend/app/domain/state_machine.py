"""Canonical site state machine.

Mirrors frontend src/lib/stateMachine.js exactly.
Every state transition must pass through `assert_transition` before
being persisted; audit_service is called by the router after a successful transition.
"""
from enum import Enum
from fastapi import HTTPException, status


class SiteStatus(str, Enum):
    DRAFT_SUBMITTED    = "draft_submitted"
    SHORTLISTED        = "shortlisted"
    DETAILS_SUBMITTED  = "details_submitted"
    APPROVED           = "approved"
    LOI_UPLOADED       = "loi_uploaded"
    # ── Legal workflow (inserted between LOI and Payments) ──────────────────
    LEGAL_REVIEW       = "legal_review"    # BD pushed → awaiting legal supervisor
    LEGAL_APPROVED     = "legal_approved"  # legal cleared → ready for payments
    LEGAL_REJECTED     = "legal_rejected"  # legal rejected → BD notified; terminal
    # ── Payments (terminal until Payments module is built) ──────────────────
    PUSHED_TO_PAYMENTS = "pushed_to_payments"
    REJECTED           = "rejected"
    ARCHIVED           = "archived"


# Allowed transitions: from_status -> [to_status, ...]
ALLOWED_TRANSITIONS: dict[SiteStatus, list[SiteStatus]] = {
    SiteStatus.DRAFT_SUBMITTED:    [SiteStatus.SHORTLISTED,       SiteStatus.REJECTED, SiteStatus.ARCHIVED],
    SiteStatus.SHORTLISTED:        [SiteStatus.DETAILS_SUBMITTED, SiteStatus.REJECTED, SiteStatus.ARCHIVED],
    SiteStatus.DETAILS_SUBMITTED:  [SiteStatus.APPROVED,          SiteStatus.REJECTED, SiteStatus.ARCHIVED],
    SiteStatus.APPROVED:           [SiteStatus.LOI_UPLOADED,      SiteStatus.REJECTED, SiteStatus.ARCHIVED],
    # BD supervisor "Push" now sends to Legal Review (not directly to Payments).
    # Send-back loop: a supervisor who rejects the uploaded LOI (wrong file)
    # returns the site to APPROVED, so the executive re-uploads through the
    # unchanged APPROVED → LOI_UPLOADED path. loi_uploaded_at is cleared, so the
    # days-to-LOI clock keeps running from approved_at — the LOI genuinely is
    # not done yet.
    SiteStatus.LOI_UPLOADED:       [SiteStatus.LEGAL_REVIEW,      SiteStatus.APPROVED,
                                    SiteStatus.REJECTED,          SiteStatus.ARCHIVED],
    # Legal supervisor works through the 4-step checklist
    SiteStatus.LEGAL_REVIEW:       [SiteStatus.LEGAL_APPROVED,    SiteStatus.LEGAL_REJECTED],
    # Legal approved → Payments module (terminal until Payments is built)
    SiteStatus.LEGAL_APPROVED:     [SiteStatus.PUSHED_TO_PAYMENTS],
    # Recovery loop: BD opens a CR flipping the failing DD item; on legal approval
    # the recompute in change_request_service revives the site to LEGAL_REVIEW.
    SiteStatus.LEGAL_REJECTED:     [SiteStatus.LEGAL_REVIEW],
    SiteStatus.PUSHED_TO_PAYMENTS: [],  # terminal
    SiteStatus.REJECTED:           [],  # terminal
    SiteStatus.ARCHIVED:           [],  # terminal
}


def can_transition(from_status: SiteStatus, to_status: SiteStatus) -> bool:
    return to_status in ALLOWED_TRANSITIONS.get(from_status, [])


def assert_transition(from_status: SiteStatus, to_status: SiteStatus) -> None:
    """Raise HTTP 422 if the transition is not allowed."""
    if not can_transition(from_status, to_status):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid state transition: {from_status} -> {to_status}",
        )
