import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import StateKpiTile from '../shared/primitives/StateKpiTile.jsx';
import ViewMoreButton from '../shared/primitives/ViewMoreButton.jsx';
import { getNsoQueue } from '../../services/api/nsoApi.js';
import { nsoSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';

const STATUS_LABELS = {
  pending: 'Pending',
  stage_one: 'Property',
  stage_two: 'Licenses',
  stage_three: 'Launch',
  final_review: 'Final review',
  final: 'Final review',
  complete: 'Complete',
  done: 'Complete',
};

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

function pretty(value) {
  if (value == null || value === '') return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

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
      {pretty(value)}
    </span>
  );
}

// Tile filter groups: each KPI tile scopes the queue to a set of stages.
const TILE_STAGES = {
  property: ['pending', 'stage_one'],
  licenses: ['stage_two', 'stage_three', 'final_review'],
  complete: ['complete'],
};

// Map a `?filter=<stage>` query value to the tile that covers that stage.
// Accepts the backend aliases (final/done) as well as the canonical keys.
const STAGE_TO_TILE = {
  ...Object.fromEntries(
    Object.entries(TILE_STAGES).flatMap(([tile, stages]) => stages.map((s) => [s, tile])),
  ),
  final: 'licenses',
  done: 'complete',
};

export default function NsoQueuePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // "View more" batch pager — `total` is the server COUNT(*) of the whole NSO
  // queue (drives the headline "In NSO" tile); `items` are the rows loaded so
  // far. Per-stage tiles count over the loaded rows.
  const { items, total, status, error, hasMore, loadingMore, loadMore, reload } =
    usePagedList(({ limit, offset }) => getNsoQueue({ limit, offset }));
  // 'all' | 'property' | 'licenses' | 'complete' — KPI tile filter.
  const [filter, setFilter] = React.useState('all');
  const focusId = useFocusSite();

  // HashRouter: query params live in the hash — always read via useLocation.
  const filterParam = new URLSearchParams(location.search).get('filter');
  React.useEffect(() => {
    if (!filterParam) return;
    const tile = STAGE_TO_TILE[filterParam];
    if (tile) setFilter(tile);
  }, [filterParam]);

  useSiteDataRefresh(reload, { sources: ['nso', 'project', 'businessAdmin', 'payment', 'legalApi', 'siteTrackerApi', 'launch'] });

  // useFocusSite polls only ~6s after mount; the queue endpoint can be slower
  // than that. Once rows are actually in the DOM, re-run the scroll + flash so
  // a ?focus= deep link still lands on its row (once per focus id, so
  // background data refreshes don't keep yanking the scroll position).
  const focusedRef = React.useRef(null);
  React.useEffect(() => {
    if (!focusId || status !== 'ready' || focusedRef.current === focusId) return undefined;
    const t = setTimeout(() => {
      const esc = window.CSS?.escape ? window.CSS.escape(focusId) : focusId.replace(/"/g, '\\"');
      const el = document.querySelector(`[data-site-id="${esc}"]`);
      if (!el) return;
      focusedRef.current = focusId;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('zm-focus-target');
      setTimeout(() => el.classList.remove('zm-focus-target'), 2600);
    }, 150);
    return () => clearTimeout(t);
  }, [focusId, status]);

  const open = (row) => navigate(nsoSiteRoute(row.siteId));
  // Derive tile counts once per items change rather than re-filtering the whole
  // queue three times on every render (#233). Logic is byte-identical to the
  // old `countFor(tile)` — same TILE_STAGES + stageOf filter. These count over
  // the LOADED rows (per-stage sub-tiles), while "In NSO" uses the server total.
  const counts = React.useMemo(() => {
    const out = {};
    for (const tile of Object.keys(TILE_STAGES)) {
      out[tile] = items.filter((item) => TILE_STAGES[tile].includes(stageOf(item))).length;
    }
    return out;
  }, [items]);
  const countFor = (tile) => counts[tile];
  const toggleTile = (tile) => setFilter((f) => (f === tile ? 'all' : tile));
  // Memoized so the filtered list isn't recomputed on unrelated re-renders.
  const visibleItems = React.useMemo(() => (
    filter === 'all'
      ? items
      : items.filter((item) => TILE_STAGES[filter].includes(stageOf(item)))
  ), [items, filter]);
  const COLS = '120px minmax(220px, 1fr) 130px 150px 160px 110px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageHeader
        file="No. 10"
        eyebrow="NSO module"
        title="Sites"
        lede="Finance-approved openings move through property readiness, licenses, launch checks, and final sign-off."
        right={<HeaderTag icon="home" label="OPENING READINESS"/>}
      />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StateKpiTile label="In NSO" value={total} sub="Finance / CA ready" color="var(--zm-accent)" active={filter === 'all'} onClick={() => setFilter('all')}/>
        <StateKpiTile label="Property" value={countFor('property')} sub="Stage 1 open" color="var(--zm-info)" active={filter === 'property'} onClick={() => toggleTile('property')}/>
        <StateKpiTile label="Licenses / launch" value={countFor('licenses')} sub="Active downstream checks" color="var(--zm-copper)" active={filter === 'licenses'} onClick={() => toggleTile('licenses')}/>
        <StateKpiTile label="Completed" value={countFor('complete')} sub="Final sign-off done" color="var(--zm-success)" active={filter === 'complete'} onClick={() => toggleTile('complete')}/>
      </div>

      {status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading NSO queue...
        </div>
      )}

      {error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {error}
        </div>
      )}

      {status === 'ready' && items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="home" size={22}/>
          <p style={{ margin: '12px 0 0' }}>
            No Finance / CA approved sites have reached NSO yet.
          </p>
        </div>
      )}

      </div>

      {items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
            <span>Project</span>
            <span>NSO stage</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          <div style={{ overflowY: 'auto' }}>
            {visibleItems.map((row) => (
              <div
                key={row.siteId}
                data-site-id={row.siteId}
              role="button"
              tabIndex={0}
              onClick={() => open(row)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(row); } }}
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
                <span style={{ display: 'block', marginTop: 3, color: 'var(--zm-fg-3)', fontWeight: 600, fontSize: 12 }}>
                  {row.nextAction}
                </span>
              </span>
              <span style={{ color: 'var(--zm-fg-2)' }}>{row.city}</span>
              <StatusPill value={row.projectStatus} tone={row.projectStatus === 'done' ? 'var(--zm-success)' : 'var(--zm-copper)'}/>
              <StatusPill value={STATUS_LABELS[row.currentStage] || row.currentStage} tone={row.nsoStatus === 'complete' ? 'var(--zm-success)' : 'var(--zm-accent)'}/>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open(row); }}
                style={{
                  justifySelf: 'end',
                  height: 32,
                  padding: '0 14px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'var(--zm-accent)',
                  color: '#fff',
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Open<Icon name="arrow" size={12}/>
                </button>
              </div>
            ))}
            {visibleItems.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
                No NSO sites match this filter.
              </div>
            )}
          </div>
        </div>
      )}

      {status === 'ready' && (
        <ViewMoreButton
          hasMore={hasMore}
          loadingMore={loadingMore}
          loaded={items.length}
          total={total}
          onClick={loadMore}
        />
      )}
    </div>
  );
}
