import React from 'react';
import './approval-center.css';
import { getAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from './jwt.js';
import {
  getDesignAdminQueue, adminReviewDeliverable,
  getDesignGfcQueue, getDesignGfcReview, decideGfc,
} from '../../services/api/designApi.js';
import {
  getFinanceQueue, approveFinance, getBudgetQueue, reviewBudget,
  getOrg, getAllSites, getSiteHistory,
} from '../../services/api/businessAdminApi.js';
import {
  rotateDeptCode, listPendingSupervisors, approveSupervisor, rejectSupervisor,
} from '../../services/api/adapters/httpAdapter.js';

import { T, Icon, Button, IconButton, StatTile, SegmentedNav, TABULAR } from './ui/kit.jsx';
import ApprovalCenter from './approval/ApprovalCenter.jsx';
import DepartmentsTab from './departments/DepartmentsTab.jsx';
import SitesTab from './sites/SitesTab.jsx';

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
  listBudget:        getBudgetQueue,
  reviewBudget,
  listSupervisors:   listPendingSupervisors,
  approveSupervisor,
  rejectSupervisor,
  rotateDeptCode,
  listOrg:           getOrg,
  listSites:         getAllSites,
  fetchSiteHistory:  getSiteHistory,
};

const errMsg = (e) => e?.detail || e?.message || 'Failed to load';

function useQueue(fetcher) {
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null, refreshing: false });
  const load = React.useCallback(async (silent = false) => {
    setState((s) => (silent ? { ...s, refreshing: true } : { status: 'loading', items: [], error: null, refreshing: false }));
    try {
      const d = await fetcher();
      const items = Array.isArray(d) ? d : (d?.items || []);
      setState({ status: 'ready', items, error: null, refreshing: false });
    } catch (e) {
      setState((s) => (silent && s.items.length
        ? { ...s, error: errMsg(e), refreshing: false }
        : { status: 'error', items: [], error: errMsg(e), refreshing: false }));
    }
  }, [fetcher]);
  React.useEffect(() => { load(false); }, [load]);
  return [state, load];
}

const TABS = [
  { key: 'approvals',   label: 'Approval Center', icon: Icon.check },
  { key: 'departments', label: 'Departments',     icon: Icon.key },
  { key: 'sites',       label: 'Sites',           icon: Icon.pin },
];

