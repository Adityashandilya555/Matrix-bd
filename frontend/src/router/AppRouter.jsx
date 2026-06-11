import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { ROUTES } from './routes.js';
import { RequireModule, RequireRole } from './guards.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { useAuthToken } from '../state/useAuthToken.js';

import App from '../App.jsx';
// Lazy-load the landing — Three.js is ~600KB minified. Authenticated users
// redirect away before the chunk loads; unauthenticated visitors see the
// fallback for the few hundred ms it takes to fetch on first paint.
const ScaleLandingPage = lazy(() => import('../modules/landing/ScaleLandingPage.jsx'));
// Per-company customized login page reached via the workspace-code dialog.
const BrandedLoginPage = lazy(() => import('../modules/landing/BrandedLoginPage.jsx'));
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
import DdrPage               from '../modules/legal/ddr/DdrPage.jsx';
import AgreementPage         from '../modules/legal/agreement/AgreementPage.jsx';
import DesignQueuePage       from '../modules/design/DesignQueuePage.jsx';
import DesignReviewPage      from '../modules/design/DesignReviewPage.jsx';
import ModuleHistoryPage     from '../modules/module-history/ModuleHistoryPage.jsx';
import ModuleProcessFlowPage from '../modules/module-process-flow/ModuleProcessFlowPage.jsx';
import SiteStatusPage        from '../modules/bd/site-status/SiteStatusPage.jsx';
import DdFailedPage          from '../modules/bd/dd-failed/DdFailedPage.jsx';
import SiteTrackerListPage   from '../modules/bd/site-tracker/SiteTrackerListPage.jsx';
import SiteTrackerDetailPage from '../modules/bd/site-tracker/SiteTrackerDetailPage.jsx';
import DashboardMinimalPreview from '../modules/bd/dashboard-preview/DashboardMinimalPreview.jsx';
import LicensingPage         from '../modules/payment/licensing/LicensingPage.jsx';
import PaymentStubPage       from '../modules/payment/PaymentStubPage.jsx';
import LaunchPage            from '../modules/launch/LaunchPage.jsx';
import LegalOverviewPage     from '../modules/legal/LegalOverviewPage.jsx';
import DesignOverviewPage    from '../modules/design/DesignOverviewPage.jsx';
import ProjectOverviewPage   from '../modules/project/ProjectOverviewPage.jsx';
import NsoOverviewPage       from '../modules/nso/NsoOverviewPage.jsx';
import AdminPortalPage          from '../modules/admin/AdminPortalPage.jsx';
import BusinessAdminPortalPage  from '../modules/business-admin/BusinessAdminPortalPage.jsx';
import ProjectQueuePage         from '../modules/project/ProjectQueuePage.jsx';

// Dev-only: Approval Center UI preview with mock data (no backend / no login).
// DEV gate makes the dynamic import dead code in production (tree-shaken out).
const ApprovalCenterPreview = import.meta.env.DEV
  ? lazy(() => import('../modules/business-admin/_preview/ApprovalCenterPreview.jsx'))
  : null;
import ProjectReviewPage        from '../modules/project/ProjectReviewPage.jsx';
import NsoQueuePage             from '../modules/nso/NsoQueuePage.jsx';
import NsoReviewPage            from '../modules/nso/NsoReviewPage.jsx';

// In HTTP (non-mock) mode the landing page is the unauthenticated entry. The
// existing app chrome only renders after a Supabase session is established.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true;
const LANDING_PATH = '/welcome';

function homeForRoleModule(role, module) {
  if (role === 'business_admin') return '/business-admin';
  if (module === 'legal')        return ROUTES.LEGAL;
  if (module === 'design')       return ROUTES.DESIGN;
  if (module === 'project')      return ROUTES.PROJECT;
  if (module === 'nso')          return ROUTES.NSO;
  return ROUTES.OVERVIEW; // BD / unknown → default to BD overview
}

function RequireAuth({ children }) {
  const token = useAuthToken();
  const { role, authReady } = useSession();
  if (USE_MOCK) return children; // mock mode is always "signed in"
  if (!token)   return <Navigate to={LANDING_PATH} replace/>;
  // Block the authed shell until /auth/whoami resolves. This single gate keeps
  // IndexRedirect and every nested module/role guard from evaluating the
  // pre-hydration default session ('supervisor', module=null) on refresh /
  // deep-link, which otherwise misroutes module users and strands execs. (#114)
  if (!authReady) return <HydratingFallback/>;
  // Business admins have no presence in the tenant app shell — their entire
  // surface lives at /business-admin. Forward them out of any BD/legal/payment
  // route so they cannot land on a chrome that isn't meant for them.
  if (role === 'business_admin') return <Navigate to="/business-admin" replace/>;
  return children;
}

