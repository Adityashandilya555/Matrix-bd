import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import MetricCard from '../shared/primitives/MetricCard.jsx';
import SearchBox from '../shared/primitives/SearchBox.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import OverviewFilterBar from '../shared/primitives/OverviewFilterBar.jsx';
import { getProjectQueue } from '../../services/api/projectApi.js';
import { ROUTES } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { keyActivate } from '../../lib/a11y.js';

// Project module overview — four drill-down KPIs over the project queue:
//   Ⅰ In Project    — every site in the queue (Pipeline + Sites).
//     Click → expands in place with status pills + search + the queue table.
//   Ⅱ Budget review — budgets parked with the supervisor or the admin.
//   Ⅲ In execution  — budget approved, work underway on site.
//   Ⅳ Audit cleared — quality audit approved. Click → /project/sites tab.
// Table rows deep-link into the owning tab with ?focus=<siteId> (handled by
// useFocusSite on the Pipeline / Sites pages).

const STATUS_LABELS = {
  pending: 'Awaiting allocation',
  allocated: 'Allocated',
  budgeting: 'Budgeting',
  in_progress: 'In execution',
  done: 'Done',
};

const BUDGET_LABELS = {
  draft: 'Draft',
  pending_supervisor: 'Supervisor review',
  pending_admin: 'Admin review',
  approved: 'Approved',
  rejected: 'Rejected',
};

// Sub-filter chips inside an expanded KPI — keyed by projectStatus.
const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending', color: 'var(--zm-warning)' },
  { key: 'allocated', label: 'Allocated', color: 'var(--zm-accent)' },
  { key: 'budgeting', label: 'Budgeting', color: 'var(--zm-copper)' },
  { key: 'in_progress', label: 'In execution', color: 'var(--zm-info)' },
  { key: 'done', label: 'Done', color: 'var(--zm-success)' },
];

const BUDGET_REVIEW_STATUSES = ['pending_supervisor', 'pending_admin'];

const PROJECT_STATUS_FILTERS = [
  { key: 'budget', label: 'Budget review', color: 'var(--zm-copper)' },
  { key: 'execution', label: 'In execution', color: 'var(--zm-info)' },
  { key: 'audit', label: 'Audit cleared', color: 'var(--zm-success)' },
];

// Same rule the queue page uses to split Pipeline vs Sites: a site moves to
// Sites once the quality-audit status leaves 'pending'.
const inSites = (row) => !!row.qualityAuditStatus && row.qualityAuditStatus !== 'pending';

function StatusPill({ value, tone = 'var(--zm-accent)' }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 22,
      padding: '0 10px',
      borderRadius: 4,
      border: `1px solid ${tone}`,
      color: tone,
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 800,
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {value}
    </span>
  );
}

// QueueTable — Code | Site | City | Project status | Budget. Row click
// deep-links to the owning tab (Pipeline or Sites) focused on that site.
function QueueTable({ rows, onOpen, limit }) {
  const displayRows = limit ? rows.slice(0, limit) : rows;
  const COLS = '120px minmax(220px, 1fr) 130px 170px 170px';
  return (
    <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 12,
        padding: '12px 16px',
        background: 'var(--zm-surface-2)',
        borderBottom: '1px solid var(--zm-line)',
        fontFamily: 'var(--zm-font-body)',
        fontWeight: 800,
        fontSize: 10.5,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--zm-fg-3)',
      }}>
        <span>Code</span>
        <span>Site</span>
        <span>City</span>
        <span>Project status</span>
        <span>Budget</span>
      </div>
      {displayRows.map((row) => (
        <div
          key={row.siteId}
          className="zm-row"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(row)}
          onKeyDown={keyActivate(() => onOpen(row))}
          style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--zm-line-faint)',
            cursor: 'pointer',
            alignItems: 'center',
          }}
        >
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
            {row.siteCode}
          </span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>
            {row.siteName}
            {row.allocatedToName && (
              <span style={{ display: 'block', marginTop: 3, color: 'var(--zm-fg-3)', fontWeight: 600, fontSize: 12 }}>
                Allocated to {row.allocatedToName}
              </span>
            )}
          </span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>{row.city}</span>
          <StatusPill value={STATUS_LABELS[row.projectStatus] || row.projectStatus}/>
          <StatusPill
            value={BUDGET_LABELS[row.budgetStatus] || row.budgetStatus}
            tone={row.budgetStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)'}
          />
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

