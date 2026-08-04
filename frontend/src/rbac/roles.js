// ROLE enum — mirrors backend app/rbac/roles.py
export const ROLE = {
  EXECUTIVE: 'executive',
  SUPERVISOR: 'supervisor',
  BUSINESS_ADMIN: 'business_admin',
  // Workspace-wide READ-ONLY. Sees everything a business admin sees, modifies
  // nothing. The rule is enforced on the backend — app/rbac/guards.py grants an
  // observer every route guard, and app/core/deps.py refuses its every non-GET
  // request. Anything hidden on this side is presentation, not a boundary.
  OBSERVER: 'observer',
};

// Legacy aliases used in the existing component prop (`role === 'exec'`)
// Components compare against these strings; do not rename without updating all call sites.
export const ROLE_DISPLAY = {
  [ROLE.EXECUTIVE]: 'exec',
  [ROLE.SUPERVISOR]: 'supervisor',
  [ROLE.BUSINESS_ADMIN]: 'Business Admin',
  [ROLE.OBSERVER]: 'Observer',
};

// Convert from display/legacy value to canonical ROLE enum value
export function canonicalRole(displayRole) {
  if (displayRole === 'exec') return ROLE.EXECUTIVE;
  if (displayRole === 'supervisor') return ROLE.SUPERVISOR;
  if (displayRole === 'business_admin') return ROLE.BUSINESS_ADMIN;
  if (displayRole === 'observer') return ROLE.OBSERVER;
  return displayRole;
}
