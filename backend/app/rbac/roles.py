"""Role enum — mirrors frontend src/rbac/roles.js."""
from enum import Enum


class Role(str, Enum):
    BUSINESS_ADMIN = "business_admin"
    SUPERVISOR = "supervisor"
    EXECUTIVE = "executive"
    SYSTEM = "system"
