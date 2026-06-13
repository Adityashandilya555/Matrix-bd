import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { ROUTES } from './routes.js';

// RequireRole: redirects to overview if the current role is not in the allowed list.
// `roles` can contain canonical ROLE values or legacy display values.
// Treats 'exec' and 'executive' as the same role so HTTP-mode JWTs (which
// always emit 'executive') match guards that still list the legacy 'exec' alias.
// Shown while /auth/whoami is still resolving, so a guard never decides off the
// pre-hydration default session ('supervisor', module=null). (#114)
function HydratingGate() {
  return (
    <div style={{ padding: '4rem', textAlign: 'center', opacity: 0.6 }}>Loading…</div>
  );
}

export function RequireRole({ roles, children }) {
  const { role, authReady } = useSession();
  // Wait for the real role before judging it — the default pre-hydration role
  // is 'supervisor', which would misroute execs/business-admins. (#114)
  if (!authReady) return <HydratingGate />;
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
  const { role, session, authReady } = useSession();
  if (USE_MOCK) return children;
  // Wait for hydration — pre-hydration `session.module` is undefined, which
  // would bounce every module user off their deep link on refresh. (#114)
  if (!authReady) return <HydratingGate />;
  const module = session?.module;
  if (!module || !modules.includes(module)) {
    return <Navigate to={homeForSession(role, module)} replace />;
  }
  return children;
}

export function RequireScope({ kind, children }) {
  // TODO(auth): enforce scope from session claims — currently logs a warning
  // and passes through. When the identity service ships JWT scope claims,
  // replace the console.warn with a Navigate to UNAUTHORIZED.
  if (import.meta.env.DEV) {
    console.warn(`[RequireScope] kind="${kind}" — not yet enforced`);
  }
  return children;
}
