"""Role enum — mirrors frontend src/rbac/roles.js."""
from enum import Enum


class Role(str, Enum):
    EXECUTIVE = "executive"
    SUPERVISOR = "supervisor"
    SUB_SUPERVISOR = "sub_supervisor"
    BUSINESS_ADMIN = "business_admin"
    SYSTEM = "system"
