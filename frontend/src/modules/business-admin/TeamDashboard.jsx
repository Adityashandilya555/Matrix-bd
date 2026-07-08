import React from 'react';
import './approval-center.css';
import { GRID_LAYERS, GRID_ATTACH, stageVignette, canvasBase } from '../../lib/surfaces.js';
import { PRODUCT_NAME } from '../../router/routes.js';
import { getAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from './jwt.js';
import {
  getDesignAdminQueue, adminReviewDeliverable,
  getDesignGfcQueue, getDesignGfcReview, decideGfc,
} from '../../services/api/designApi.js';
import {
  getFinanceQueue, approveFinance, rejectFinance, getBudgetQueue, reviewBudget, fetchBudgetDetail,
  getQualityAuditQueue, confirmQualityAudit, getClosureAdminQueue, finalizeClosure,
  getOrg, getAllSites, getSiteHistory,
  getExecutiveRequests, approveExecutiveRequest, rejectExecutiveRequest,
} from '../../services/api/businessAdminApi.js';
import {
  rotateDeptCode, listPendingSupervisors, approveSupervisor, rejectSupervisor, removeOrgUser,
} from '../../services/api/adapters/httpAdapter.js';

import { T, Icon, IconButton, StatTile, TABULAR, getInitialTheme, persistTheme } from './ui/kit.jsx';
import Sidebar from './ui/Sidebar.jsx';
import ApprovalCenter from './approval/ApprovalCenter.jsx';
import DepartmentsTab from './departments/DepartmentsTab.jsx';
import SitesTab from './sites/SitesTab.jsx';
import LaunchApprovalTab from './launch/LaunchApprovalTab.jsx';
import WorkspaceSwitcherPanel from './WorkspaceSwitcherPanel.jsx';

// Real API wiring. Injectable so the dev preview (and tests) can drive the whole
// portal with mock data — see ./_preview/ApprovalCenterPreview.jsx.
export const REAL_FETCHERS = {
  listDeliverables:  getDesignAdminQueue,
  reviewDeliverable: adminReviewDeliverable,
  listGfc:           getDesignGfcQueue,
  reviewGfcPackage:  getDesignGfcReview,
  decideGfc,
  listFinance:       getFinanceQueue,
  approveFinance,
  rejectFinance,
  listBudget:        getBudgetQueue,
  reviewBudget,
  fetchBudgetDetail,
  listQualityAudit:  getQualityAuditQueue,
  confirmQualityAudit,
  listClosure:       getClosureAdminQueue,
  finalizeClosure,
  listSupervisors:   listPendingSupervisors,
  approveSupervisor,
  rejectSupervisor,
  listExecutiveReqs: getExecutiveRequests,
  approveExecutiveReq: approveExecutiveRequest,
  rejectExecutiveReq: rejectExecutiveRequest,
  removeOrgUser,
  rotateDeptCode,
  listOrg:           getOrg,
  listSites:         getAllSites,
  fetchSiteHistory:  getSiteHistory,
};

const errMsg = (e) => e?.detail || e?.message || 'Failed to load';

function useQueue(fetcher) {
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null, refreshing: false });
  const load = React.useCallback(async (silent = false) => {
    setState((s) => (silent ? { ...s, refreshing: true } : { status: 'loading', items: [], total: 0, error: null, refreshing: false }));
    try {
      const d = await fetcher();
      const items = Array.isArray(d) ? d : (d?.items || []);
      const total = typeof d?.total === 'number' ? d.total : items.length;
      setState({ status: 'ready', items, total, error: null, refreshing: false });
    } catch (e) {
      if (silent && e?.code === 'TIMEOUT') {
        setState((s) => ({ ...s, refreshing: false }));
        return;
      }
      setState((s) => (silent && s.items.length
        ? { ...s, error: errMsg(e), refreshing: false }
        : { status: 'error', items: [], total: 0, error: errMsg(e), refreshing: false }));
    }
  }, [fetcher]);
  React.useEffect(() => { load(false); }, [load]);
  return [state, load];
}

const TABS = [
  { key: 'approvals',   label: 'Approval Center',  icon: Icon.check },
  { key: 'launch',      label: 'Launch Approvals', icon: Icon.flag },
  { key: 'departments', label: 'Departments',       icon: Icon.key },
  { key: 'sites',       label: 'Sites',             icon: Icon.pin },
  { key: 'workspace',   label: 'Workspace Access',  icon: Icon.external },
];

