import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import ViewMoreButton from '../shared/primitives/ViewMoreButton.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getDesignQueue } from '../../services/api/designApi.js';
import { designSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';
import { keyActivate } from '../../lib/a11y.js';

const STATUS_LABELS = {
  pending:     { label: 'Awaiting allocation', tone: 'var(--zm-fg-3)' },
  allocated:   { label: 'Allocated',           tone: 'var(--zm-info)' },
  in_progress: { label: 'In progress',         tone: 'var(--zm-accent)' },
  gfc_pending: { label: 'Awaiting GFC',        tone: 'var(--zm-copper)' },
  approved:    { label: 'Design approved',     tone: 'var(--zm-success)' },
  rejected:    { label: 'Rejected',            tone: 'var(--zm-danger)' },
};

// Stage-based filter chips shown above the queue table.
// Each chip maps to a `currentStage` value returned by the backend.
const STAGE_FILTERS = [
  { id: 'all',  label: 'All' },
  { id: 'recce', label: 'Recce' },
  { id: '2d',    label: '2D Approved' },  // site is at/past 2d stage
  { id: '3d',    label: '3D Approved' },  // site is at/past 3d stage
  { id: 'gfc',   label: 'GFC Approved' },
];

// Stage ordering so "2D Approved" shows sites where 2d is done (stage ≥ 3d)
const STAGE_ORDER = ['recce', '2d', '3d', 'boq', 'gfc', 'done'];
function stageIndex(s) { return STAGE_ORDER.indexOf(s); }

function matchesStageFilter(row, filterId) {
  if (filterId === 'all') return true;
  const idx = stageIndex(row.currentStage);
  const filterIdx = stageIndex(filterId);
  if (filterId === 'recce') return row.currentStage === 'recce';
  // "2D Approved" means stage has advanced past 2d (currently at 3d or later)
  return idx > filterIdx;
}

const STAGE_LABELS = {
  recce: 'Recce', '2d': '2D', '3d': '3D', boq: 'BOQ', gfc: 'GFC', done: 'Done',
};

function StatusPill({ value }) {
  const meta = STATUS_LABELS[value] || { label: value || 'unknown', tone: 'var(--zm-fg-3)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${meta.tone}`, color: meta.tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }}>
      {meta.label}
    </span>
  );
}

const VALID_STAGE_PARAMS = ['recce', '2d', '3d', 'boq', 'gfc'];

export default function DesignQueuePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  // "View more" batch pager — `total` is the server COUNT(*) of the whole queue;
  // `items` are the rows loaded so far (client filters operate over these).
  const { items, total, status, error, hasMore, loadingMore, loadMore, reload } =
    usePagedList(({ limit, offset }) => getDesignQueue({ limit, offset }));
  // Deep links from the overview page: ?stage= preselects a stage chip,
  // ?filter= narrows by designStatus, ?focus= scrolls to a specific row.
  const params = new URLSearchParams(location.search);
  const stageParam = params.get('stage');
  const statusParam = params.get('filter');
  const [stageFilter, setStageFilter] = React.useState(
    () => (VALID_STAGE_PARAMS.includes(stageParam) ? stageParam : 'all'),
  );
  // Re-apply when the ?stage= param changes while the page is already mounted
  // (e.g. an in-place navigate from another tab's deep link).
  React.useEffect(() => {
    if (VALID_STAGE_PARAMS.includes(stageParam)) setStageFilter(stageParam);
  }, [stageParam]);
  const statusFilter = React.useMemo(() => {
    if (!statusParam) return null;
    const wanted = statusParam.split(',').filter((s) => STATUS_LABELS[s]);
    return wanted.length ? wanted : null;
  }, [statusParam]);
  useFocusSite();

  useSiteDataRefresh(reload, { sources: ['design', 'businessAdmin', 'siteTrackerApi', 'legalApi'] });

  const open = (row) => navigate(designSiteRoute(row.siteId));

  const visibleItems = statusFilter
    ? items.filter((r) => statusFilter.includes(r.designStatus))
    : items;

  const COLS = '120px minmax(200px, 1fr) 120px 170px 110px 120px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageHeader
          file="No. 06"
          eyebrow="Design module"
          title="Sites"
          right={<HeaderTag icon="box" label="FINANCE APPROVED"/>}
        />

        {status === 'loading' && (
          <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
            Loading queue…
          </div>
        )}

        {error && (
          <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
            {error}
          </div>
        )}

        {status === 'ready' && items.length === 0 && (
          <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
            <Icon name="box" size={20}/>
            <p style={{ margin: '12px 0 0' }}>
              {isSupervisor
                ? 'No finance-approved sites are waiting for design right now. Waiting for Finance admin approval.'
                : 'No sites have been allocated to you yet. Design opens after Finance admin approval.'}
            </p>
          </div>
        )}

        {status === 'ready' && items.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {/* Stage filter chips */}
            {STAGE_FILTERS.map((f) => {
              const active = stageFilter === f.id;
              const count = f.id === 'all'
                ? visibleItems.length
                : visibleItems.filter((r) => matchesStageFilter(r, f.id)).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStageFilter(f.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 30, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
                    background: active ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
                    color: active ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
                    fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
                  }}
                >
                  {f.label}
                  <span style={{
                    fontFamily: 'var(--zm-font-mono)', fontSize: 10.5,
                    color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
                  }}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {status === 'ready' && items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
            <span>Design status</span>
            <span>Stage</span>
            <span style={{ textAlign: 'right', paddingRight: 16 }}>Action</span>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {visibleItems.filter((r) => matchesStageFilter(r, stageFilter)).map((row) => (
              <div
                key={row.siteId}
              data-site-id={row.siteId}
              role="button"
              tabIndex={0}
              onClick={() => open(row)}
              onKeyDown={keyActivate(() => open(row))}
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{row.siteName}</span>
                  {isSupervisor && row.allocatedToName && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 8px',
                      borderRadius: 4, border: '1px solid var(--zm-accent)', color: 'var(--zm-accent)',
                      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
                      letterSpacing: '0.12em', textTransform: 'uppercase',
                    }}>
                      {row.allocatedToName}
                    </span>
                  )}
                </span>
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                {row.city}
              </span>
              <span><StatusPill value={row.designStatus}/></span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                {STAGE_LABELS[row.currentStage] || '—'}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open(row); }}
                style={{
                  justifySelf: 'end', marginRight: 16, height: 32, padding: '0 14px',
                  border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                Open<Icon name="arrow-right" size={12}/>
              </button>
            </div>
          ))}
        </div>
        </div>
      )}

      {status === 'ready' && (
        <div style={{ flexShrink: 0 }}>
          <ViewMoreButton
            hasMore={hasMore}
            loadingMore={loadingMore}
            loaded={items.length}
            total={total}
            onClick={loadMore}
          />
        </div>
      )}
    </div>
  );
}
