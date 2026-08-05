import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_SESSION, me as fetchMe, logout as logoutApi } from '../services/api/authService.js';
import { can, PERMISSIONS } from '../rbac/permissions.js';
import { ROLE } from '../rbac/roles.js';
import {
  SESSION_EXPIRED_EVENT,
  subscribeAuthToken,
  getAuthToken,
  clearAuthToken,
  notifySessionExpired,
} from '../services/api/authToken.js';
import { signOut as supabaseSignOut } from '../services/api/supabaseAuth.js';
import { getStoredOverride, activateOverride, deactivateOverride, subscribeOverride } from '../services/api/adminOverride.js';
import { setSessionRole } from '../services/api/readOnlyGuard.js';
import { useInactivityLogout } from '../hooks/useInactivityLogout.js';

// SessionContext — holds the current user session and role.
// In MOCK mode the session comes from DEFAULT_SESSION (legacy: Riya Sharma as supervisor).
// In HTTP mode the session is populated from /users/me after login.
// Role switcher only works in mock mode; in HTTP mode role comes from the JWT.

// Force mock mode off in production builds — a stray VITE_USE_MOCK must never
// leak the mock session / auth bypass into a deploy. (Mock removal planned.)
const USE_MOCK = (import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true) && !import.meta.env.PROD;

// Build initial session from DEFAULT_SESSION to preserve legacy behavior.
// Legacy default was 'supervisor' for the role switcher.
const INITIAL_SESSION = {
  ...DEFAULT_SESSION,
  role: 'supervisor',
};

const SessionContext = createContext(null);

// The roles an observer may view a module as. Mirrors _OBSERVER_OVERRIDE_ROLES
// in backend/app/core/deps.py — the backend ignores anything else, so offering
// more here would just produce a switch that silently does nothing.
export const OBSERVER_VIEW_ROLES = [ROLE.SUPERVISOR, ROLE.EXECUTIVE];

// Only a genuine auth rejection (401/403) means the token is stale and should
// be dropped. A timeout / network blip / 5xx surfaces as ApiError status 0 or
// >=500 — those must NOT log the user out (a Railway cold start would sign
// everyone out on refresh). Exported for tests. (#128)
export function isAuthRejection(err) {
  const status = err?.status;
  return status === 401 || status === 403;
}

