// skipcq: JS-0833
import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import MetricCard from '../shared/primitives/MetricCard.jsx';
import SearchBox from '../shared/primitives/SearchBox.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import OverviewFilterBar from '../shared/primitives/OverviewFilterBar.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { getDesignQueue } from '../../services/api/designApi.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { ROUTES } from '../../router/routes.js';
import { keyActivate } from '../../lib/a11y.js';

// Design module overview — four drill-down KPIs over the design queue:
//   Ⅰ Sites in Design — every site in the queue.
//   Ⅱ In progress     — designStatus allocated | in_progress.
//   Ⅲ Awaiting GFC    — designStatus gfc_pending.
//   Ⅳ Approved        — designStatus approved.
// Clicking a KPI expands it in place (the other cards disappear) with a
// search box + stage sub-filter pills and a table of matching queue rows.
// Clicking a row deep-links into the queue tab focused on that site.

const STATUS_LABELS = {
  pending:     { label: 'Awaiting allocation', tone: 'var(--zm-fg-3)' },
  allocated:   { label: 'Allocated',           tone: 'var(--zm-info)' },
  in_progress: { label: 'In progress',         tone: 'var(--zm-accent)' },
  gfc_pending: { label: 'Awaiting GFC',        tone: 'var(--zm-copper)' },
  approved:    { label: 'Design approved',     tone: 'var(--zm-success)' },
  rejected:    { label: 'Rejected',            tone: 'var(--zm-danger)' },
};

const STAGE_LABELS = {
  recce: 'Recce', '2d': '2D', '3d': '3D', boq: 'BOQ', gfc: 'GFC', done: 'Done',
};

// Stage sub-filter pills: exact match on currentStage.
const STAGE_PILLS = [
  { id: 'recce', label: 'Recce', color: 'var(--zm-fg-3)' },
  { id: '2d',    label: '2D',    color: 'var(--zm-info)' },
  { id: '3d',    label: '3D',    color: 'var(--zm-accent)' },
  { id: 'boq',   label: 'BOQ',   color: 'var(--zm-copper)' },
  { id: 'gfc',   label: 'GFC',   color: 'var(--zm-success)' },
];

// KPI definitions — `statuses: null` means "every queue row".
const KPIS = {
  sites: {
    no: 'Ⅰ', eyebrow: 'Sites in Design', rule: 'var(--zm-accent)', tone: 'peach',
    statuses: null,
    sub: 'Finance-approved queue',
  },
  inProgress: {
    no: 'Ⅱ', eyebrow: 'In progress', rule: 'var(--zm-info)', tone: 'blue',
    statuses: ['allocated', 'in_progress'],
    sub: 'Allocated or under work',
  },
  gfc: {
    no: 'Ⅲ', eyebrow: 'Awaiting GFC', rule: 'var(--zm-copper)', tone: 'mint',
    statuses: ['gfc_pending'],
    sub: 'Waiting on admin GFC gate',
  },
  approved: {
    no: 'Ⅳ', eyebrow: 'Approved', rule: 'var(--zm-success)', tone: 'slate',
    statuses: ['approved'],
    sub: 'GFC approved · design done',
  },
};
const KPI_ORDER = ['sites', 'inProgress', 'gfc', 'approved'];

const DESIGN_STATUS_FILTERS = [
  { key: 'inProgress', label: 'In progress', color: 'var(--zm-info)' },
  { key: 'gfc', label: 'Awaiting GFC', color: 'var(--zm-copper)' },
  { key: 'approved', label: 'Approved', color: 'var(--zm-success)' },
];

function matchesKpi(row, kpi) {
  return !kpi.statuses || kpi.statuses.includes(row.designStatus);
}

function StatusPill({ value }) {
  const meta = STATUS_LABELS[value] || { label: value || 'unknown', tone: 'var(--zm-fg-3)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${meta.tone}`, color: meta.tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

// QueueTable — Code | Site | City | Status | Stage (row styling mirrors
// DesignQueuePage). Row click deep-links into the queue tab.
function QueueTable({ rows, onOpen, limit }) {
  const displayRows = limit ? rows.slice(0, limit) : rows;
  const COLS = '120px minmax(200px, 1fr) 130px 180px 110px';
  return (
    <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: COLS,
        gap: 12, padding: '12px 16px',
        background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
        fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
      }}>
        <span>Code</span>
        <span>Site</span>
        <span>City</span>
        <span>Status</span>
        <span>Stage</span>
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
            display: 'grid', gridTemplateColumns: COLS,
            gap: 12, padding: '14px 16px',
            borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer',
            alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
            {row.siteCode}
          </span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 700, color: 'var(--zm-fg)' }}>
            {row.siteName}
          </span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
            {row.city}
          </span>
          <span><StatusPill value={row.designStatus}/></span>
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
            {STAGE_LABELS[row.currentStage] || '—'}
          </span>
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

