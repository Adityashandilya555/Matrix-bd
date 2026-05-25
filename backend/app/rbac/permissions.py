"""Action -> allowed roles map.  Mirrors frontend src/rbac/permissions.js.

Module-specific actions (legal_*, payment_*) are gated at the router level via
require_module() in addition to require_role(). The PERMISSIONS map only
expresses which top-level roles may perform an action; the module check
(user_module_memberships.module) is a separate orthogonal guard.
"""
from app.rbac.roles import Role

PERMISSIONS: dict[str, list[Role]] = {
    # ── Executive (any module) ────────────────────────────────────────────────
    "create_draft":               [Role.EXECUTIVE],
    "save_draft_details":         [Role.EXECUTIVE],
    "submit_details_for_review":  [Role.EXECUTIVE],
    "upload_loi":                 [Role.EXECUTIVE],
    "view_own_loi":               [Role.EXECUTIVE],

    # ── BD Supervisor ─────────────────────────────────────────────────────────
    "shortlist":                  [Role.SUPERVISOR],
    "approve_details":            [Role.SUPERVISOR],
    "reject":                     [Role.SUPERVISOR],
    "archive":                    [Role.SUPERVISOR],
    "set_loi_timeline":           [Role.SUPERVISOR],
    "send_to_legal":              [Role.SUPERVISOR],   # LOI_UPLOADED → LEGAL_REVIEW
    "push_to_payments":           [Role.SUPERVISOR],   # back-compat alias
    "reassign_site":              [Role.SUPERVISOR],
    "manage_module_team":         [Role.SUPERVISOR],

    # ── Legal module (module == 'legal') ──────────────────────────────────────
    # Router additionally calls require_module('legal'); role alone is not enough.
    "legal_view_queue":           [Role.SUPERVISOR, Role.EXECUTIVE],
    "legal_save_dd":              [Role.SUPERVISOR, Role.EXECUTIVE],
    "legal_finalize_dd":          [Role.SUPERVISOR],
    "legal_save_agreement":       [Role.SUPERVISOR],
    "legal_save_licensing":       [Role.SUPERVISOR],
}


def can(role: Role, action: str) -> bool:
    allowed = PERMISSIONS.get(action, [])
    return role in allowed