export function SessionProvider({ children }) {
  const [session, setSession] = useState(INITIAL_SESSION);
  // Admin role/module override — only activates when the real JWT role is business_admin.
  // Persisted via sessionStorage so navigating between portals preserves the state.
  const [adminOverride, _setAdminOverride] = useState(() => getStoredOverride());
  // authReady: false until the first /auth/whoami resolves (HTTP mode). The
  // shell must not fire role-gated calls (e.g. the supervisor-only pending-users
  // badge) while the session still holds the pre-hydration default role
  // ('supervisor'), or a non-supervisor token triggers a transient 403/401.
  // Mock mode is ready immediately — the session is the static default.
  const [authReady, setAuthReady] = useState(USE_MOCK);
  const [sessionExpired, setSessionExpired] = useState(null);

  // Auto sign-out after 8h of no user interaction (HTTP mode only). Keyed on
  // real input events, so background queue polling doesn't keep a session alive.
  useInactivityLogout({ enabled: !USE_MOCK });
  // True once a /auth/whoami has SUCCEEDED this page-load. It lets us tell a
  // token that was dead on arrival (a stale token left over from a deploy that
  // invalidated it — there was never a live session to "pause", so drop it
  // silently and let the router show /welcome or /login) apart from a genuine
  // mid-session expiry (the token was live, then lapsed — show the modal so an
  // in-progress form isn't wiped). Without this, every returning visitor with a
  // stale token got a blocking "SESSION PAUSED" modal over the public landing.
  const hadLiveSessionRef = useRef(false);
  // Hydrate dark from localStorage so the choice survives refresh and any
  // provider re-mount (e.g. StrictMode double-invoke, route-driven unmount).
  const [dark, setDark] = useState(() => {
    try {
      const stored = window.localStorage.getItem('zm:dark');
      if (stored === '1') return true;
      if (stored === '0') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch { return false; }
  });

  // isBusinessAdmin: true when the true underlying JWT role is business_admin (regardless of override).
  const isBusinessAdmin = session.realRole === 'business_admin';
  // isObserver: the workspace-wide read-only role. Like isBusinessAdmin this
  // reads realRole, so it stays true while the observer is viewing a module as
  // that module's supervisor.
  const isObserver = session.realRole === ROLE.OBSERVER;
  // isDualRoleSupervisor: true when the user is a supervisor with executive access.
  const isDualRoleSupervisor = session.realRole === 'supervisor' && session.hasExecutiveAccess;
  // effectiveModule: the module being simulated, or the real session module.
  const effectiveModule = ((isBusinessAdmin || isObserver || isDualRoleSupervisor) && adminOverride?.module) || session.module;
  // role: the display/canonical string used by existing components. For business_admin
  // with an active override this returns the simulated role so RequireAuth and all UI
  // adapt automatically. realRole always returns the true JWT role.
  //
  // An observer gets the same treatment for the same reason — RequireAuth reads
  // this, so an observer with no override stays 'observer' and is bounced to
  // /observer, while one that has entered a module reads as that module's
  // supervisor and is let through. Its override role is allowlisted to the two
  // OBSERVER_VIEW_ROLES, matching app/core/deps.py: presenting as a
  // business_admin would satisfy admin-tier service checks.
  //
  // Note the fallback is realRole, NOT session.role. whoami is a GET, so it
  // carries the override header and echoes the SIMULATED role back — falling
  // back to it would leave `role` stuck at 'supervisor' after the override is
  // dropped, and RequireAuth would keep an observer in a shell it just left.
  const role = isBusinessAdmin ? (adminOverride?.role || session.role)
             : isObserver ? (OBSERVER_VIEW_ROLES.includes(adminOverride?.role) ? adminOverride.role : session.realRole)
             : isDualRoleSupervisor ? (['supervisor', 'executive'].includes(adminOverride?.role) ? adminOverride.role : session.role)
             : session.role;

  // setRole: allows role switcher to change role locally in mock mode.
  const setRole = useCallback((newRole) => {
    setSession(prev => ({ ...prev, role: newRole }));
  }, []);

  // switchAs: lets business_admin simulate a different role+module,
  // lets an observer open a module read-only,
  // or lets a dual-role supervisor switch between supervisor/executive in their module. Pass null to reset.
  const switchAs = useCallback((overrideRole, overrideModule) => {
    const isDualRoleSupervisor = session.realRole === 'supervisor' && session.hasExecutiveAccess;
    const isObserver = session.realRole === ROLE.OBSERVER;
    if (session.realRole !== 'business_admin' && !isObserver && !isDualRoleSupervisor) return;
    // An observer may only view as a supervisor or an executive. Anything else
    // is dropped rather than stored, so the panel can never persist an override
    // the backend will ignore — which would read as "in a module" here while
    // every request still arrived as a plain observer.
    if (isObserver && overrideRole && !OBSERVER_VIEW_ROLES.includes(overrideRole)) return;

    // Supervisors can only switch their role, not their module
    const nextModule = isDualRoleSupervisor ? session.module : overrideModule;
    const next = overrideRole ? { role: overrideRole, module: nextModule } : null;
    _setAdminOverride(next);
    if (next) activateOverride(next);
    else deactivateOverride();
  }, [session.realRole, session.hasExecutiveAccess, session.module]);

  // Track the override store rather than shadowing it. Workspace Access lives
  // in the portal trees, which write to the store directly — without this, its
  // Exit button stops the axios interceptor sending the override while this
  // provider keeps reporting the simulated role, module and read-only banner
  // until something forces a full remount.
  useEffect(() => subscribeOverride(_setAdminOverride), []);

  // Hand the axios write-guard the freshest role we have. It falls back to the
  // JWT, which is minted at sign-in and lives for 24h — so an observer promoted
  // mid-session would go on being refused client-side long after the backend
  // had started allowing its writes. Resets to undefined on sign-out, since
  // INITIAL_SESSION carries no realRole.
  useEffect(() => { setSessionRole(session.realRole); }, [session.realRole]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.dataset.theme = dark ? 'dark' : 'light';
    try { window.localStorage.setItem('zm:dark', dark ? '1' : '0'); } catch { /* storage disabled */ }
  }, [dark]);

  useEffect(() => {
    if (USE_MOCK || typeof window === 'undefined') return undefined;
    const onExpired = (event) => {
      setSessionExpired(event?.detail || { reason: 'expired' });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // In HTTP mode, hydrate session from /auth/whoami whenever a token appears
  // (sign-in or token refresh) and reset to defaults when it clears.
  useEffect(() => {
    if (USE_MOCK) return;
    let alive = true;
    const hydrate = async (token) => {
      if (!token) {
        if (alive) { setSession(INITIAL_SESSION); setAuthReady(true); }
        return;
      }
      try {
        const claims = await fetchMe(); // GET /auth/whoami
        if (!alive) return;
        setSession({
          ...INITIAL_SESSION,
          name:      claims.email ? claims.email.split('@')[0] : INITIAL_SESSION.name,
          email:     claims.email || INITIAL_SESSION.email,
          role:      claims.role || INITIAL_SESSION.role,
          realRole:  claims.real_role || claims.role || INITIAL_SESSION.role,
          hasExecutiveAccess: claims.has_executive_access || false,
          pendingExecutiveRequest: claims.has_pending_executive_request || false,
          tenantId:  claims.tenant_id || INITIAL_SESSION.tenantId,
          cityScope: claims.city || INITIAL_SESSION.cityScope,
          module:    claims.module || null,
          // JWT subject id — the DDR licensing tab compares this against the
          // site's legal delegate to decide whether the auto-inherited
          // licensing CTA is unlocked for this user.
          userId:    claims.sub || INITIAL_SESSION.userId || null,
        });
        setSessionExpired(null);
        hadLiveSessionRef.current = true;
      } catch (err) {
        if (isAuthRejection(err)) {
          if (!hadLiveSessionRef.current) {
            // First-load auth rejection: the token was dead on arrival, so the
            // user never had a live session this page-load. Drop it silently and
            // let the router fall through to /welcome or /login — popping a
            // blocking "session expired" modal over a public page is wrong,
            // there is no session to pause. (Restores pre-#173 #130 behavior for
            // the stale-token case.)
            console.warn('[session] /auth/whoami unauthorized on first load — clearing stale token', err);
            clearAuthToken();
          } else {
            // A session WAS live this page-load and just expired mid-use. Keep
            // the token + mounted route and surface the modal so in-progress
            // forms are preserved. (#130 / #173 intent)
            console.warn('[session] /auth/whoami unauthorized mid-session — preserving route', err);
            notifySessionExpired({ reason: 'whoami_unauthorized', error: err });
          }
        } else {
          // Transient (timeout / network / 5xx). Keep the token so the user
          // isn't logged out by a slow backend; a refresh re-hydrates. (#128)
          console.warn('[session] /auth/whoami failed transiently — keeping token', err);
        }
      } finally {
        // Session resolved (success or failure) — role is now authoritative,
        // so role-gated shell calls are safe to fire.
        if (alive) setAuthReady(true);
      }
    };
    hydrate(getAuthToken());
    return subscribeAuthToken(hydrate);
  }, []);

  const toggleDark = useCallback(() => setDark(d => !d), []);

  const signOut = useCallback(async () => {
    deactivateOverride();
    _setAdminOverride(null);
    try { await logoutApi(); } catch { /* best-effort */ }
    try { await supabaseSignOut(); } catch { /* best-effort */ }
    clearAuthToken();
    setSessionExpired(null);
    setSession(INITIAL_SESSION);
  }, []);

  // Same teardown as signOut, minus the network calls — the session is already
  // gone, this just clears the client. The override has to go for the same
  // reason it does there: it lives in sessionStorage and this provider does NOT
  // remount, so signing back in IN THIS TAB would otherwise arrive still
  // carrying it. For an observer that means `role` resolves to the simulated
  // supervisor and RequireAuth waves them into a module shell instead of
  // /observer — the read-only banner is the only thing left saying why nothing
  // works. (This is the logout fix from #472 finding 6; the expiry path is the
  // sibling it missed.)
  const signInAgain = useCallback(() => {
    deactivateOverride();
    _setAdminOverride(null);
    clearAuthToken();
    setSessionExpired(null);
    setSession(INITIAL_SESSION);
  }, []);

  // Derive permissions from role using the RBAC engine.
  const permissions = useMemo(() => {
    const canonicalRole =
      role === 'exec' ? ROLE.EXECUTIVE :
      role === 'supervisor' ? ROLE.SUPERVISOR : role;
    return Object.entries(PERMISSIONS)
      .filter(([, roles]) => roles.includes(canonicalRole))
      .map(([action]) => action);
  }, [role]);

  // user object — preserves the exact { name, email, city, tenantId } shape
  // that existing components destructure from useSession().user
  const user = useMemo(() => ({
    id: session.userId || session.id || null,
    userId: session.userId || session.id || null,
    name: session.name,
    email: session.email,
    city: session.cityScope || 'Mumbai',
    tenantId: session.tenantId,
  }), [session]);

  const canFn = useCallback((action) => can(role, action), [role]);

  const value = useMemo(() => ({
    user,
    role,
    // The DB role, un-rewritable by an override. This used to read
    // `session.role`, which is the OVERRIDDEN role (whoami echoes back whatever
    // X-Override-Role asked for) — so `realRole` reported the simulation, the
    // one thing it exists to see past. No caller depended on the old value.
    realRole: session.realRole,
    isBusinessAdmin,
    isObserver,
    // isReadOnly: this session may not write anything, anywhere. Kept separate
    // from `role` on purpose — `role` decides which SHAPE a page renders in
    // (an observer views a module as its supervisor), and this decides whether
    // that page offers to change anything.
    isReadOnly: isObserver,
    effectiveModule,
    adminOverride,
    switchAs,
    setRole: USE_MOCK ? setRole : undefined,
    session,
    authReady,
    cityScope: session.cityScope || user.city,
    permissions,
    dark,
    toggleDark,
    can: canFn,
    isMockMode: USE_MOCK,
    signOut,
    sessionExpired,
  }), [user, role, isBusinessAdmin, isObserver, effectiveModule, adminOverride, switchAs, setRole, session, authReady, permissions, dark, toggleDark, canFn, signOut, sessionExpired]);

  return (
    <SessionContext.Provider value={value}>
      {children}
      <SessionExpiredModal sessionExpired={sessionExpired} onSignInAgain={signInAgain} />
    </SessionContext.Provider>
  );
}

// Routes where the workspace session-expired modal must NEVER appear: the
// public marketing landing, the branded login, and the two admin portals
// (which authenticate with their own X-Platform-Admin-Key, not the workspace
// JWT). A dead/expired token on these routes should route to sign-in, not block
// the page with "session paused". Exported for tests.
const PUBLIC_SESSION_ROUTE_PREFIXES = ['/welcome', '/login', '/admin', '/business-admin'];

export function isPublicSessionRoute(pathname) {
  const path = pathname || '/';
  return PUBLIC_SESSION_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + '/'),
  );
}

// Rendered as a child of the provider so it can read the current route via
// useLocation WITHOUT re-rendering every context consumer on navigation. The
// modal only shows for a genuine in-app session expiry — never in mock mode and
// never on a public/unauthenticated route. (Fixes the #173 route-blind modal.)
function SessionExpiredModal({ sessionExpired, onSignInAgain }) {
  const { pathname } = useLocation();
  if (!sessionExpired || USE_MOCK || isPublicSessionRoute(pathname)) return null;
  const inactivity = sessionExpired.reason === 'inactivity';
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(7, 12, 10, 0.45)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          borderRadius: 18,
          border: '1px solid rgba(24, 84, 75, 0.22)',
          background: 'var(--zm-surface)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
          padding: 24,
          color: 'var(--zm-fg)',
        }}
      >
        <p style={{ margin: '0 0 8px', color: 'var(--zm-accent)', fontSize: 12, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          {inactivity ? 'Signed out' : 'Session paused'}
        </p>
        <h2 id="session-expired-title" style={{ margin: 0, fontSize: 28, lineHeight: 1.05 }}>
          Sign in again to continue
        </h2>
        <p style={{ margin: '14px 0 22px', color: 'var(--zm-fg-3)', lineHeight: 1.45 }}>
          {inactivity
            ? 'You were signed out after 8 hours of inactivity. This page is still open so your in-progress form stays visible.'
            : 'Your workspace session expired. This page is still open so your in-progress form stays visible.'}
        </p>
        <button
          type="button"
          onClick={onSignInAgain}
          style={{
            width: '100%',
            minHeight: 48,
            border: 0,
            borderRadius: 14,
            background: 'var(--zm-accent)',
            color: '#fff',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          Go to sign in
        </button>
      </div>
    </div>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