export default function ProjectOverviewPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });

  // view: which KPI is expanded in place ('audit' navigates away instead).
  const [view, setView] = React.useState(null); // null | 'all' | 'budget' | 'execution'
  const [subFilter, setSubFilter] = React.useState('all'); // 'all' | projectStatus
  const [search, setSearch] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState('all');

  const load = React.useCallback(() => {
    let cancelled = false;
    // Keep loaded KPIs/list during background refreshes; failed refreshes
    // keep stale data + a banner instead of zeroing the cards.
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getProjectQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total ?? 0, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
            error: err?.detail || err?.message || 'Failed to load project queue',
          }));
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['project', 'businessAdmin', 'design', 'siteTrackerApi'] });

  const items = state.items;
  const loading = state.status === 'loading';

  const budgetReview = items.filter((r) => BUDGET_REVIEW_STATUSES.includes(r.budgetStatus));
  const inExecution = items.filter((r) => r.projectStatus === 'in_progress');
  const auditCleared = items.filter((r) => r.qualityAuditStatus === 'approved');
  const cityCount = new Set(items.map((r) => r.city).filter(Boolean)).size;
  const pendingSupervisor = budgetReview.filter((r) => r.budgetStatus === 'pending_supervisor').length;

  const pad = (n) => String(n).padStart(2, '0');
  const val = (n) => (loading ? '··' : pad(n));

  const metrics = {
    all: {
      no: 'Ⅰ', eyebrow: 'In Project', rule: 'var(--zm-accent)', tone: 'peach',
      // Headline uses the server COUNT(*); the other KPIs stay per-status over
      // the loaded items.
      value: val(state.total),
      delta: 'Pipeline + Sites',
      deltaTone: 'neutral',
      sub: loading ? 'Loading queue…' : `Across ${cityCount} cit${cityCount === 1 ? 'y' : 'ies'}`,
    },
    budget: {
      no: 'Ⅱ', eyebrow: 'Budget review', rule: 'var(--zm-copper)', tone: 'blue',
      value: val(budgetReview.length),
      delta: 'Supervisor ∥ Admin',
      deltaTone: 'neutral',
      sub: loading ? 'Loading queue…' : `${pendingSupervisor} supervisor · ${budgetReview.length - pendingSupervisor} admin`,
    },
    execution: {
      no: 'Ⅲ', eyebrow: 'In execution', rule: 'var(--zm-info)', tone: 'mint',
      value: val(inExecution.length),
      delta: 'Work underway',
      deltaTone: 'neutral',
      sub: 'Budget approved · on site',
    },
    audit: {
      no: 'Ⅳ', eyebrow: 'Audit cleared', rule: 'var(--zm-success)', tone: 'slate',
      value: val(auditCleared.length),
      delta: 'Quality audit approved',
      deltaTone: 'pos',
      sub: 'Open the Sites tab →',
    },
  };

  // Base rows for the expanded view, before sub-filter + search.
  const baseRows = view 
    ? (view === 'budget' ? budgetReview : view === 'execution' ? inExecution : items)
    : (activeFilter === 'budget' ? budgetReview : activeFilter === 'execution' ? inExecution : activeFilter === 'audit' ? auditCleared : items);
  const statusCounts = STATUS_FILTERS.reduce((acc, f) => {
    acc[f.key] = baseRows.filter((r) => r.projectStatus === f.key).length;
    return acc;
  }, {});
  const needle = search.trim().toLowerCase();
  const filteredRows = baseRows
    .filter((r) => (subFilter === 'all' ? true : r.projectStatus === subFilter))
    .filter((r) => !needle || [r.siteCode, r.siteName, r.city, r.allocatedToName].filter(Boolean).join(' ').toLowerCase().includes(needle));

  const selectKpi = (key) => {
    if (key === 'audit') { navigate(ROUTES.PROJECT_SITES); return; }
    setView((v) => (v === key ? null : key));
    setSubFilter('all');
    setSearch('');
  };

  // Row click → owning tab, focused on that exact site (?focus= handled by
  // useFocusSite on the target page).
  const openRow = (row) => {
    const focus = encodeURIComponent(row.siteId);
    navigate(inSites(row) ? `${ROUTES.PROJECT_SITES}?focus=${focus}` : `${ROUTES.PROJECT}?focus=${focus}`);
  };

  const lede = loading
    ? 'Loading the project queue…'
    : `${state.total} site${state.total === 1 ? '' : 's'} in the project queue`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 09" eyebrow="Project module" title="Overview"
        lede={lede}
        right={<HeaderTag icon="route" label="DESIGN → NSO"/>}
      />

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && !view && (
        <>
          <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
            <MetricCard {...metrics.all} onClick={() => selectKpi('all')}/>
            <MetricCard {...metrics.budget} onClick={() => selectKpi('budget')}/>
            <MetricCard {...metrics.execution} onClick={() => selectKpi('execution')}/>
            <MetricCard {...metrics.audit} onClick={() => selectKpi('audit')}/>
          </div>
          <OverviewFilterBar
            filters={PROJECT_STATUS_FILTERS.map(f => ({
              ...f,
              count: f.key === 'budget' ? budgetReview.length : f.key === 'execution' ? inExecution.length : auditCleared.length
            }))}
            active={activeFilter}
            onFilter={setActiveFilter}
            search={search}
            onSearch={setSearch}
            totalCount={items.length}
          />
          <QueueTable rows={filteredRows} limit={12} onOpen={openRow}/>
        </>
      )}

      {state.status === 'ready' && view && (
        <>
          <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <MetricCard {...metrics[view]} selected onClick={() => selectKpi(view)}/>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => selectKpi(view)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              <Icon name="arrow" size={12} style={{ transform: 'rotate(180deg)' }}/> All metrics
            </button>
            <SearchBox value={search} onChange={setSearch}/>
            {STATUS_FILTERS.filter((f) => statusCounts[f.key] > 0).map((f) => (
              <SubFilterPill
                key={f.key}
                label={f.label}
                count={statusCounts[f.key]}
                color={f.color}
                active={subFilter === f.key}
                onClick={() => setSubFilter((s) => (s === f.key ? 'all' : f.key))}
              />
            ))}
          </div>
          <QueueTable rows={filteredRows} onOpen={openRow}/>
        </>
      )}
    </div>
  );
}
