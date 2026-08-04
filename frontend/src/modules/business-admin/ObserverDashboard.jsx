// skipcq: JS-0833
// ObserverDashboard — the read-only workspace portal.
//
// A sibling of TeamDashboard rather than a variant of it. The two share every
// tab component; what differs is the shell, and it differs in ways a `variant`
// prop would have made worse: no approval queues to fetch or aggregate, no KPI
// tiles deep-linking into them, a different default tab, and a polling loop that
// fans out two requests instead of five. Threading all of that through the
// admin's shell would have put observer branches inside the busiest component in
// the portal.
//
// What the observer gets: Sites (identical to the admin's, including full
// history) and Departments (the org directory, view-only). Nothing here can
// write — the backend refuses every non-GET from this role at get_current_user,
// so the omissions below are about not showing a button that would 403, not
// about being the security boundary.
import React from 'react';
import './approval-center.css';
import { GRID_LAYERS, GRID_ATTACH, stageVignette, canvasBase } from '../../lib/surfaces.js';
import { PRODUCT_NAME } from '../../router/routes.js';
import { getAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from './jwt.js';
import { getOrg, getAllSites, getSiteHistory } from '../../services/api/businessAdminApi.js';
import { T, Icon, IconButton, StatTile, getInitialTheme, persistTheme } from './ui/kit.jsx';
import Sidebar from './ui/Sidebar.jsx';
import { useQueue } from './ui/useQueue.js';
import DepartmentsTab from './departments/DepartmentsTab.jsx';
import SitesTab, { classifyCounts } from './sites/SitesTab.jsx';
import { PageContext } from '../../App.jsx';

export const OBSERVER_FETCHERS = {
  listOrg: getOrg,
  listSites: getAllSites,
  fetchSiteHistory: getSiteHistory,
};

// Keyed, not an index-spread of a shared TABS array. The admin's navItems is
// built as TABS[0], TABS[2]… which silently breaks the moment the list changes
// shape — and the observer's list IS a different shape.
const TABS = [
  { key: 'sites',       label: 'Sites',            icon: Icon.pin },
  { key: 'departments', label: 'Departments',      icon: Icon.key },
  { key: 'workspace',   label: 'Workspace Access', icon: Icon.external },
];

export default function ObserverDashboard({ onLogout, fetchers = OBSERVER_FETCHERS, workspaceName }) {
  const company = workspaceName ?? (() => {
    const p = decodeJwtPayload(getAuthToken());
    return p.workspace_name || p.tenant_name || p.company || '';
  })();

  // Sites, not approvals — an observer has no approval surface to land on.
  const [tab, setTab] = React.useState('sites');
  const [sitesFilter, setSitesFilter] = React.useState('active');
  const openSites = (filter) => { setSitesFilter(filter); setTab('sites'); };
  const [refreshingAll, setRefreshingAll] = React.useState(false);

  const [theme, setTheme] = React.useState(getInitialTheme);
  const toggleTheme = () => setTheme((t) => {
    const next = t === 'dark' ? 'light' : 'dark';
    persistTheme(next);
    return next;
  });
  const [navExpanded, setNavExpanded] = React.useState(() => {
    try { return window.localStorage.getItem('ac-nav') !== 'collapsed'; } catch { return true; }
  });
  const toggleNav = () => setNavExpanded((v) => {
    const next = !v;
    try { window.localStorage.setItem('ac-nav', next ? 'expanded' : 'collapsed'); } catch { /* ignore */ }
    return next;
  });

  const [org, loadOrg] = useQueue(fetchers.listOrg);
  const [sites, loadSites] = useQueue(fetchers.listSites);

  const refreshAll = React.useCallback(async (silent = false) => {
    if (!silent) setRefreshingAll(true);
    try { await Promise.all([loadOrg(true), loadSites(true)]); }
    finally { if (!silent) setRefreshingAll(false); }
  }, [loadOrg, loadSites]);

  React.useEffect(() => {
    // Same 30s tick and hidden-tab skip as the admin portal (#386).
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshAll(true);
    }, 30000);
    return () => window.clearInterval(pollId);
  }, [refreshAll]);

  const counts = React.useMemo(() => classifyCounts(sites.items || []), [sites.items]);

  // Every write handler is deliberately absent rather than passed as a no-op.
  // DepartmentsTab and OrgModuleCard already render their affordances only when
  // the callback exists, so omission is what hides them — a no-op would leave a
  // button that looks live and does nothing.
  const handlers = React.useMemo(() => ({
    reloadOrg: loadOrg,
    reloadPendingSupervisors: () => {},
    reloadExecutiveRequests: () => {},
    reloadObservers: () => {},
  }), [loadOrg]);

  const emptyQueue = { status: 'ready', items: [], total: 0, error: null, refreshing: false };

  return (
    <div className="ac-root" data-theme={theme}
      style={{ height: '100vh', background: 'var(--zm-bg)', color: 'var(--zm-fg)', display: 'flex', boxSizing: 'border-box' }}>
      <Sidebar items={TABS} active={tab} onChange={setTab}
        expanded={navExpanded} onToggleExpanded={toggleNav}
        theme={theme} onToggleTheme={toggleTheme} onLogout={onLogout}
        sub="Observer" />

      <main className="zm-app-main" style={{ flex: 1, minWidth: 0, height: '100%', overflowY: 'auto',
        backgroundColor: canvasBase(theme === 'dark'),
        backgroundImage: stageVignette(theme === 'dark') + ', ' + GRID_LAYERS,
        backgroundAttachment: 'fixed, fixed, ' + GRID_ATTACH,
      }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 34px 60px' }}>

          <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: T.textMuted }}>
                {PRODUCT_NAME} · Observer
              </div>
              <h1 style={{ margin: '5px 0 0', fontSize: 27, fontWeight: 730, letterSpacing: '-0.025em', color: T.text }}>
                {company || 'Workspace'}
              </h1>
              <div style={{ marginTop: 3, fontSize: 13, color: T.textMuted }}>Read-only view of the workspace</div>
            </div>
            <span style={{ flex: 1 }} />
            <IconButton label="Refresh" loading={refreshingAll} onClick={() => refreshAll(false)}>
              <Icon.refresh size={16} />
            </IconButton>
          </header>

          {/* Stated once, up front. Every module surface this role can reach is
              view-only, and saying so beats letting someone discover it by
              hunting for a button that was never rendered. */}
          <div role="status" style={{
            display: 'flex', alignItems: 'center', gap: 9, marginBottom: 20,
            padding: '9px 13px', borderRadius: 10,
            background: 'color-mix(in srgb, var(--zm-accent) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--zm-accent) 28%, transparent)',
            color: T.accentText, fontSize: 12.5, fontWeight: 600,
          }}>
            <Icon.shield size={15} />
            You have read-only access. Nothing here can be edited, approved or deleted.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(212px, 1fr))', gap: 14, marginBottom: 24 }}
            className="ac-stagger">
            <StatTile icon={Icon.pin} label="Active sites" count={counts.active}
              caption="In the pipeline now" tone="accent"
              loading={sites.status === 'loading'} onClick={() => openSites('active')} />
            <StatTile icon={Icon.flag} label="Launching" count={counts.launching}
              caption="Past NSO approval" tone="warn"
              loading={sites.status === 'loading'} onClick={() => openSites('launching')} />
            <StatTile icon={Icon.check} label="Completed" count={counts.completed}
              caption="Financially closed" tone="success"
              loading={sites.status === 'loading'} onClick={() => openSites('completed')} />
          </div>

          <div key={tab} className="ac-fade-in">
            {tab === 'sites' && (
              <SitesTab data={sites} fetchHistory={fetchers.fetchSiteHistory} onRetry={loadSites}
                filter={sitesFilter} onFilterChange={setSitesFilter} readOnly />
            )}
            {tab === 'departments' && (
              // No pending queues: approving people is the admin's job, and an
              // observer seeing an empty "Awaiting approval" list would imply it
              // could act on one.
              <DepartmentsTab org={org} pendingSupervisors={emptyQueue}
                executiveRequests={emptyQueue} handlers={handlers} readOnly />
            )}
            {tab === 'workspace' && <ObserverWorkspaceNotice />}
          </div>
        </div>
      </main>
    </div>
  );
}

