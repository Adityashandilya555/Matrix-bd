import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ROUTES } from './routes.js';
import { RequireRole } from './guards.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { useAuthToken } from '../state/useAuthToken.js';

import App from '../App.jsx';
import LandingPage          from '../modules/landing/LandingPage.jsx';
import OverviewPage          from '../modules/bd/overview/OverviewPage.jsx';
import DraftsPage            from '../modules/bd/drafts/DraftsPage.jsx';
import ShortlistPage         from '../modules/bd/shortlist/ShortlistPage.jsx';
import ExecStagingPage       from '../modules/staging/exec/ExecStagingPage.jsx';
import SupervisorStagingPage from '../modules/staging/supervisor/SupervisorStagingPage.jsx';
import ArchivePage           from '../modules/archive/ArchivePage.jsx';
import AddDetailsPage        from '../modules/loi/details/AddDetailsPage.jsx';
import TeamPage              from '../modules/team/TeamPage.jsx';
import AdminPortalPage       from '../modules/admin/AdminPortalPage.jsx';
import BusinessAdminPortalPage from '../modules/business-admin/BusinessAdminPortalPage.jsx';

// In HTTP (non-mock) mode the landing page is the unauthenticated entry. The
// existing app chrome only renders after a Supabase session is established.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;
const LANDING_PATH = '/welcome';

function RequireAuth({ children }) {
  const token = useAuthToken();
  if (USE_MOCK) return children; // mock mode is always "signed in"
  if (!token)   return <Navigate to={LANDING_PATH} replace/>;
  return children;
}

function LandingRedirectIfAuthed() {
  // Send signed-in users away from the marketing page back to the dashboard.
  const token = useAuthToken();
  if (!USE_MOCK && token) return <Navigate to={ROUTES.OVERVIEW} replace/>;
  return <LandingPage/>;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path={LANDING_PATH} element={<LandingRedirectIfAuthed/>}/>

      {/* Platform admin portal lives OUTSIDE the workspace auth tree — its
          users are platform operators, not tenant members. The page itself
          gates access via X-Platform-Admin-Key. */}
      <Route path="/admin" element={<AdminPortalPage/>}/>
      <Route path="/business-admin" element={<BusinessAdminPortalPage/>}/>

      <Route element={<RequireAuth><App/></RequireAuth>}>
        <Route index                  element={<OverviewPage/>}/>
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
          <RequireRole roles={['supervisor']}>
            <TeamPage/>
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
