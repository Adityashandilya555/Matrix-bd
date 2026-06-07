import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { DEFAULT_SESSION, me as fetchMe, logout as logoutApi } from '../services/api/authService.js';
import { can, PERMISSIONS } from '../rbac/permissions.js';
import { ROLE } from '../rbac/roles.js';
import { subscribeAuthToken, getAuthToken, clearAuthToken } from '../services/api/authToken.js';
import { signOut as supabaseSignOut } from '../services/api/supabaseAuth.js';

// SessionContext — holds the current user session and role.
// In MOCK mode the session comes from DEFAULT_SESSION (legacy: Riya Sharma as supervisor).
// In HTTP mode the session is populated from /users/me after login.
// Role switcher only works in mock mode; in HTTP mode role comes from the JWT.

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;

// Build initial session from DEFAULT_SESSION to preserve legacy behavior.
// Legacy default was 'supervisor' for the role switcher.
const INITIAL_SESSION = {
  ...DEFAULT_SESSION,
  role: 'supervisor',
};

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(INITIAL_SESSION);
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

  // role is the display/canonical string used by existing components:
  // 'business_admin' | 'supervisor' | 'executive' | 'exec'
  const role = session.role;

  // setRole: allows role switcher to change role locally in mock mode.
  const setRole = (newRole) => {
    setSession(prev => ({ ...prev, role: newRole }));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.dataset.theme = dark ? 'dark' : 'light';
    try { window.localStorage.setItem('zm:dark', dark ? '1' : '0'); } catch { /* storage disabled */ }
  }, [dark]);

  // In HTTP mode, hydrate session from /auth/whoami whenever a token appears
  // (sign-in or token refresh) and reset to defaults when it clears.
  useEffect(() => {
    if (USE_MOCK) return;
    let alive = true;
    const hydrate = async (token) => {
      if (!token) {
        if (alive) setSession(INITIAL_SESSION);
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
          tenantId:  claims.tenant_id || INITIAL_SESSION.tenantId,
          cityScope: claims.city || INITIAL_SESSION.cityScope,
          module:    claims.module || null,
          // JWT subject id — the DDR licensing tab compares this against the
          // site's legal delegate to decide whether the auto-inherited
          // licensing CTA is unlocked for this user.
          userId:    claims.sub || INITIAL_SESSION.userId || null,
        });
      } catch (err) {
        // 401/403 → token is stale or app_metadata missing. Clear so the UI
        // bounces back to the landing page.
        // eslint-disable-next-line no-console
        console.warn('[session] /auth/whoami failed — clearing token', err);
        clearAuthToken();
      }
    };
    hydrate(getAuthToken());
    return subscribeAuthToken(hydrate);
  }, []);

  const toggleDark = () => setDark(d => !d);

  const signOut = async () => {
    try { await logoutApi(); } catch { /* best-effort */ }
    try { await supabaseSignOut(); } catch { /* best-effort */ }
    clearAuthToken();
    setSession(INITIAL_SESSION);
  };

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
  const user = {
    id: session.userId || session.id || null,
    userId: session.userId || session.id || null,
    name: session.name,
    email: session.email,
    city: session.cityScope || 'Mumbai',
    tenantId: session.tenantId,
  };

  const value = {
    user,
    role,
    setRole: USE_MOCK ? setRole : undefined, // hide switcher in HTTP mode
    session,
    cityScope: session.cityScope || user.city,
    permissions,
    dark,
    toggleDark,
    can: (action) => can(role, action),
    isMockMode: USE_MOCK,
    signOut,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