// Placeholder until PR 4 wires read-only module switching. Says what the tab is
// for rather than rendering an empty panel.
function ObserverWorkspaceNotice() {
  return (
    <div style={{
      padding: '30px 24px', textAlign: 'center', borderRadius: 14,
      border: `1px dashed ${T.lineStrong}`, background: T.surface,
    }}>
      <Icon.external size={22} />
      <div style={{ marginTop: 10, fontSize: 14, fontWeight: 650, color: T.text }}>Module views</div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: T.textFaint, maxWidth: 460, margin: '4px auto 0', lineHeight: 1.5 }}>
        Opening a module read-only from here is coming next. Until then, every site
        and its full history are on the Sites tab.
      </div>
    </div>
  );
}

// Wrapped so the tabs' toasts actually appear. TeamDashboard mounts outside the
// app's PageContext.Provider, so showToast() there resolves to the no-op default
// and every toast in the admin portal is silently swallowed — including
// "Deleted · … are gone". Not copying that forward.
export function ObserverDashboardWithContext(props) {
  const [toast, setToast] = React.useState(null);
  const ctx = React.useMemo(() => ({
    showToast: (message, tone) => setToast({ message, tone }),
    onOpenSite: () => {},
  }), []);

  React.useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <PageContext.Provider value={ctx}>
      <ObserverDashboard {...props} />
      {toast && (
        <div role="status" style={{
          position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)',
          zIndex: 5000, padding: '10px 16px', borderRadius: 10,
          background: T.surfaceRaised, border: `1px solid ${toast.tone === 'danger' ? T.danger : T.line}`,
          color: T.text, fontSize: 13, boxShadow: 'var(--zm-shadow-pop)',
        }}>
          {toast.message}
        </div>
      )}
    </PageContext.Provider>
  );
}