export default function DesignOverviewPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  // view: which KPI is expanded in place; null = all four cards.
  const [view, setView] = React.useState(null);
  const [stage, setStage] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState('all');

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: s.items.length ? s.status : 'loading', error: null }));
    getDesignQueue()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // Failed background refresh keeps the loaded KPIs/list + shows a banner.
        setState((s) => ({
          ...s,
          status: s.items.length ? 'ready' : 'error',
          error: err?.detail || err?.message || 'Failed to load design queue',
        }));
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['design', 'businessAdmin', 'siteTrackerApi', 'legalApi'] });

  const items = state.items;
  // The headline "Sites in Design" card + lede use the server COUNT(*)
  // (state.total); the other KPIs are per-status breakdowns over loaded items.
  const countFor = (key) => (KPIS[key].statuses == null
    ? state.total
    : items.filter((r) => matchesKpi(r, KPIS[key])).length);

  const selectKpi = (key) => {
    setView((v) => (v === key ? null : key));
    setStage('all');
    setSearch('');
  };

  // Rows for the expanded view: KPI status subset → stage pill → search.
  const subset = view 
    ? (KPIS[view] ? items.filter((r) => matchesKpi(r, KPIS[view])) : items)
    : (activeFilter === 'all' ? items : items.filter((r) => matchesKpi(r, KPIS[activeFilter])));
  const stageCounts = Object.fromEntries(STAGE_PILLS.map((p) => [p.id, subset.filter((r) => r.currentStage === p.id).length]));
  const needle = search.trim().toLowerCase();
  const filtered = subset
    .filter((r) => view ? (stage === 'all' || r.currentStage === stage) : true)
    .filter((r) => !needle || [r.siteCode, r.siteName, r.city].filter(Boolean).join(' ').toLowerCase().includes(needle));

  const openRow = (row) => navigate(`${ROUTES.DESIGN}?focus=${encodeURIComponent(row.siteId)}`);

  const total = state.total; // server COUNT(*) headline
  const lede = state.status === 'ready'
    ? `${total} site${total === 1 ? '' : 's'} in design`
    : 'Module KPIs and drill-downs.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 06" eyebrow="Design module" title="Overview"
        lede={lede}
        right={<HeaderTag icon="box" label="FINANCE APPROVED"/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading overview…
        </div>
      )}

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && !view && (
        <>
          <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
            {KPI_ORDER.map((key) => {
              const k = KPIS[key];
              return (
                <MetricCard
                  key={key}
                  tone={k.tone}
                  no={k.no} eyebrow={k.eyebrow} rule={k.rule}
                  value={String(countFor(key)).padStart(2, '0')}
                  sub={k.sub}
                  onClick={() => selectKpi(key)}
                />
              );
            })}
          </div>
          <OverviewFilterBar
            filters={DESIGN_STATUS_FILTERS.map(f => ({
              ...f,
              count: countFor(f.key)
            }))}
            active={activeFilter}
            onFilter={setActiveFilter}
            search={search}
            onSearch={setSearch}
            totalCount={total}
          />
          <QueueTable rows={filtered} limit={12} onOpen={openRow}/>
        </>
      )}

      {state.status === 'ready' && view && (
        <>
          <div>
            <button
              type="button"
              onClick={() => setView(null)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              <Icon name="arrow" size={12} style={{ transform: 'rotate(180deg)' }}/> All metrics
            </button>
          </div>

          <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <MetricCard
              tone={KPIS[view].tone}
              no={KPIS[view].no} eyebrow={KPIS[view].eyebrow} rule={KPIS[view].rule}
              value={String(subset.length).padStart(2, '0')}
              sub={KPIS[view].sub}
              selected
              onClick={() => selectKpi(view)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <SearchBox value={search} onChange={setSearch}/>
            {STAGE_PILLS.map((p) => (
              <SubFilterPill
                key={p.id}
                label={p.label}
                count={stageCounts[p.id]}
                color={p.color}
                active={stage === p.id}
                onClick={() => setStage((s) => (s === p.id ? 'all' : p.id))}
              />
            ))}
          </div>

          <QueueTable rows={filtered} onOpen={openRow}/>
        </>
      )}
    </div>
  );
}
