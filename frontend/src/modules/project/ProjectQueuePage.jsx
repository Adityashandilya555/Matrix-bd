import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getProjectQueue } from '../../services/api/projectApi.js';
import { projectSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

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

export default function ProjectQueuePage() {
  const navigate = useNavigate();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    getProjectQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load project queue' });
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['project', 'businessAdmin', 'design'] });

  const open = (row) => navigate(projectSiteRoute(row.siteId));
  const COLS = '120px minmax(220px, 1fr) 130px 160px 160px 120px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 09"
        eyebrow="Project module"
        title="Sites"
        right={<HeaderTag icon="box" label="DESIGN APPROVED"/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading project queue...
        </div>
      )}

      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="box" size={20}/>
          <p style={{ margin: '12px 0 0' }}>
            No design-approved sites are waiting for Project right now.
          </p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
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
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          {state.items.map((row) => (
            <div
              key={row.siteId}
              onClick={() => open(row)}
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
              <StatusPill value={BUDGET_LABELS[row.budgetStatus] || row.budgetStatus} tone={row.budgetStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)'}/>
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
        </div>
      )}
    </div>
  );
}
