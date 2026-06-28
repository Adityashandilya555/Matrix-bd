import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import MetricCard from '../shared/primitives/MetricCard.jsx';
import OverviewFilterBar from '../shared/primitives/OverviewFilterBar.jsx';
import { getPEQueue } from '../../services/api/projectExcellenceApi.js';
import { ROUTES } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// Project Excellence overview — four KPIs over the PE queue. Each card
// deep-links into the Pipeline (queue) tab, where the matching status filter
// can be applied. Mirrors the Project module's overview pattern.

const STATUS_LABELS = {
  pending: 'Awaiting allocation',
  allocated: 'Allocated',
  budgeting: 'Budgeting',
  in_progress: 'In execution',
  approved: 'Approved',
  done: 'Done'
};
const BUDGET_LABELS = {
  draft: 'Draft',
  pending_supervisor: 'Supervisor review',
  pending_admin: 'Admin review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const PE_STATUS_FILTERS = [
  { key: 'pending', label: 'Awaiting allocation', color: 'var(--zm-warning)' },
  { key: 'budgeting', label: 'Budgeting', color: 'var(--zm-copper)' },
  { key: 'approved', label: 'Approved', color: 'var(--zm-success)' },
];

function StatusPill({ value, tone = 'var(--zm-accent)' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${tone}`, color: tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10,
      letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {value}
    </span>
  );
}

function QueueTable({ rows, onOpen, limit }) {
  const displayRows = limit ? rows.slice(0, limit) : rows;
  const COLS = '120px minmax(220px, 1fr) 130px 170px 170px';
  return (
    <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 16px',
        background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
        fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
      }}>
        <span>Code</span>
        <span>Site</span>
        <span>City</span>
        <span>Excellence status</span>
        <span>Budget status</span>
      </div>
      {displayRows.map((row) => (
        <div key={row.siteId} className="zm-row" onClick={() => onOpen(row)} style={{
          display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 16px',
          borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer', alignItems: 'center',
        }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>{row.siteCode}</span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>{row.siteName}</span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>{row.city}</span>
          <StatusPill value={STATUS_LABELS[row.excellenceStatus] || row.excellenceStatus} />
          <StatusPill value={BUDGET_LABELS[row.budgetStatus] || row.budgetStatus} tone={row.budgetStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)'} />
        </div>
      ))}
      {rows.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
          No sites match the current filter.
        </div>
      )}
    </div>
  );
}

export default function ProjectExcellenceOverviewPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [activeFilter, setActiveFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');
  // Monotonic request id: useSiteDataRefresh calls load() directly (not via the
  // effect's cleanup), so a per-call `cancelled` flag can't stop an older,
  // slower getPEQueue() response from clobbering a newer one. Only the latest
  // request's result is allowed to write state.
  const reqIdRef = React.useRef(0);

  const load = React.useCallback(() => {
    const reqId = ++reqIdRef.current;
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getPEQueue()
      .then((data) => {
        if (reqId === reqIdRef.current) setState({ status: 'ready', items: data.items, total: data.total ?? 0, error: null });
      })
      .catch((err) => {
        if (reqId === reqIdRef.current) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
            error: err?.detail || err?.message || 'Failed to load project excellence queue',
          }));
        }
      });
    return undefined;
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['project_excellence', 'businessAdmin', 'project'] });

  const items = state.items;
  const loading = state.status === 'loading';

  const pendingItems = items.filter((r) => r.excellenceStatus === 'pending');
  const budgetingItems = items.filter((r) => r.excellenceStatus === 'allocated' || r.excellenceStatus === 'budgeting');
  const approvedItems = items.filter((r) => r.excellenceStatus === 'approved' || r.excellenceStatus === 'done');

  const pending = pendingItems.length;
  const budgeting = budgetingItems.length;
  const approved = approvedItems.length;
  
  const subset = activeFilter === 'pending' ? pendingItems
               : activeFilter === 'budgeting' ? budgetingItems
               : activeFilter === 'approved' ? approvedItems
               : items;
  const needle = search.trim().toLowerCase();
  const filteredRows = subset.filter((r) => !needle || [r.siteCode, r.siteName, r.city].join(' ').toLowerCase().includes(needle));

  const adminReview = items.filter((r) => r.budgetStatus === 'pending_admin').length;
  const cityCount = new Set(items.map((r) => r.city).filter(Boolean)).size;

  const pad = (n) => String(n).padStart(2, '0');
  const val = (n) => (loading ? '··' : pad(n));

  const metrics = {
    all: {
      no: 'Ⅰ', eyebrow: 'In Project Excellence', rule: 'var(--zm-accent)', tone: 'peach',
      // Headline uses the server COUNT(*); the other KPIs stay per-status over
      // the loaded items.
      value: val(state.total), delta: 'Pipeline', deltaTone: 'neutral',
      sub: loading ? 'Loading queue…' : `Across ${cityCount} cit${cityCount === 1 ? 'y' : 'ies'}`,
    },
    pending: {
      no: 'Ⅱ', eyebrow: 'Awaiting allocation', rule: 'var(--zm-warning)', tone: 'blue',
      value: val(pending), delta: 'Needs a supervisor', deltaTone: 'neutral',
      sub: 'Unallocated sites',
    },
    budgeting: {
      no: 'Ⅲ', eyebrow: 'Budgeting', rule: 'var(--zm-copper)', tone: 'mint',
      value: val(budgeting), delta: 'Allocated · in progress', deltaTone: 'neutral',
      sub: loading ? 'Loading queue…' : `${adminReview} awaiting admin review`,
    },
    approved: {
      no: 'Ⅳ', eyebrow: 'Approved', rule: 'var(--zm-success)', tone: 'slate',
      value: val(approved), delta: 'Budget approved', deltaTone: 'pos',
      sub: 'Open the History tab →',
    },
  };

  const openQueue = () => navigate(ROUTES.PROJECT_EXCELLENCE);
  const openHistory = () => navigate(ROUTES.PROJECT_EXCELLENCE_HISTORY);

  const openRow = (row) => {
    if (row.excellenceStatus === 'approved' || row.excellenceStatus === 'done') {
      navigate(`${ROUTES.PROJECT_EXCELLENCE_HISTORY}?focus=${encodeURIComponent(row.siteId)}`);
    } else {
      navigate(`${ROUTES.PROJECT_EXCELLENCE}?focus=${encodeURIComponent(row.siteId)}`);
    }
  };

  const lede = loading
    ? 'Loading the project excellence queue…'
    : `${state.total} site${state.total === 1 ? '' : 's'} in the project excellence queue`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow="Project Excellence module"
        title="Overview"
        lede={lede}
        right={<HeaderTag icon="box" label="DESIGN → PROJECT"/>}
      />

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
            <MetricCard {...metrics.all} onClick={openQueue}/>
            <MetricCard {...metrics.pending} onClick={openQueue}/>
            <MetricCard {...metrics.budgeting} onClick={openQueue}/>
            <MetricCard {...metrics.approved} onClick={openHistory}/>
          </div>
          <OverviewFilterBar
            filters={PE_STATUS_FILTERS.map(f => ({
              ...f,
              count: f.key === 'pending' ? pending : f.key === 'budgeting' ? budgeting : approved
            }))}
            active={activeFilter}
            onFilter={setActiveFilter}
            search={search}
            onSearch={setSearch}
            totalCount={items.length}
          />
          <QueueTable rows={filteredRows} limit={12} onOpen={openRow} />
        </>
      )}
    </div>
  );
}
