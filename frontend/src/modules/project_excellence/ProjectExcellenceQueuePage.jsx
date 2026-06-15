import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getPEQueue } from '../../services/api/projectExcellenceApi.js';
import { projectExcellenceSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';

const STATUS_LABELS = {
  pending: 'Awaiting allocation',
  allocated: 'Allocated',
  budgeting: 'Budgeting',
  approved: 'Approved',
  done: 'Done',
};

const STATUS_FILTERS = [
  { key: 'pending',   label: 'Pending',   color: 'var(--zm-warning)' },
  { key: 'allocated', label: 'Allocated', color: 'var(--zm-accent)' },
  { key: 'budgeting', label: 'Budgeting', color: 'var(--zm-copper)' },
  { key: 'approved',  label: 'Approved',  color: 'var(--zm-success)' },
];

// History tab shows the closed-out tail of the flow: budget approved or done.
const HISTORY_STATUSES = ['approved', 'done'];
const HISTORY_FILTERS = [
  { key: 'approved', label: 'Approved', color: 'var(--zm-success)' },
  { key: 'done',     label: 'Done',     color: 'var(--zm-info)' },
];

const BUDGET_LABELS = {
  draft: 'Draft',
  pending_supervisor: 'Supervisor review',
  pending_admin: 'Admin review',
  approved: 'Approved',
  rejected: 'Rejected',
};

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

export default function ProjectExcellenceQueuePage({ mode = 'pipeline' }) {
  const isHistory = mode === 'history';
  const filters = isHistory ? HISTORY_FILTERS : STATUS_FILTERS;
  const navigate = useNavigate();
  const { role } = useSession();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [statusFilter, setStatusFilter] = React.useState('all');

  useFocusSite();

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getPEQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
            error: err?.detail || err?.message || 'Failed to load project excellence queue',
          }));
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['project_excellence', 'businessAdmin', 'project'] });

  const open = (row) => navigate(projectExcellenceSiteRoute(row.siteId));
  const COLS = '120px minmax(220px, 1fr) 130px 160px 160px 120px';

  // History only lists the closed-out tail; Pipeline lists everything.
  const scopedItems = isHistory
    ? state.items.filter((row) => HISTORY_STATUSES.includes(row.excellenceStatus))
    : state.items;
  const statusCounts = filters.reduce((acc, f) => {
    acc[f.key] = scopedItems.filter((row) => row.excellenceStatus === f.key).length;
    return acc;
  }, {});
  const visibleItems = statusFilter === 'all'
    ? scopedItems
    : scopedItems.filter((row) => row.excellenceStatus === statusFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow="Project Excellence module"
        title={isHistory ? 'History' : 'Pipeline'}
        right={<HeaderTag icon="box" label={isHistory ? 'APPROVED · DONE' : 'DESIGN GFC-APPROVED'}/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading project excellence queue...
        </div>
      )}

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}

      {state.status === 'ready' && scopedItems.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {filters.filter((f) => statusCounts[f.key] > 0 || f.key === statusFilter).map((f) => (
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

      {state.status === 'ready' && visibleItems.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="box" size={20}/>
          <p style={{ margin: '12px 0 0' }}>
            {statusFilter !== 'all' && scopedItems.length > 0
              ? 'No sites match the current status filter.'
              : isHistory
                ? 'No project-excellence sites have been approved or completed yet.'
                : 'No design-GFC-approved sites are waiting for Project Excellence right now.'}
          </p>
        </div>
      )}

      {state.status === 'ready' && visibleItems.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
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
            <span>Budget</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          {visibleItems.map((row) => (
            <div
              key={row.siteId}
              data-site-id={row.siteId}
              className="zm-row"
              onClick={() => open(row)}
              style={{
                display: 'grid', gridTemplateColumns: COLS, gap: 12,
                padding: '14px 16px', borderBottom: '1px solid var(--zm-line-faint)',
                cursor: 'pointer', alignItems: 'center',
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
              <StatusPill value={STATUS_LABELS[row.excellenceStatus] || row.excellenceStatus}/>
              <StatusPill
                value={BUDGET_LABELS[row.budgetStatus] || row.budgetStatus}
                tone={row.budgetStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)'}
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open(row); }}
                style={{
                  justifySelf: 'end', height: 32, padding: '0 14px', border: 'none',
                  borderRadius: 7, background: 'var(--zm-accent)', color: '#fff',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                Open<Icon name="arrow" size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
