import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { ROUTES } from './routes.js';

// RequireRole: redirects to overview if the current role is not in the allowed list.
// `roles` can contain canonical ROLE values or legacy display values.
// Treats 'exec' and 'executive' as the same role so HTTP-mode JWTs (which
// always emit 'executive') match guards that still list the legacy 'exec' alias.
export function RequireRole({ roles, children }) {
  const { role } = useSession();
  const allowed = new Set(roles);
  if (allowed.has('exec'))      allowed.add('executive');
  if (allowed.has('executive')) allowed.add('exec');
  if (!allowed.has(role)) {
    return <Navigate to={ROUTES.OVERVIEW} replace />;
  }
  return children;
}

// RequireModule: gates module routes by the JWT/session module claim.
// In mock mode (no session) we allow access so previews keep working; in HTTP
// mode the session must carry the matching `module` claim. Business admins and
// any user with a missing/mismatched module get bounced back to their home —
// never silently shown a page that 403s on every request.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;

function homeForSession(role, module) {
  if (role === 'business_admin') return '/business-admin';
  if (module === 'legal')        return ROUTES.LEGAL;
  if (module === 'design')       return ROUTES.DESIGN;
  if (module === 'project')      return ROUTES.PROJECT;
  if (module === 'nso')          return ROUTES.NSO;
  return ROUTES.OVERVIEW;
}

export function RequireModule({ modules, children }) {
  const { role, session } = useSession();
  if (USE_MOCK) return children;
  const module = session?.module;
  if (!module || !modules.includes(module)) {
    return <Navigate to={homeForSession(role, module)} replace />;
  }
  return children;
}

// RequireScope: gates a route by scope kind.
// `kind` is 'own' | 'city' | 'department' | 'tenant'
// For the current MVP with a mock session this always passes — wire real logic
// once the identity service is integrated.
export function RequireScope({ kind, children }) {
  // TODO(auth): enforce scope from session claims
  return children;
}
