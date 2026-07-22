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
//
// When a business_admin is simulating a role+module via the admin override, we
// use the effectiveModule (the simulated module) instead of the raw JWT module
// so that switching to e.g. Legal doesn't bounce the admin back to /business-admin.
// Force mock mode off in production builds — a stray VITE_USE_MOCK must never
// leak the mock session / auth bypass into a deploy. (Mock removal planned.)
const USE_MOCK = (import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true) && !import.meta.env.PROD;

function homeForSession(effectiveRole, effectiveModule) {
  // When a business_admin is actively simulating, effectiveRole will be
  // 'supervisor' or 'executive' — route them like that role, not to the
  // admin portal.  Only route to /business-admin when they are NOT simulating.
  if (effectiveRole === 'business_admin') return '/business-admin';
  if (effectiveModule === 'legal')        return ROUTES.LEGAL;
  if (effectiveModule === 'design')       return ROUTES.DESIGN;
  if (effectiveModule === 'project')      return ROUTES.PROJECT;
  if (effectiveModule === 'nso')          return ROUTES.NSO;
  return ROUTES.OVERVIEW;
}

export function RequireModule({ modules, children }) {
  const { role, effectiveModule, isBusinessAdmin, authReady } = useSession();
  if (USE_MOCK) return children;
  // Wait for hydration — pre-hydration `session.module` is undefined, which
  // would bounce every module user off their deep link on refresh. (#114)
  if (!authReady) return <HydratingGate />;
  // Business admins simulating a module can access any module route that
  // matches their current override — effectiveModule already reflects the
  // override when active.
  const module = effectiveModule;
  // A business_admin with no active override has effectiveModule = null;
  // allow them through if they *are* business_admin (they can browse freely).
  if (isBusinessAdmin && !module) return children;
  if (!module || !modules.includes(module)) {
    return <Navigate to={homeForSession(role, module)} replace />;
  }
  return children;
}

// NOTE (#188): the former `RequireScope` guard was removed. It was a pass-through
// no-op (it only console.warned and returned children), wired to no route, and
// the backend JWT emits no scope claim to enforce — a guard that *looks* like it
// protects but doesn't is worse than none. Re-introduce real scope enforcement
// here (Navigate to UNAUTHORIZED on a failed claim check) only when the identity
// service actually ships JWT scope claims to check against.
