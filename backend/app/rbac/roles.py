"""Role enum — mirrors frontend src/rbac/roles.js.

Three-role model (post 2026-05-26 refactor):
  business_admin  — tenant-wide admin; no module membership
  supervisor      — module supervisor (BD, Legal, Payment…)
  executive       — module executive (field ops)

Module scoping is done via user_module_memberships.module, NOT a separate role.
"""
from enum import Enum


class Role(str, Enum):
    BUSINESS_ADMIN = "business_admin"
    SUPERVISOR = "supervisor"
    EXECUTIVE = "executive"
