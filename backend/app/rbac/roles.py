"""Role enum — mirrors frontend src/rbac/roles.js.

Four-role model:
  business_admin  — tenant-wide admin; no module membership
  observer        — tenant-wide READ-ONLY; no module membership
  supervisor      — module supervisor (BD, Legal, Payment…)
  executive       — module executive (field ops)

Module scoping is done via user_module_memberships.module, NOT a separate role.

`observer` is two grants and one deny, and the three must be read together — the
grants are deliberately wide, and the deny is the only thing that makes them safe:

  1. app/rbac/guards.py — an observer satisfies every require_role and
     require_module, exactly as business_admin does. Without this it would 403 on
     the 85 GET routes carrying a role or module dependency and could see nothing.
  2. app/core/deps.py   — every non-GET request from an observer is refused at
     get_current_user, the single dependency all 106 tenant-scoped mutating
     routes pass through.

So: reads everything, writes nothing. An observer holds no module membership and
never appears as an actor, which is why neither
user_module_memberships.role_in_module nor stage_events.actor_role was widened to
include it — those constraints now assert that passively.
"""
from enum import Enum


class Role(str, Enum):
    BUSINESS_ADMIN = "business_admin"
    OBSERVER = "observer"
    SUPERVISOR = "supervisor"
    EXECUTIVE = "executive"


# Roles that see the whole workspace and therefore bypass the per-route role and
# module guards. business_admin may also act; observer may not — that difference
# is enforced in app/core/deps.py, NOT here.
#
# One constant so require_role and require_module cannot drift: they are two
# halves of the same grant, and a role admitted by one but not the other would
# fail on module routes only, which is a confusing shape of bug.
READ_ALL_ROLES: frozenset[str] = frozenset({
    Role.BUSINESS_ADMIN.value,
    Role.OBSERVER.value,
})
