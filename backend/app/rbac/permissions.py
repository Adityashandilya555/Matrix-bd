"""Action -> allowed roles map.  Mirrors frontend src/rbac/permissions.js."""
from app.rbac.roles import Role

PERMISSIONS: dict[str, list[Role]] = {
    "create_draft":               [Role.EXECUTIVE],
    "save_draft_details":         [Role.EXECUTIVE],
    "submit_details_for_review":  [Role.EXECUTIVE],
    "upload_loi":                 [Role.EXECUTIVE],
    "view_own_loi":               [Role.EXECUTIVE],

    "shortlist":                  [Role.SUPERVISOR],
    "approve_details":            [Role.SUPERVISOR],
    "reject":                     [Role.SUPERVISOR],
    "archive":                    [Role.SUPERVISOR],
    "set_loi_timeline":           [Role.SUPERVISOR],
    "push_to_payments":           [Role.SUPERVISOR],
    "reassign_site":              [Role.SUPERVISOR],
    "manage_module_team":         [Role.SUPERVISOR],
}


def can(role: Role, action: str) -> bool:
    allowed = PERMISSIONS.get(action, [])
    return role in allowed