function HydratingFallback() {
  // Neutral full-height placeholder while the session hydrates.
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', opacity: 0.6 }}>Loading…</div>;
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
  if (module === 'design')  return <Navigate to={ROUTES.DESIGN}  replace/>;
  if (module === 'project') return <Navigate to={ROUTES.PROJECT} replace/>;
  if (module === 'nso')     return <Navigate to={ROUTES.NSO}     replace/>;
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

      {/* Per-company customized login page (workspace-code dialog → here). */}
      <Route path="/login/:code" element={
        <Suspense fallback={<LandingFallback/>}>
          <BrandedLoginPage/>
        </Suspense>
      }/>

      {/* Platform admin portal lives OUTSIDE the workspace auth tree — its
          users are platform operators, not tenant members. The page itself
          gates access via X-Platform-Admin-Key. */}
      <Route path="/admin" element={<AdminPortalPage/>}/>
      <Route path="/business-admin" element={<BusinessAdminPortalPage/>}/>
      {import.meta.env.DEV && (
        <Route path="/business-admin-preview" element={
          <Suspense fallback={null}><ApprovalCenterPreview/></Suspense>
        }/>
      )}

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
        <Route path={ROUTES.LEGAL_OVERVIEW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <LegalOverviewPage/>
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
              <ModuleHistoryPage moduleKey="legal" defaultFilter="rejected"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_HISTORY} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <ModuleHistoryPage moduleKey="legal"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_HISTORY_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <ModuleHistoryPage moduleKey="legal"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_PROCESS_FLOW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <ModuleProcessFlowPage moduleKey="legal"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.LEGAL_PROCESS_FLOW_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['legal']}>
              <ModuleProcessFlowPage moduleKey="legal"/>
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
          <PaymentRoute/>
        }/>
        <Route path="/payment/*" element={<Navigate to={ROUTES.PAYMENT} replace/>}/>

        <Route path={ROUTES.LAUNCH} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <LaunchPage/>
          </RequireRole>
        }/>

        <Route path={ROUTES.DESIGN} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <DesignQueuePage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.DESIGN_OVERVIEW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <DesignOverviewPage/>
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
        <Route path={ROUTES.DESIGN_HISTORY} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <ModuleHistoryPage moduleKey="design"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.DESIGN_HISTORY_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <ModuleHistoryPage moduleKey="design"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.DESIGN_PROCESS_FLOW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <ModuleProcessFlowPage moduleKey="design"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.DESIGN_PROCESS_FLOW_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['design']}>
              <ModuleProcessFlowPage moduleKey="design"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path="/design/*" element={<Navigate to={ROUTES.DESIGN} replace/>}/>

        <Route path={ROUTES.PROJECT} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ProjectQueuePage mode="pipeline"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PROJECT_OVERVIEW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ProjectOverviewPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PROJECT_SITES} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ProjectQueuePage mode="sites"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PROJECT_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ProjectReviewPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PROJECT_HISTORY} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ModuleHistoryPage moduleKey="project"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PROJECT_HISTORY_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ModuleHistoryPage moduleKey="project"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PROJECT_PROCESS_FLOW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ModuleProcessFlowPage moduleKey="project"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.PROJECT_PROCESS_FLOW_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['project']}>
              <ModuleProcessFlowPage moduleKey="project"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path="/project/*" element={<Navigate to={ROUTES.PROJECT} replace/>}/>

        <Route path={ROUTES.NSO} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['nso']}>
              <NsoQueuePage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.NSO_OVERVIEW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['nso']}>
              <NsoOverviewPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.NSO_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['nso']}>
              <NsoReviewPage/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.NSO_HISTORY} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['nso']}>
              <ModuleHistoryPage moduleKey="nso"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.NSO_HISTORY_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['nso']}>
              <ModuleHistoryPage moduleKey="nso"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.NSO_PROCESS_FLOW} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['nso']}>
              <ModuleProcessFlowPage moduleKey="nso"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path={ROUTES.NSO_PROCESS_FLOW_SITE} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <RequireModule modules={['nso']}>
              <ModuleProcessFlowPage moduleKey="nso"/>
            </RequireModule>
          </RequireRole>
        }/>
        <Route path="/nso/*" element={<Navigate to={ROUTES.NSO} replace/>}/>

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
            <SiteTrackerListPage/>
          </RequireRole>
        }/>
        <Route path={ROUTES.SITE_TRACKER_DETAIL} element={
          <RequireRole roles={['supervisor', 'executive', 'exec']}>
            <SiteTrackerDetailPage/>
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
  const location = useLocation();
  // Backend ships role='executive'; mock-mode role switcher still uses 'exec'.
  const isExec = role === 'exec' || role === 'executive';
  // Preserve the query string so deep links like /staging?focus=<id> survive
  // the role-based redirect.
  return <Navigate to={{ pathname: isExec ? ROUTES.STAGING_EXEC : ROUTES.STAGING_SUPERVISOR, search: location.search }} replace/>;
}

function PaymentRoute() {
  // Payment is the BD finance / CA-readiness view — a BD surface, not its own
  // module. Gate it on role, not a module claim. Executives reach it from the
  // Overview "Payments" KPI, so they get the same (read-oriented) view.
  const { role } = useSession();
  if (role !== 'supervisor' && role !== 'executive' && role !== 'exec') {
    return <Navigate to={ROUTES.OVERVIEW} replace/>;
  }
  return <PaymentStubPage/>;
}

function LegacySiteFlowRedirect() {
  const { siteId } = useParams();
  return <Navigate to={ROUTES.SITE_TRACKER_DETAIL.replace(':siteId', siteId)} replace/>;
}
