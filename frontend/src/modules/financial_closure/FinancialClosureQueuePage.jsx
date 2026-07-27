import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import ViewMoreButton from '../shared/primitives/ViewMoreButton.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getFCQueue } from '../../services/api/financialClosureApi.js';
import { projectFinancialClosureSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';
import { keyActivate } from '../../lib/a11y.js';
import { formatINR, formatVariation, variationTone } from '../../lib/budgetMetrics.js';
import { TABULAR } from '../business-admin/ui/kit.jsx';

// sites.financial_closure_status — the workflow stage. Drives the filter pills.
const STATUS_LABELS = {
  open: 'Open',
  allocated: 'Allocated',
  budgeting: 'Budgeting',
  closed: 'Closed',
};

// site_budgets.status — the closure budget row's own state. A DIFFERENT vocabulary,
// and the CLOSURE STATUS column reads this one. The column used to be looked up in
// STATUS_LABELS above, so every lookup missed and it fell through to the raw token
// ("pending_supervisor"). The two are meant to differ; they just shared one map.
const CLOSURE_BUDGET_LABELS = {
  draft: 'Draft',
  pending_supervisor: 'Supervisor',
  pending_admin: 'Admin',
  approved: 'Approved',
  rejected: 'Rejected',
};

const CLOSURE_BUDGET_TONES = {
  draft: 'var(--zm-fg-3)',
  pending_supervisor: 'var(--zm-warning)',
  pending_admin: 'var(--zm-warning)',
  approved: 'var(--zm-success)',
  rejected: 'var(--zm-danger)',
};

const STATUS_FILTERS = [
  { key: 'open',      label: 'Open',      color: 'var(--zm-warning)' },
  { key: 'allocated', label: 'Allocated', color: 'var(--zm-accent)' },
  { key: 'budgeting', label: 'Budgeting', color: 'var(--zm-copper)' },
  { key: 'closed',    label: 'Closed',    color: 'var(--zm-success)' },
];

// formatINR(null) is Rs0, not a dash — Number(null) is 0 and finite. On a financial
// screen "no data" must not read as "zero rupees", so guard before formatting.
// Matches FinancialClosureReviewPage, which already does exactly this.
const fmtMoney = (value) => (value == null ? '—' : formatINR(value));
const fmtVariation = (value) => (value == null ? '—' : formatVariation(value));

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
  // "View more" batch pager — `total` is the server COUNT(*) of the whole queue;
  // `items` are the rows loaded so far (client status filter operates over these).
  const { items, total, status, error, hasMore, loadingMore, loadMore, reload } =
    usePagedList(({ limit, offset }) => getFCQueue({ limit, offset }));
  const [statusFilter, setStatusFilter] = React.useState('all');

  useFocusSite();

  useSiteDataRefresh(reload, { sources: ['financial_closure', 'businessAdmin', 'project'] });

  const open = (row) => navigate(projectFinancialClosureSiteRoute(row.siteId));
  // 890px of tracks + 6 gaps x 12 + 32 padding = 994, which fits a 1280 viewport
  // beside the 232px sidebar. The old set totalled 1184 and overflowed anything
  // under ~1480. MIN_TABLE_W must be applied to the header AND the rows: the
  // header is a column-flex item inside the horizontal scroller, so without it it
  // stretches to the VISIBLE width, compresses its tracks below their minimums and
  // misaligns against rows that don't.
  const COLS = '110px minmax(180px, 1fr) 110px 120px 120px 120px 130px';
  const MIN_TABLE_W = 890 + 6 * 12 + 32;

  const statusCounts = STATUS_FILTERS.reduce((acc, f) => {
    acc[f.key] = items.filter((row) => row.financialClosureStatus === f.key).length;
    return acc;
  }, {});
  const visibleItems = statusFilter === 'all'
    ? items
    : items.filter((row) => row.financialClosureStatus === statusFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageHeader
          file="No. 11"
          eyebrow="Project module"
          title="Financial Closure"
          right={<HeaderTag icon="box" label="LAUNCHED"/>}
        />

        {status === 'loading' && (
          <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
            Loading financial closure queue...
          </div>
        )}

        {error && (
          <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{error}</div>
        )}

        {status === 'ready' && items.length > 0 && (
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
              {statusFilter !== 'all' && items.length > 0
                ? 'No sites match the current status filter.'
                : 'No launched sites are waiting for Financial Closure right now.'}
            </p>
          </div>
        )}
      </div>

      {status === 'ready' && visibleItems.length > 0 && (
        <div className="zm-glass" style={{
          // overflowX on the CARD, not the body: the header row is a sibling of the
          // scroller, so with the scroll on the body the header was clipped by
          // overflow:hidden and desynced from the columns on horizontal scroll.
          // Longhand after the shorthand => x:auto, y:hidden. Matches ProjectQueuePage.
          borderRadius: 12, overflow: 'hidden', overflowX: 'auto',
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 16px',
            minWidth: MIN_TABLE_W,
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Site</span>
            <span>City</span>
            <span>Closure status</span>
            <span style={{ textAlign: 'right' }}>Budget total</span>
            <span style={{ textAlign: 'right' }}>Closure total</span>
            <span style={{ textAlign: 'right' }}>Variation</span>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {visibleItems.map((row) => {
              // Was a local `const variationTone`, which shadowed the import of the
              // same name and made the shared helper unreachable.
              const varTone = row.variationTotal == null
                ? 'var(--zm-fg-3)'
                : variationTone(row.variationTotal);
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
                  display: 'grid', gridTemplateColumns: COLS, gap: 12, minWidth: MIN_TABLE_W,
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
                <StatusPill
                  value={CLOSURE_BUDGET_LABELS[row.closureStatus] || row.closureStatus}
                  tone={CLOSURE_BUDGET_TONES[row.closureStatus] || 'var(--zm-accent)'}
                />
                <span style={{ textAlign: 'right', fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)', ...TABULAR }}>
                  {fmtMoney(row.gfcBudgetTotal)}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)', ...TABULAR }}>
                  {fmtMoney(row.closureBudgetTotal)}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, fontWeight: 800, color: varTone, ...TABULAR }}>
                  {fmtVariation(row.variationTotal)}
                </span>
              </div>
            );
          })}
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
