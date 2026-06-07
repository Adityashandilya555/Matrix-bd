import { ROLE } from './roles.js';

// Scope resolution: given a user and a list of items,
// return only the items visible to that user.
//
// Scopes:
//   own        — items created by or assigned to the user (executive)
//   department — all items within the tenant (supervisor)
//   tenant     — same as department for now (single-tenant MVP)

export function resolveScope(role) {
  if (role === ROLE.EXECUTIVE || role === 'exec') return 'own';
  return 'tenant';
}

export function filterByScope(items, role, user) {
  const scope = resolveScope(role);
  if (scope === 'own') {
    const userName = String(user?.name || '');
    const userId = String(user?.id || user?.userId || '');
    return items.filter((item) => {
      const createdBy = String(item.createdBy || '');
      const submittedBy = String(item.submittedBy || '');
      const assignedToId = String(item.assignedToId || item.assignedTo?.id || '');
      const assignedToName = String(item.assignedToName || item.assignedTo?.name || '');
      return (
        createdBy === userName ||
        assignedToName === userName ||
        (userId && (submittedBy === userId || assignedToId === userId))
      );
    });
  }
  return items; // tenant / department scope sees all
}
