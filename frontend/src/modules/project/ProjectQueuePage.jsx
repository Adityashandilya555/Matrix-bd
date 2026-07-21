import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import ViewMoreButton from '../shared/primitives/ViewMoreButton.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getProjectQueue } from '../../services/api/projectApi.js';
import { projectSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';
import { keyActivate } from '../../lib/a11y.js';

const STATUS_LABELS = {
  pending: 'Awaiting allocation',
  allocated: 'Allocated',
  budgeting: 'Budgeting',
  in_progress: 'In execution',
  done: 'Done',
};

// Sub-filter chips honored via ?filter=<projectStatus> (deep links from the
// module overview) — keyed by projectStatus, mirrors the overview colors.
const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending', color: 'var(--zm-warning)' },
  { key: 'allocated', label: 'Allocated', color: 'var(--zm-accent)' },
  { key: 'budgeting', label: 'Budgeting', color: 'var(--zm-copper)' },
  { key: 'in_progress', label: 'In execution', color: 'var(--zm-info)' },
  { key: 'done', label: 'Done', color: 'var(--zm-success)' },
];

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

export default function ProjectQueuePage({ mode = 'pipeline' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  // "View more" batch pager — `total` is the server COUNT(*) of the whole queue;
  // `items` are the rows loaded so far (client mode/status filters operate over
  // these accumulated rows).
  const { items, total, status, error, hasMore, loadingMore, loadMore, reload } =
    usePagedList(({ limit, offset }) => getProjectQueue({ limit, offset }));

  // ?filter=<projectStatus> deep link (HashRouter — read location.search via
  // react-router, never window.location.search).
  const filterParam = new URLSearchParams(location.search).get('filter');
  const [statusFilter, setStatusFilter] = React.useState(
    STATUS_FILTERS.some((f) => f.key === filterParam) ? filterParam : 'all',
  );
  // Re-sync when the param changes; reset when it goes away or when the same
  // mounted component flips between Pipeline and Sites (router reuses it).
  React.useEffect(() => {
    setStatusFilter(STATUS_FILTERS.some((f) => f.key === filterParam) ? filterParam : 'all');
  }, [filterParam, mode]);

  useFocusSite(); // scroll/flash a row reached via ?focus=<siteId>

  useSiteDataRefresh(reload, { sources: ['project', 'businessAdmin', 'design', 'siteTrackerApi'] });

  const open = (row) => navigate(projectSiteRoute(row.siteId));
  const COLS = '120px minmax(220px, 1fr) 130px 160px 160px 120px';

  // A site moves from Pipeline to Sites once the executive has uploaded the
  // quality-audit doc + inspection date (quality_audit_status leaves 'pending').
  const inSites = (row) => !!row.qualityAuditStatus && row.qualityAuditStatus !== 'pending';
  const modeItems = items.filter((row) => (mode === 'sites' ? inSites(row) : !inSites(row)));
  const statusCounts = STATUS_FILTERS.reduce((acc, f) => {
    acc[f.key] = modeItems.filter((row) => row.projectStatus === f.key).length;
    return acc;
  }, {});
  const visibleItems = statusFilter === 'all'
    ? modeItems
    : modeItems.filter((row) => row.projectStatus === statusFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageHeader
        file="No. 09"
        eyebrow="Project module"
        title={mode === 'sites' ? 'Sites' : 'Pipeline'}
        right={<HeaderTag icon="box" label={mode === 'sites' ? 'QUALITY AUDIT' : 'DESIGN APPROVED'}/>}
      />

      {status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading project queue...
        </div>
      )}

      {error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {error}
        </div>
      )}

      {status === 'ready' && modeItems.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.filter((f) => statusCounts[f.key] > 0 || f.key === statusFilter).map((f) => (
            <SubFilterPill
              key={f.key}
              label={f.label}
              count={statusCounts[f.key]}
              color={f.color}
              active={statusFilter === f.key}
              onClick={() => setStatusFilter((s) => (s === f.key ? 'all' : f.key))}
            />
          ))}
        </div>
      )}

      {status === 'ready' && visibleItems.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="box" size={20}/>
          <p style={{ margin: '12px 0 0' }}>
            {statusFilter !== 'all' && modeItems.length > 0
              ? 'No sites match the current status filter.'
              : mode === 'sites'
                ? 'No sites have reached the quality-audit stage yet.'
                : 'No design-approved sites are waiting for Project right now.'}
          </p>
        </div>
      )}

      </div>

      {status === 'ready' && visibleItems.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden', overflowX: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
            <span style={{ textAlign: 'right', paddingRight: 16 }}>Action</span>
          </div>

          <div style={{ overflowY: 'auto' }}>
            {visibleItems.map((row) => (
              <div
                key={row.siteId}
                data-site-id={row.siteId}
              className="zm-row"
              role="button"
              tabIndex={0}
              onClick={() => open(row)}
              onKeyDown={keyActivate(() => open(row))}
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
                {row.allocatedToName && (
                  <span style={{ display: 'block', marginTop: 3, color: 'var(--zm-fg-3)', fontWeight: 600, fontSize: 12 }}>
                    Allocated to {row.allocatedToName}
                  </span>
                )}
              </span>
              <span style={{ color: 'var(--zm-fg-2)' }}>{row.city}</span>
              <StatusPill value={STATUS_LABELS[row.projectStatus] || row.projectStatus}/>
              <StatusPill value={row.budgetStatus === 'approved' ? 'Available' : 'Pending'} tone={row.budgetStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)'}/>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open(row); }}
                style={{
                  justifySelf: 'end', marginRight: 16,
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
          </div>
        </div>
      )}

      {/* Pager loads more of the whole queue; counts are over all loaded rows
          (Pipeline + Sites), since the mode split is applied client-side. */}
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