export default function TeamDashboard({ onLogout, fetchers = REAL_FETCHERS, workspaceName }) {
  const company = workspaceName ?? (() => {
    const p = decodeJwtPayload(getAuthToken());
    return p.workspace_name || p.tenant_name || p.company || '';
  })();

  const [tab, setTab] = React.useState('approvals');
  const [refreshingAll, setRefreshingAll] = React.useState(false);
  const [theme, setTheme] = React.useState(getInitialTheme);
  const toggleTheme = () => setTheme((t) => { const next = t === 'dark' ? 'light' : 'dark'; persistTheme(next); return next; });
  const [navExpanded, setNavExpanded] = React.useState(() => {
    try { return window.localStorage.getItem('ac-nav') !== 'collapsed'; } catch { return true; }
  });
  const toggleNav = () => setNavExpanded((v) => {
    const next = !v;
    try { window.localStorage.setItem('ac-nav', next ? 'expanded' : 'collapsed'); } catch { /* ignore */ }
    return next;
  });

  // Approval queues (aggregated by site below)
  const [deliverables, loadDeliverables] = useQueue(fetchers.listDeliverables);
  const [gfc, loadGfc] = useQueue(fetchers.listGfc);
  const [finance, loadFinance] = useQueue(fetchers.listFinance);
  const [budget, loadBudget] = useQueue(fetchers.listBudget);
  const [qualityAudit, loadQualityAudit] = useQueue(fetchers.listQualityAudit);
  const [closure, loadClosure] = useQueue(fetchers.listClosure);
  // Departments
  const [supervisors, loadSupervisors] = useQueue(fetchers.listSupervisors);
  const [executiveRequests, loadExecutiveRequests] = useQueue(fetchers.listExecutiveReqs);
  const [org, loadOrg] = useQueue(fetchers.listOrg);
  // Sites
  const [sites, loadSites] = useQueue(fetchers.listSites);

  // ── aggregate the four approval queues into one site-centric list ──
  const approvalSites = React.useMemo(() => {
    const map = new Map();
    const ensure = (s) => {
      if (!map.has(s.siteId)) {
        map.set(s.siteId, {
          siteId: s.siteId, siteCode: s.siteCode, siteName: s.siteName, city: s.city,
          design: { deliverables: [], gfcPending: false, boqAmount: null },
          payment: null, project: null, qualityAudit: null, financialClosure: null,
        });
      }
      return map.get(s.siteId);
    };
    for (const s of deliverables.items || []) ensure(s).design.deliverables = s.deliverables || [];
    for (const s of gfc.items || []) { const e = ensure(s); e.design.gfcPending = true; e.design.boqAmount = s.boqEstimatedAmount ?? null; }
  for (const s of finance.items || []) ensure(s).payment = {
    caCode: s.caCode,
    kycVerified: s.kycVerified,
    financeAmount: s.financeAmount,
    submittedByName: s.submittedByName,
    legalDdStatus: s.legalDdStatus,
    agreementStatus: s.agreementStatus,
    licensingStatus: s.licensingStatus,
  };
  for (const s of budget.items || []) ensure(s).project = {
    budgetStatus: s.budgetStatus,
    budgetTotal: s.budgetTotal,
    totalIndoorAreaSqft: s.totalIndoorAreaSqft,
    totalAreaSqft: s.totalAreaSqft,
    covers: s.covers,
    submittedByName: s.submittedByName,
  };
  for (const s of qualityAudit.items || []) ensure(s).qualityAudit = {
    inspectionDate: s.inspectionDate,
    submittedByName: s.submittedByName,
  };
  for (const s of closure.items || []) ensure(s).financialClosure = {
    closureStatus: s.closureStatus,
    gfcBudgetTotal: s.gfcBudgetTotal,
    closureBudgetTotal: s.closureBudgetTotal,
    variationTotal: s.variationTotal,
    submittedByName: s.submittedByName,
  };
    return [...map.values()];
  }, [deliverables.items, gfc.items, finance.items, budget.items, qualityAudit.items, closure.items]);

  const aq = [deliverables, gfc, finance, budget, qualityAudit, closure];
  // Resilient: only block the whole center if EVERY queue failed. One queue
  // failing (e.g. project-budget routes not deployed yet) still shows the rest.
  const approvalStatus = aq.some((q) => q.status === 'loading') ? 'loading'
    : aq.every((q) => q.status === 'error') ? 'error' : 'ready';
  const approvalError = aq.find((q) => q.status === 'error')?.error;
  const approvalData = { status: approvalStatus, sites: approvalSites, error: approvalError };

  const reloadApprovals = (silent) => Promise.all([loadDeliverables(silent), loadGfc(silent), loadFinance(silent), loadBudget(silent), loadQualityAudit(silent), loadClosure(silent)]);

  // ── derived counts ──
  const designSites = approvalSites.filter((s) => (s.design.deliverables.length + (s.design.gfcPending ? 1 : 0)) > 0).length;
  const paymentSites = approvalSites.filter((s) => s.payment).length;
  const supCount = supervisors.items.length;
  const sitesCount = sites.items.length;
  const completedSites = (sites.items || []).filter((s) => s.projectStatus === 'done' || s.projectStatus === 'completed').length;

  // ── handlers ──
  const handlers = {
    // approvals
    onDeliverableDecide: async (siteId, kind, payload) => { await fetchers.reviewDeliverable(siteId, kind, payload); await loadDeliverables(true); },
    fetchGfcReview: fetchers.reviewGfcPackage,
    onGfcDecide: async (siteId, payload) => { await fetchers.decideGfc(siteId, payload); await loadGfc(true); },
    onApproveFinance: async (siteId) => { await fetchers.approveFinance(siteId); await loadFinance(true); },
    onRejectFinance: async (siteId, reason) => { await fetchers.rejectFinance(siteId, reason); await loadFinance(true); },
    fetchBudgetDetail: fetchers.fetchBudgetDetail,
    onBudgetDecide: async (siteId, payload) => { await fetchers.reviewBudget(siteId, payload); await loadBudget(true); },
    onQualityConfirm: async (siteId, payload) => { await fetchers.confirmQualityAudit(siteId, payload); await loadQualityAudit(true); },
    onClosureFinalize: async (siteId, payload) => { await fetchers.finalizeClosure(siteId, payload); await loadClosure(true); },
    // departments
    onApproveSupervisor: async (u) => { await fetchers.approveSupervisor(u.id, u.module); await loadSupervisors(true); await loadOrg(true); },
    onRejectSupervisor: async (u) => { await fetchers.rejectSupervisor(u.id); await loadSupervisors(true); },
    onApproveExecutiveReq: async (reqId) => { await fetchers.approveExecutiveReq(reqId); await loadExecutiveRequests(true); await loadOrg(true); },
    onRejectExecutiveReq: async (reqId) => { await fetchers.rejectExecutiveReq(reqId); await loadExecutiveRequests(true); },
    onRotate: async (moduleKey) => { await fetchers.rotateDeptCode(moduleKey); await loadOrg(true); },
    onRemoveUser: async (u) => { if (!fetchers.removeOrgUser) return; await fetchers.removeOrgUser(u.id); await loadOrg(true); },
    reloadPendingSupervisors: loadSupervisors,
    reloadExecutiveRequests: loadExecutiveRequests,
    reloadOrg: loadOrg,
  };

  const refreshAll = async (silent = false) => {
    if (!silent) setRefreshingAll(true);
    try { await Promise.all([reloadApprovals(true), loadSupervisors(true), loadExecutiveRequests(true), loadOrg(true), loadSites(true)]); }
    finally { if (!silent) setRefreshingAll(false); }
  };

  React.useEffect(() => {
    const pollId = window.setInterval(() => refreshAll(true), 30000);
    return () => window.clearInterval(pollId);
  }, [reloadApprovals, loadSupervisors, loadExecutiveRequests, loadOrg, loadSites]);

  const navItems = [
    { ...TABS[0], count: approvalSites.length },
    { ...TABS[1] }, // Launch Approvals — count fetched inside the tab
    { ...TABS[2], count: supCount + executiveRequests.items.length },
    { ...TABS[3] },
    { ...TABS[4] }, // Workspace Access tab
  ];

  return (
    <div className="ac-root" data-theme={theme}
      style={{ height: '100vh', background: 'var(--zm-bg)', color: 'var(--zm-fg)', display: 'flex', boxSizing: 'border-box' }}>
      <Sidebar items={navItems} active={tab} onChange={setTab}
        expanded={navExpanded} onToggleExpanded={toggleNav}
        theme={theme} onToggleTheme={toggleTheme} onLogout={onLogout} />

      <main className="zm-app-main" style={{ flex: 1, minWidth: 0, height: '100%', overflowY: 'auto',
          backgroundColor: canvasBase(theme === 'dark'),
          backgroundImage: stageVignette(theme === 'dark') + ', ' + GRID_LAYERS,
          backgroundAttachment: 'fixed, fixed, ' + GRID_ATTACH,
      }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 34px 60px' }}>

          {/* ── Header ── */}
          <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.textMuted }}>{PRODUCT_NAME} · Business admin</div>
              <h1 style={{ margin: '5px 0 0', fontSize: 27, fontWeight: 730, letterSpacing: '-0.025em', color: T.text }}>{company || 'Workspace'}</h1>
              <div style={{ marginTop: 3, fontSize: 13, color: T.textMuted }}>Approval center</div>
            </div>
            <span style={{ flex: 1 }} />
            <IconButton label="Refresh all" loading={refreshingAll} onClick={refreshAll}><Icon.refresh size={16} /></IconButton>
          </header>

        {/* ── Attention summary ── */}
        <div style={{ marginBottom: 16, fontSize: 14, color: T.textMuted }}>
          {approvalStatus === 'loading' ? <span>Loading your approval queues…</span>
            : approvalSites.length > 0 ? (
              <span><strong style={{ color: T.warnText, ...TABULAR }}>{approvalSites.length}</strong>{' '}
                {approvalSites.length === 1 ? 'site is' : 'sites are'} awaiting your approval.</span>)
            : approvalStatus === 'error' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: T.dangerText }}>
                <Icon.alert size={15} /> Some queues couldn’t load — use Retry below.</span>)
            : (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: T.successText }}>
                <Icon.check size={16} /> You’re all caught up — nothing awaiting approval.</span>)}

          {supCount > 0 && (
            <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              · <Icon.users size={14} style={{ color: T.warnText }} /> <span style={{ color: T.warnText }}>{supCount} pending {supCount === 1 ? 'supervisor' : 'supervisors'}</span>
            </span>
          )}
          {executiveRequests.items.length > 0 && (
            <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              · <Icon.doc size={14} style={{ color: T.warnText }} /> <span style={{ color: T.warnText }}>{executiveRequests.items.length} executive {executiveRequests.items.length === 1 ? 'request' : 'requests'}</span>
            </span>
          )}
        </div>

        {/* ── Overview tiles ── */}
        <div className="ac-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(212px, 1fr))', gap: 14, marginBottom: 24 }}>
          <StatTile icon={Icon.pin} label="Total sites" count={sitesCount} tone="peach"
            loading={sites.status === 'loading'} caption="in the system" onClick={() => setTab('sites')} />
          <StatTile icon={Icon.check} label="Awaiting approval" count={approvalSites.length} tone="slate"
            loading={approvalStatus === 'loading'} caption={approvalSites.length ? `${designSites} design · ${paymentSites} payment` : 'all clear'}
            onClick={() => setTab('approvals')} />
          <StatTile icon={Icon.flag} label="Completed sites" count={completedSites} tone="mint"
            loading={sites.status === 'loading'} caption={completedSites ? 'project done' : 'none yet'} onClick={() => setTab('sites')} />
          <StatTile icon={Icon.users} label="Pending requests" count={supCount} tone="blue"
            loading={supervisors.status === 'loading'} caption="workspace access" onClick={() => setTab('departments')} />
        </div>

          {/* ── Panels ── */}
          <div key={tab} className="ac-fade-in">
            {tab === 'approvals' && (
              <ApprovalCenter data={approvalData} handlers={handlers} onRetry={() => reloadApprovals(false)} />
            )}
            {tab === 'launch' && (
              <LaunchApprovalTab />
            )}
            {tab === 'departments' && (
              <DepartmentsTab org={org} pendingSupervisors={supervisors} executiveRequests={executiveRequests} handlers={handlers} />
            )}
            {tab === 'sites' && (
              <SitesTab data={sites} fetchHistory={fetchers.fetchSiteHistory} onRetry={loadSites} />
            )}
            {tab === 'workspace' && <WorkspaceSwitcherPanel />}
          </div>
        </div>
      </main>
    </div>
  );
}
