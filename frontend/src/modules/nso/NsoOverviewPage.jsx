import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import MetricCard from '../shared/primitives/MetricCard.jsx';
import SearchBox from '../shared/primitives/SearchBox.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
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

const COLS = '120px minmax(220px, 1fr) 130px 150px 160px';

function QueueTable({ rows, onOpen }) {
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
        <span>CA code</span>
        <span>NSO stage</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.siteId}
          className="zm-row"
          role="button"
          tabIndex={0}
          onClick={() => onOpen(row)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row); } }}
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
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg)' }}>{row.caCode || '—'}</span>
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
  );
}

export default function NsoOverviewPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [view, setView] = React.useState(null);       // null | KPI key
  const [stageFilter, setStageFilter] = React.useState('all'); // 'all' | stage key
  const [search, setSearch] = React.useState('');

  const load = React.useCallback(() => {
    let cancelled = false;
    // Keep loaded KPIs/list during background refreshes; failed refreshes
    // keep stale data + a banner instead of zeroing the cards.
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getNsoQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
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

  const selectedKpi = view ? KPI_DEFS.find((k) => k.key === view) : null;

  // Rows: an active stage pill filters the whole queue by that stage;
  // otherwise the table shows the selected KPI's scope. Search applies last.
  const filteredRows = React.useMemo(() => {
    const baseRows = stageFilter !== 'all'
      ? items.filter((row) => stageOf(row) === stageFilter)
      : (selectedKpi?.stages
        ? items.filter((row) => selectedKpi.stages.includes(stageOf(row)))
        : items);
    const needle = search.trim().toLowerCase();
    return baseRows
      .filter((row) => !needle || [row.siteCode, row.siteName, row.city, row.caCode]
        .filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [items, stageFilter, selectedKpi, search]);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10" eyebrow="NSO module" title="Overview"
        lede={lede}
        right={<HeaderTag icon="home" label="OPENING READINESS"/>}
      />

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
            <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              {KPI_DEFS.map((kpi) => renderCard(kpi))}
            </div>
          )}

          {view && selectedKpi && (
            <>
              <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                {renderCard(selectedKpi, true)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
              <QueueTable rows={filteredRows} onOpen={openRow}/>
            </>
          )}
        </>
      )}
    </div>
  );
}
