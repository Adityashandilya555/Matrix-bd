// skipcq: JS-0833
import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import { keyActivate } from '../../lib/a11y.js';
import Icon from '../shared/primitives/Icon.jsx';
import MetricCard from '../shared/primitives/MetricCard.jsx';
import SearchBox from '../shared/primitives/SearchBox.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import OverviewFilterBar from '../shared/primitives/OverviewFilterBar.jsx';
import { getNsoQueue } from '../../services/api/nsoApi.js';
import { ROUTES } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// NSO module overview — four drill-down KPIs over the opening-readiness queue:
//   Ⅰ In NSO            — everything in the queue (finance / CA ready).
//   Ⅱ Property          — pending + stage_one (property readiness).
//   Ⅲ Licenses & launch — stage_two + stage_three + final_review.
//   Ⅳ Complete          — final sign-off done.
// Clicking a KPI hides the others and reveals stage sub-filter pills, search
// and the queue table; clicking a row deep-links into /nso?focus=<siteId>.

const STAGE_DEFS = [
  { key: 'pending',      label: 'Pending',      color: 'var(--zm-fg-3)' },
  { key: 'stage_one',    label: 'Property',     color: 'var(--zm-info)' },
  { key: 'stage_two',    label: 'Licenses',     color: 'var(--zm-copper)' },
  { key: 'stage_three',  label: 'Launch',       color: 'var(--zm-warning)' },
  { key: 'final_review', label: 'Final review', color: 'var(--zm-accent)' },
  { key: 'complete',     label: 'Complete',     color: 'var(--zm-success)' },
];

const STAGE_LABELS = Object.fromEntries(STAGE_DEFS.map((s) => [s.key, s.label]));

// Normalize a queue row to one canonical stage bucket. The backend emits
// current_stage ∈ stage_one|stage_two|stage_three|final|done (with nso_status
// pending|in_progress|complete); older callers used final_review/complete.
function stageOf(row) {
  const s = row.currentStage;
  if (row.nsoStatus === 'complete' || s === 'done' || s === 'complete') return 'complete';
  if (s === 'final' || s === 'final_review') return 'final_review';
  if (s === 'stage_three') return 'stage_three';
  if (s === 'stage_two') return 'stage_two';
  if (s === 'pending' || s == null || s === '') return 'pending';
  return 'stage_one';
}

const KPI_DEFS = [
  { key: 'total',    no: 'Ⅰ', eyebrow: 'In NSO',            rule: 'var(--zm-accent)',  tone: 'peach', stages: null,                                        delta: 'Finance / CA ready',     sub: 'All active opening files' },
  { key: 'property', no: 'Ⅱ', eyebrow: 'Property',          rule: 'var(--zm-info)',    tone: 'blue',  stages: ['pending', 'stage_one'],                    delta: 'Stage 1 · open',         sub: 'Property readiness underway', deltaTone: 'neutral' },
  { key: 'licenses', no: 'Ⅲ', eyebrow: 'Licenses & launch', rule: 'var(--zm-copper)',  tone: 'mint',  stages: ['stage_two', 'stage_three', 'final_review'], delta: 'Stages 2–3 + review',    sub: 'Licenses, launch checks, sign-off', deltaTone: 'neutral' },
  { key: 'complete', no: 'Ⅳ', eyebrow: 'Complete',          rule: 'var(--zm-success)', tone: 'slate', stages: ['complete'],                                delta: 'Final sign-off done',    sub: 'Ready for handover' },
];

const NSO_STATUS_FILTERS = [
  { key: 'property', label: 'Property', color: 'var(--zm-info)' },
  { key: 'licenses', label: 'Licenses & launch', color: 'var(--zm-copper)' },
  { key: 'complete', label: 'Complete', color: 'var(--zm-success)' },
];

function pretty(value) {
  if (value == null || value === '') return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// StatusPill — same outlined pill styling as the NSO Sites tab rows.
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
      justifySelf: 'start',
    }}>
      {pretty(value)}
    </span>
  );
}

const COLS = '120px minmax(220px, 1fr) 130px 160px';