export default function TeamDashboard({ onLogout, fetchers = REAL_FETCHERS, workspaceName }) {
  const company = workspaceName ?? (() => {
    const p = decodeJwtPayload(getAuthToken());
    return p.workspace_name || p.tenant_name || p.company || '';
  })();

  const [tab, setTab] = React.useState('approvals');
  const [refreshingAll, setRefreshingAll] = React.useState(false);

  // Approval queues (aggregated by site below)
  const [deliverables, loadDeliverables] = useQueue(fetchers.listDeliverables);
  const [gfc, loadGfc] = useQueue(fetchers.listGfc);
  const [finance, loadFinance] = useQueue(fetchers.listFinance);
  const [budget, loadBudget] = useQueue(fetchers.listBudget);
  // Departments
  const [supervisors, loadSupervisors] = useQueue(fetchers.listSupervisors);
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
          design: { deliverables: [], gfcPending: false, boqAmount: null }, payment: null, project: null,
        });
      }
      return map.get(s.siteId);
    };
    for (const s of deliverables.items || []) ensure(s).design.deliverables = s.deliverables || [];
    for (const s of gfc.items || []) { const e = ensure(s); e.design.gfcPending = true; e.design.boqAmount = s.boqEstimatedAmount ?? null; }
    for (const s of finance.items || []) ensure(s).payment = { caCode: s.caCode, financeAmount: s.financeAmount };
    for (const s of budget.items || []) ensure(s).project = { budgetTotal: s.budgetTotal };
    return [...map.values()];
  }, [deliverables.items, gfc.items, finance.items, budget.items]);

  const aq = [deliverables, gfc, finance, budget];
  // Resilient: only block the whole center if EVERY queue failed. One queue
  // failing (e.g. project-budget routes not deployed yet) still shows the rest.
  const approvalStatus = aq.some((q) => q.status === 'loading') ? 'loading'
    : aq.every((q) => q.status === 'error') ? 'error' : 'ready';
  const approvalError = aq.find((q) => q.status === 'error')?.error;
  const approvalData = { status: approvalStatus, sites: approvalSites, error: approvalError };

  const reloadApprovals = (silent) => Promise.all([loadDeliverables(silent), loadGfc(silent), loadFinance(silent), loadBudget(silent)]);

  // ── derived counts ──
  const designSites = approvalSites.filter((s) => (s.design.deliverables.length + (s.design.gfcPending ? 1 : 0)) > 0).length;
  const paymentSites = approvalSites.filter((s) => s.payment).length;
  const supCount = supervisors.items.length;
  const sitesCount = sites.items.length;

  // ── handlers ──
  const handlers = {
    // approvals
    onDeliverableDecide: async (siteId, kind, payload) => { await fetchers.reviewDeliverable(siteId, kind, payload); await loadDeliverables(true); },
    fetchGfcReview: fetchers.reviewGfcPackage,
    onGfcDecide: async (siteId, payload) => { await fetchers.decideGfc(siteId, payload); await loadGfc(true); },
    onApproveFinance: async (siteId) => { await fetchers.approveFinance(siteId); await loadFinance(true); },
    onBudgetDecide: async (siteId, payload) => { await fetchers.reviewBudget(siteId, payload); await loadBudget(true); },
    // departments
    onApproveSupervisor: async (u) => { await fetchers.approveSupervisor(u.id, u.module); await loadSupervisors(true); await loadOrg(true); },
    onRejectSupervisor: async (u) => { await fetchers.rejectSupervisor(u.id); await loadSupervisors(true); },
    onRotate: async (moduleKey) => { await fetchers.rotateDeptCode(moduleKey); await loadOrg(true); },
    reloadPendingSupervisors: loadSupervisors,
    reloadOrg: loadOrg,
  };

  const refreshAll = async () => {
    setRefreshingAll(true);
    try { await Promise.all([reloadApprovals(true), loadSupervisors(true), loadOrg(true), loadSites(true)]); }
    finally { setRefreshingAll(false); }
  };

  return (
    <div className="ac-root" style={{ minHeight: '100vh', maxHeight: '100vh', overflowY: 'auto', background: T.bg, color: T.text }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 28px 72px' }}>

        {/* ── Header ── */}
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.textMuted }}>Matrix · Business admin</div>
            <h1 style={{ margin: '5px 0 0', fontSize: 27, fontWeight: 720, letterSpacing: '-0.025em', color: T.text }}>{company || 'Workspace'}</h1>
            <div style={{ marginTop: 3, fontSize: 13, color: T.textMuted }}>Approval center</div>
          </div>
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconButton label="Refresh all" loading={refreshingAll} onClick={refreshAll}><Icon.refresh size={16} /></IconButton>
            <Button variant="ghost" size="md" icon={<Icon.signout size={15} />} onClick={onLogout}>Sign out</Button>
          </div>
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
        </div>

        {/* ── Overview tiles ── */}
        <div className="ac-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <StatTile icon={Icon.check} label="Sites awaiting approval" count={approvalSites.length} tone="warn"
            loading={approvalStatus === 'loading'} caption={approvalSites.length ? `${designSites} design · ${paymentSites} payment` : 'all clear'}
            onClick={() => setTab('approvals')} />
          <StatTile icon={Icon.users} label="Pending supervisors" count={supCount} tone="warn"
            loading={supervisors.status === 'loading'} caption={supCount ? 'awaiting approval' : 'all clear'}
            onClick={() => setTab('departments')} />
          <StatTile icon={Icon.pin} label="Sites in system" count={sitesCount} tone="neutral"
            loading={sites.status === 'loading'} caption="view pipeline & history" onClick={() => setTab('sites')} />
        </div>

        {/* ── Tabs ── */}
        <div style={{ marginBottom: 22 }}>
          <SegmentedNav active={tab} onChange={setTab} tabs={[
            { ...TABS[0], count: approvalSites.length },
            { ...TABS[1], count: supCount },
            { ...TABS[2] },
          ]} />
        </div>

        {/* ── Panels ── */}
        <div key={tab} className="ac-fade-in">
          {tab === 'approvals' && (
            <ApprovalCenter data={approvalData} handlers={handlers} onRetry={() => reloadApprovals(false)} />
          )}
          {tab === 'departments' && (
            <DepartmentsTab org={org} pendingSupervisors={supervisors} handlers={handlers} />
          )}
          {tab === 'sites' && (
            <SitesTab data={sites} fetchHistory={fetchers.fetchSiteHistory} onRetry={loadSites} />
          )}
        </div>
      </div>
    </div>
  );
}
