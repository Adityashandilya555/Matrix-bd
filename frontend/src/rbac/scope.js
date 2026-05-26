import { ROLE } from './roles.js';

// Scope resolution: given a user and a list of items,
// return only the items visible to that user.
//
// Scopes:
//   own        — items where item.createdBy === user.name (executive)
//   department — all items within the tenant (supervisor)
//   tenant     — same as department for now (single-tenant MVP)

export function resolveScope(role) {
  if (role === ROLE.EXECUTIVE || role === 'exec') return 'own';
  return 'tenant';
}

export function filterByScope(items, role, user) {
  const scope = resolveScope(role);
  if (scope === 'own') return items.filter(i => i.createdBy === user.name);
  return items; // tenant / department scope sees all
}
