import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ROUTES } from './routes.js';
import { RequireRole } from './guards.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { useAuthToken } from '../state/useAuthToken.js';

import App from '../App.jsx';
import LandingPage          from '../modules/landing/LandingPage.jsx';
import ScaleLandingPage     from '../modules/landing/ScaleLandingPage.jsx';
import OverviewPage          from '../modules/bd/overview/OverviewPage.jsx';
import DraftsPage            from '../modules/bd/drafts/DraftsPage.jsx';
import ShortlistPage         from '../modules/bd/shortlist/ShortlistPage.jsx';
import ExecStagingPage       from '../modules/staging/exec/ExecStagingPage.jsx';
import SupervisorStagingPage from '../modules/staging/supervisor/SupervisorStagingPage.jsx';
import ArchivePage           from '../modules/archive/ArchivePage.jsx';
import AddDetailsPage        from '../modules/loi/details/AddDetailsPage.jsx';
import TeamPage              from '../modules/team/TeamPage.jsx';
import LegalStubPage         from '../modules/legal/LegalStubPage.jsx';
import PaymentStubPage       from '../modules/payment/PaymentStubPage.jsx';
import AdminPortalPage       from '../modules/admin/AdminPortalPage.jsx';
import BusinessAdminPortalPage from '../modules/business-admin/BusinessAdminPortalPage.jsx';

// In HTTP (non-mock) mode the landing page is the unauthenticated entry. The
// existing app chrome only renders after a Supabase session is established.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;
const LANDING_PATH = '/welcome';

function homeForRoleModule(role, module) {
  if (role === 'business_admin') return '/business-admin';
  if (module === 'legal')        return '/legal';
  if (module === 'payment')      return '/payment';
  return ROUTES.OVERVIEW; // BD (or unknown → default to BD)
}

function RequireAuth({ children }) {
  const token = useAuthToken();
  const { role } = useSession();
  if (USE_MOCK) return children; // mock mode is always "signed in"
  if (!token)   return <Navigate to={LANDING_PATH} replace/>;
  // Business admins have no presence in the tenant app shell — their entire
  // surface lives at /business-admin. Forward them out of any BD/legal/payment
  // route so they cannot land on a chrome that isn't meant for them.
  if (role === 'business_admin') return <Navigate to="/business-admin" replace/>;
  return children;
}

function LandingRedirectIfAuthed() {
  // Send signed-in users away from the marketing page back to their module home.
  const token = useAuthToken();
  const { role, session } = useSession();
  if (!USE_MOCK && token) {
    return <Navigate to={homeForRoleModule(role, session?.module)} replace/>;
  }
  return <LandingPage/>;
}

function IndexRedirect() {
  // The root `/` defaults to the BD overview. For legal/payment supervisors
  // that's the wrong chrome — bounce them to their module stub.
  const { role, session } = useSession();
  const module = session?.module;
  if (USE_MOCK) return <OverviewPage/>; // mock mode stays on BD
  if (module === 'legal')   return <Navigate to="/legal" replace/>;
  if (module === 'payment') return <Navigate to="/payment" replace/>;
  return <OverviewPage/>;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path={LANDING_PATH} element={<LandingRedirectIfAuthed/>}/>
      <Route path="/scale" element={<ScaleLandingPage/>}/>

      {/* Platform admin portal lives OUTSIDE the workspace auth tree — its
          users are platform operators, not tenant members. The page itself
          gates access via X-Platform-Admin-Key. */}
      <Route path="/admin" element={<AdminPortalPage/>}/>
      <Route path="/business-admin" element={<BusinessAdminPortalPage/>}/>

      <Route element={<RequireAuth><App/></RequireAuth>}>
        <Route index                  element={<IndexRedirect/>}/>
        <Route path={ROUTES.PIPELINE}  element={<DraftsPage/>}/>
        <Route path={ROUTES.SHORTLIST} element={<ShortlistPage/>}/>

        <Route path={ROUTES.STAGING_EXEC} element={
          <RequireRole roles={['exec']}>
            <ExecStagingPage/>
          </RequireRole>
        }/>
        <Route path={ROUTES.STAGING_SUPERVISOR} element={
          <RequireRole roles={['supervisor']}>
            <SupervisorStagingPage/>
          </RequireRole>
        }/>
        {/* Generic /staging redirects based on role */}
        <Route path={ROUTES.STAGING} element={<StagingRedirect/>}/>

        <Route path={ROUTES.ARCHIVE} element={
          <RequireRole roles={['supervisor']}>
            <ArchivePage/>
          </RequireRole>
        }/>

        <Route path={ROUTES.TEAM} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <TeamPage/>
          </RequireRole>
        }/>

        <Route path="/legal/*" element={
          <RequireRole roles={['supervisor', 'executive']}>
            <LegalStubPage/>
          </RequireRole>
        }/>
        <Route path="/payment/*" element={
          <RequireRole roles={['supervisor', 'executive']}>
            <PaymentStubPage/>
          </RequireRole>
        }/>

        {/* Sub-path routes for shortlist details / timeline — rendered as full pages */}
        <Route path={ROUTES.ADD_DETAILS}   element={<ShortlistPage/>}/>
        <Route path={ROUTES.LOI_TIMELINE}  element={<ShortlistPage/>}/>

        <Route path="*" element={<Navigate to={ROUTES.OVERVIEW} replace/>}/>
      </Route>
    </Routes>
  );
}

function StagingRedirect() {
  const { role } = useSession();
  // Backend ships role='executive'; mock-mode role switcher still uses 'exec'.
  const isExec = role === 'exec' || role === 'executive';
  return <Navigate to={isExec ? ROUTES.STAGING_EXEC : ROUTES.STAGING_SUPERVISOR} replace/>;
}
