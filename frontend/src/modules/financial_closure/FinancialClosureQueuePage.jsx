import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getFCQueue } from '../../services/api/financialClosureApi.js';
import { projectFinancialClosureSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';
import { keyActivate } from '../../lib/a11y.js';

const STATUS_LABELS = {
  open: 'Open',
  allocated: 'Allocated',
  budgeting: 'Budgeting',
  closed: 'Closed',
};

const STATUS_FILTERS = [
  { key: 'open',      label: 'Open',      color: 'var(--zm-warning)' },
  { key: 'allocated', label: 'Allocated', color: 'var(--zm-accent)' },
  { key: 'budgeting', label: 'Budgeting', color: 'var(--zm-copper)' },
  { key: 'closed',    label: 'Closed',    color: 'var(--zm-success)' },
];

const fmtMoney = (value) => (value == null ? '-' : Number(value).toLocaleString());

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

export default function FinancialClosureQueuePage() {
  const navigate = useNavigate();
  const { role } = useSession();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [statusFilter, setStatusFilter] = React.useState('all');

  useFocusSite();

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getFCQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
            error: err?.detail || err?.message || 'Failed to load financial closure queue',
          }));
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['financial_closure', 'businessAdmin', 'project'] });

  const open = (row) => navigate(projectFinancialClosureSiteRoute(row.siteId));
  const COLS = '120px minmax(220px, 1fr) 130px 150px 150px 150px 130px';

  const statusCounts = STATUS_FILTERS.reduce((acc, f) => {
    acc[f.key] = state.items.filter((row) => row.financialClosureStatus === f.key).length;
    return acc;
  }, {});
  const visibleItems = statusFilter === 'all'
    ? state.items
    : state.items.filter((row) => row.financialClosureStatus === statusFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 11"
        eyebrow="Project module"
        title="Financial Closure"
        right={<HeaderTag icon="box" label="LAUNCHED"/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading financial closure queue...
        </div>
      )}

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
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

      {state.status === 'ready' && visibleItems.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="box" size={20}/>
          <p style={{ margin: '12px 0 0' }}>
            {statusFilter !== 'all' && state.items.length > 0
              ? 'No sites match the current status filter.'
              : 'No launched sites are waiting for Financial Closure right now.'}
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
            <span>Closure status</span>
            <span style={{ textAlign: 'right' }}>GFC total</span>
            <span style={{ textAlign: 'right' }}>Closure total</span>
            <span style={{ textAlign: 'right' }}>Variation</span>
          </div>

          {visibleItems.map((row) => {
            const variation = row.variationTotal == null ? null : Number(row.variationTotal);
            const variationTone = variation == null || variation === 0
              ? 'var(--zm-fg-2)'
              : variation > 0 ? 'var(--zm-danger)' : 'var(--zm-success)';
            return (
              <div
                key={row.siteId}
                data-site-id={row.siteId}
                className="zm-row"
                role="button"
                tabIndex={0}
                onClick={() => open(row)}
                onKeyDown={keyActivate(() => open(row))}
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
                <StatusPill value={STATUS_LABELS[row.closureStatus] || row.closureStatus}/>
                <span style={{ textAlign: 'right', fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                  {fmtMoney(row.gfcBudgetTotal)}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                  {fmtMoney(row.closureBudgetTotal)}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, fontWeight: 800, color: variationTone }}>
                  {fmtMoney(row.variationTotal)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