function QueueTable({ rows, onOpen, limit, style }) {
  const displayRows = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}>
      <div style={{
        flexShrink: 0,
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
        <span>NSO stage</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
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
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
              {row.siteCode}
            </span>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>
              {row.siteName}
              {row.nextAction && (
                <span style={{ display: 'block', marginTop: 3, color: 'var(--zm-fg-3)', fontWeight: 600, fontSize: 12 }}>
                  {row.nextAction}
                </span>
              )}
            </span>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>{row.city}</span>
            <StatusPill
              value={STAGE_LABELS[stageOf(row)] || row.currentStage}
              tone={stageOf(row) === 'complete' ? 'var(--zm-success)' : 'var(--zm-accent)'}
            />
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
            No NSO sites match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}

export default function NsoOverviewPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [view, setView] = React.useState(null);       // null | KPI key
  const [stageFilter, setStageFilter] = React.useState('all'); // 'all' | stage key
  const [search, setSearch] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState('all');

  const load = React.useCallback((silent = false) => {
    let cancelled = false;
    if (!silent) setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getNsoQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          if (silent && err?.code === 'TIMEOUT') return;
          setState((prev) => ({
            ...prev,
            status: (silent && prev.items.length) ? 'ready' : (prev.items.length ? 'ready' : 'error'),
            error: err?.detail || err?.message || 'Failed to load NSO queue',
          }));
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['nso', 'project', 'businessAdmin', 'payment', 'legalApi', 'siteTrackerApi', 'launch'] });

  const { items } = state;
  const stageCounts = React.useMemo(() => STAGE_DEFS.reduce((acc, s) => {
    acc[s.key] = items.filter((row) => stageOf(row) === s.key).length;
    return acc;
  }, {}), [items]);

  const kpiCount = (kpi) => (kpi.stages
    ? kpi.stages.reduce((sum, s) => sum + stageCounts[s], 0)
    : (state.total || items.length));

  const selectKpi = (key) => {
    setView((v) => (v === key ? null : key));
    setStageFilter('all');
    setSearch('');
  };

  const selectedKpi = view ? KPI_DEFS.find((k) => k.key === view) : (activeFilter === 'all' ? null : KPI_DEFS.find((k) => k.key === activeFilter));

  // Rows: an active stage pill filters the whole queue by that stage;
  // otherwise the table shows the selected KPI's scope. Search applies last.
  const filteredRows = React.useMemo(() => {
    const currentStageFilter = view ? stageFilter : 'all';
    const baseRows = currentStageFilter !== 'all'
      ? items.filter((row) => stageOf(row) === currentStageFilter)
      : (selectedKpi?.stages
        ? items.filter((row) => selectedKpi.stages.includes(stageOf(row)))
        : items);
    const needle = search.trim().toLowerCase();
    return baseRows
      .filter((row) => !needle || [row.siteCode, row.siteName, row.city, row.caCode]
        .filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [items, stageFilter, selectedKpi, search, view]);

  const total = state.total || items.length;
  const lede = state.status === 'ready'
    ? `${total} site${total === 1 ? '' : 's'} in NSO · property readiness → licenses → launch → sign-off`
    : 'Module KPIs and drill-downs across the opening-readiness queue.';

  const openRow = (row) => navigate(`${ROUTES.NSO}?focus=${encodeURIComponent(row.siteId)}`);

  const renderCard = (kpi, selected = false) => (
    <MetricCard
      key={kpi.key}
      tone={kpi.tone}
      no={kpi.no}
      eyebrow={kpi.eyebrow}
      value={String(kpiCount(kpi)).padStart(2, '0')}
      rule={kpi.rule}
      delta={kpi.delta}
      deltaTone={kpi.deltaTone || 'pos'}
      sub={kpi.sub}
      selected={selected}
      onClick={() => selectKpi(kpi.key)}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0 }}>
        <PageHeader
          file="No. 10" eyebrow="NSO module" title="Overview"
          lede={lede}
          right={<HeaderTag icon="home" label="OPENING READINESS"/>}
        />
      </div>

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading NSO queue...
        </div>
      )}

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {view && (
            <div>
              <button
                type="button"
                onClick={() => setView(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                <Icon name="arrow" size={12} style={{ transform: 'rotate(180deg)' }}/> All metrics
              </button>
            </div>
          )}

          {!view && (
            <>
              <div style={{ flexShrink: 0 }}>
                <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
                  {KPI_DEFS.map((kpi) => renderCard(kpi))}
                </div>
                <OverviewFilterBar
                  filters={NSO_STATUS_FILTERS.map(f => ({
                    ...f,
                    count: kpiCount(KPI_DEFS.find(k => k.key === f.key))
                  }))}
                  active={activeFilter}
                  onFilter={setActiveFilter}
                  search={search}
                  onSearch={setSearch}
                  totalCount={total}
                />
              </div>
              <QueueTable rows={filteredRows} limit={12} onOpen={openRow} style={{ flex: 1, minHeight: 0 }}/>
            </>
          )}

          {view && selectedKpi && (
            <>
              <div style={{ flexShrink: 0 }}>
                <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
                  {renderCard(selectedKpi, true)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                  <SearchBox value={search} onChange={setSearch} placeholder="Search code, site, city, CA code…"/>
                  {STAGE_DEFS.map((s) => (
                    <SubFilterPill
                      key={s.key}
                      label={s.label}
                      count={stageCounts[s.key]}
                      color={s.color}
                      active={stageFilter === s.key}
                      onClick={() => setStageFilter((f) => (f === s.key ? 'all' : s.key))}
                    />
                  ))}
                </div>
              </div>
              <QueueTable rows={filteredRows} onOpen={openRow} style={{ flex: 1, minHeight: 0 }}/>
            </>
          )}
        </>
      )}
    </div>
  );
}
