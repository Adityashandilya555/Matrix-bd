// skipcq: JS-0833
// Route gate for /observer, mirroring BusinessAdminPortalPage.
//
// The observer needs its own route rather than a corner of the main app, because
// the shared shell would happily admit it: RequireAuth only special-cases
// business_admin, Sidebar derives its nav from the user's module rather than
// their role, and rbac/scope.js resolves anything that is not an executive to
// tenant scope. An observer dropped in there gets a near-complete BD supervisor
// sidebar over workspace-wide data.
import React from 'react';
import { Navigate } from 'react-router-dom';
import { clearAuthToken } from '../../services/api/authToken.js';
import { deactivateOverride } from '../../services/api/adminOverride.js';
import { useAuthToken } from '../../state/useAuthToken.js';
import { decodeJwtPayload } from './jwt.js';
import { ObserverDashboardWithContext } from './ObserverDashboard.jsx';

export default function ObserverPortalPage() {
  // Subscribe to the shared token store so a mid-session 401 (the axios
  // interceptor clears the token) redirects immediately, rather than leaving the
  // portal rendering against a dead token while every call 401s. (#129)
  const token = useAuthToken();
  const role = decodeJwtPayload(token).role;
  // Drop the module override too. It lives in sessionStorage, so without this
  // the next sign-in IN THIS TAB carries it — the observer would be dropped
  // straight back into a module instead of landing on the portal.
  const logout = React.useCallback(() => {
    deactivateOverride();
    clearAuthToken();
  }, []);

  if (!token || role !== 'observer') {
    // Same contract as /business-admin: no standalone login here. Deep-linking
    // without a session bounces to /welcome, whose LandingRedirectIfAuthed sends
    // an authenticated user to their own home.
    return <Navigate to="/welcome" replace/>;
  }
  return <ObserverDashboardWithContext onLogout={logout}/>;
}
