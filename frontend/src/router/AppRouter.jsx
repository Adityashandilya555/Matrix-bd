import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ROUTES } from './routes.js';
import { RequireModule, RequireRole } from './guards.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { useAuthToken } from '../state/useAuthToken.js';

import App from '../App.jsx';
// Lazy-load the landing — Three.js is ~600KB minified. Authenticated users
// redirect away before the chunk loads; unauthenticated visitors see the
// fallback for the few hundred ms it takes to fetch on first paint.
const ScaleLandingPage = lazy(() => import('../modules/landing/ScaleLandingPage.jsx'));
import OverviewPage          from '../modules/bd/overview/OverviewPage.jsx';
import DraftsPage            from '../modules/bd/drafts/DraftsPage.jsx';
import ShortlistPage         from '../modules/bd/shortlist/ShortlistPage.jsx';
import ExecStagingPage       from '../modules/staging/exec/ExecStagingPage.jsx';
import SupervisorStagingPage from '../modules/staging/supervisor/SupervisorStagingPage.jsx';
import ArchivePage           from '../modules/archive/ArchivePage.jsx';
import AddDetailsPage        from '../modules/loi/details/AddDetailsPage.jsx';
import TeamPage              from '../modules/team/TeamPage.jsx';
import LegalQueuePage       from '../modules/legal/LegalQueuePage.jsx';
import ChangeRequestsPage    from '../modules/legal/ChangeRequestsPage.jsx';
import RejectedSitesPage     from '../modules/legal/RejectedSitesPage.jsx';
import DdrPage               from '../modules/legal/ddr/DdrPage.jsx';
import AgreementPage         from '../modules/legal/agreement/AgreementPage.jsx';
import DesignQueuePage       from '../modules/design/DesignQueuePage.jsx';
import DesignReviewPage      from '../modules/design/DesignReviewPage.jsx';
import SiteStatusPage        from '../modules/bd/site-status/SiteStatusPage.jsx';
import DdFailedPage          from '../modules/bd/dd-failed/DdFailedPage.jsx';
import SiteTrackerListPage   from '../modules/bd/site-tracker/SiteTrackerListPage.jsx';
import SiteTrackerDetailPage from '../modules/bd/site-tracker/SiteTrackerDetailPage.jsx';
import DashboardMinimalPreview from '../modules/bd/dashboard-preview/DashboardMinimalPreview.jsx';
import LicensingPage         from '../modules/payment/licensing/LicensingPage.jsx';
import PaymentStubPage       from '../modules/payment/PaymentStubPage.jsx';
import AdminPortalPage          from '../modules/admin/AdminPortalPage.jsx';
import BusinessAdminPortalPage  from '../modules/business-admin/BusinessAdminPortalPage.jsx';
import RecceStubPage            from '../modules/recce/RecceStubPage.jsx';
import ProjectStubPage          from '../modules/project/ProjectStubPage.jsx';

// In HTTP (non-mock) mode the landing page is the unauthenticated entry. The
// existing app chrome only renders after a Supabase session is established.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;
const LANDING_PATH = '/welcome';

function homeForRoleModule(role, module) {
  if (role === 'business_admin') return '/business-admin';
  if (module === 'legal')        return ROUTES.LEGAL;
  if (module === 'payment')      return ROUTES.PAYMENT;
  if (module === 'design')       return ROUTES.DESIGN;
  if (module === 'recce')        return ROUTES.RECCE;
  if (module === 'project')      return ROUTES.PROJECT;
  return ROUTES.OVERVIEW; // BD / unknown → default to BD overview
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

function LandingFallback() {
  // Matches the landing's dark background so the swap is invisible.
  return <div style={{ minHeight: '100vh', background: '#090A07' }} aria-hidden="true" />;
}

function LandingRedirectIfAuthed() {
  // Send signed-in users away from the marketing page back to their module home.
  const token = useAuthToken();
  const { role, session } = useSession();
  if (!USE_MOCK && token) {
    return <Navigate to={homeForRoleModule(role, session?.module)} replace/>;
  }
  return <ScaleLandingPage/>;
}

function IndexRedirect() {
  // The root `/` defaults to the BD overview. Non-BD module members bounce
  // to their own module home on first load.
  const { role, session } = useSession();
  const module = session?.module;
  if (USE_MOCK) return <OverviewPage/>; // mock mode stays on BD
  if (module === 'legal')   return <Navigate to={ROUTES.LEGAL}   replace/>;
  if (module === 'payment') return <Navigate to={ROUTES.PAYMENT} replace/>;
  if (module === 'design')  return <Navigate to={ROUTES.DESIGN}  replace/>;
  if (module === 'recce')   return <Navigate to={ROUTES.RECCE}   replace/>;
  if (module === 'project') return <Navigate to={ROUTES.PROJECT} replace/>;
  return <OverviewPage/>;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path={LANDING_PATH} element={
        <Suspense fallback={<LandingFallback/>}>
          <LandingRedirectIfAuthed/>
        </Suspense>
      }/>

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

        <Route path={ROUTES.LEGAL} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <LegalQueuePage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_CHANGE_REQUESTS} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <ChangeRequestsPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_REJECTED} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <RejectedSitesPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_SITE_DDR} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <DdrPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_SITE_AGREEMENT} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <AgreementPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_SITE_LICENSING} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <LicensingPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path="/legal/*" element={<Navigate to={ROUTES.LEGAL} replace/>}/>

        <Route path={ROUTES.PAYMENT} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['payment']}>
              <PaymentStubPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PAYMENT_SITE_LICENSING} element={
          <PaymentLicensingRedirect/>
        }/>
        <Route path="/payment/*" element={<Navigate to={ROUTES.PAYMENT} replace/>}/>

        <Route path={ROUTES.DESIGN} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <DesignQueuePage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.DESIGN_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <DesignReviewPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path="/design/*" element={<Navigate to={ROUTES.DESIGN} replace/>}/>

        <Route path={ROUTES.RECCE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['recce']}>
              <RecceStubPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path="/recce/*" element={<Navigate to={ROUTES.RECCE} replace/>}/>

        <Route path={ROUTES.PROJECT} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ProjectStubPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path="/project/*" element={<Navigate to={ROUTES.PROJECT} replace/>}/>

        <Route path={ROUTES.DD_FAILED} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <DdFailedPage/>
          </RequireRole>
        }/>
        <Route path={ROUTES.BD_SITE_STATUS} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <SiteStatusPage/>
          </RequireRole>
        }/>

        <Route path="/site-tracker" element={<Navigate to={ROUTES.SITE_TRACKER} replace/>}/>
        <Route path="/site-tracker/:siteId" element={<LegacySiteFlowRedirect/>}/>

        <Route path={ROUTES.SITE_TRACKER} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['bd']}>
              <SiteTrackerListPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.SITE_TRACKER_DETAIL} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['bd', 'payment']}>
              <SiteTrackerDetailPage/>
            </RequireModule>
          </RequireRole>
        }/>

        <Route path={ROUTES.DASHBOARD_MINIMAL_PREVIEW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['bd']}>
              <DashboardMinimalPreview/>
            </RequireModule>
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

function PaymentLicensingRedirect() {
  const { siteId } = useParams();
  return <Navigate to={ROUTES.LEGAL_SITE_LICENSING.replace(':siteId', siteId)} replace/>;
}

function LegacySiteFlowRedirect() {
  const { siteId } = useParams();
  return <Navigate to={ROUTES.SITE_TRACKER_DETAIL.replace(':siteId', siteId)} replace/>;
}
