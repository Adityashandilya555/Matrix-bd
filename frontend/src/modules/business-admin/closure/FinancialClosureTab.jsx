// skipcq: JS-0833
// FinancialClosureTab — every site in financial closure, for the business admin.
//
// Backed by GET /financial-closure/queue, which lists every site whose closure
// has been opened. NOT admin-queue: despite the name, that is the admin's ACTION
// queue — it filters to budgets with status 'pending_admin', so it never returns
// a closed site and the Closed view would always be empty.
//
// /queue narrows by allocation only for an EXECUTIVE, so an admin gets the whole
// tenant unscoped. Detail still reads admin-detail, which has no status filter
// and is already the admin's own endpoint.
//
// Status vocabularies and the pending-with rule are shared with the BD tab via
// ../../financial_closure/closureStatus.js.
//
// Read-only. Acting on a closure still happens in the Financial Closure module.
import React from 'react';
import {
  T, Icon, Card, SectionHeader, EmptyState, ErrorState, Skeleton, TABULAR,
} from '../ui/kit.jsx';
import { usePagedList } from '../../../hooks/usePagedList.js';
import ViewMoreButton from '../../shared/primitives/ViewMoreButton.jsx';
import {
  CLOSURE_BUDGET_LABELS, CLOSURE_BUDGET_TONES, PENDING_STATUSES, isClosed, pendingWith,
} from '../../financial_closure/closureStatus.js';
import { getFCQueue, getFCAdminDetail } from '../../../services/api/financialClosureApi.js';
import ClosureDetailsDrawer from '../../launch/ClosureDetailsDrawer.jsx';
import { displayCode } from '../../../lib/displayCode.js';

const COLS = '0.8fr 1.5fr 0.9fr 1.3fr 0.9fr 0.6fr';

export default function FinancialClosureTab() {
  const {
    items, total, status, error, hasMore, loadingMore, loadMore, reload,
  } = usePagedList(({ limit, offset }) => getFCQueue({ limit, offset }));

  const [filter, setFilter] = React.useState('pending'); // 'pending' | 'closed'
  const [query, setQuery] = React.useState('');
  const [detailSiteId, setDetailSiteId] = React.useState(null);

  const needle = query.trim().toLowerCase();
  const matches = (row) => {
    if (!needle) return true;
    return `${row.siteCode || ''} ${row.siteName || ''} ${row.city || ''} ${pendingWith(row)}`
      .toLowerCase().includes(needle);
  };

  const pending = items.filter((r) => PENDING_STATUSES.includes(r.financialClosureStatus));
  const closed = items.filter(isClosed);
  const rows = (filter === 'closed' ? closed : pending).filter(matches);

  return (
    <div>
      <SectionHeader
        icon={Icon.rupee}
        title="Financial Closure"
        description="Sites in closure across the workspace, and who owes the next action."
        count={pending.length}
        tone={pending.length > 0 ? 'warn' : 'success'}
        onRefresh={() => reload(true)}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18, marginTop: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textFaint }}>
            <Icon.search size={16} />
          </span>
          <input className="ac-input" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, code, city, or pending with"
            aria-label="Search by name, code, city, or pending with"
            style={{ width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px 0 36px', borderRadius: T.radiusSm,
              border: `1px solid ${T.lineStrong}`, background: T.surfaceInset, color: T.text, fontSize: 13, outline: 'none' }} />
        </div>
        {[
          { key: 'pending', label: 'Pending', count: pending.length },
          { key: 'closed', label: 'Closed', count: closed.length },
        ].map(({ key, label, count }) => {
          const active = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)} aria-pressed={active}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 12px',
                borderRadius: 8, border: `1px solid ${active ? T.accent : T.line}`,
                background: active ? `${T.accent}1F` : T.surface,
                color: active ? T.accent : T.textMuted,
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {label}
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, fontFeatureSettings: "'tnum' 1",
                background: active ? `${T.accent}33` : T.chip, color: active ? T.accent : T.textFaint,
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '9px 18px', borderBottom: `1px solid ${T.line}`, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textFaint }}>
          <span>Code</span><span>Site</span><span>City</span><span>Pending With</span><span>Closure Status</span><span />
        </div>

        {status === 'loading' && (
          <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} h={40} />)}
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: 24 }}><ErrorState message={error} onRetry={() => reload(false)} /></div>
        )}

        {status === 'ready' && rows.length === 0 && (
          <div style={{ padding: '36px 24px' }}>
            <EmptyState icon={Icon.rupee} title="Nothing to show"
              hint={needle
                ? 'No closures match your search.'
                : filter === 'closed' ? 'No sites have completed closure yet.' : 'No sites are in financial closure.'} />
          </div>
        )}

        {status === 'ready' && rows.map((row) => (
          <div key={row.siteId} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '13px 18px', borderBottom: `1px solid ${T.line}`, alignItems: 'center' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: T.textMuted }}>{displayCode(row)}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{row.siteName}</span>
            <span style={{ fontSize: 13, color: T.textMuted }}>{row.city}</span>
            <span style={{ fontSize: 12.5, color: T.textMuted }}>{pendingWith(row)}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: CLOSURE_BUDGET_TONES[row.closureStatus] || T.accent, ...TABULAR }}>
              {CLOSURE_BUDGET_LABELS[row.closureStatus] || row.closureStatus || '—'}
            </span>
            <span>
              <button onClick={() => setDetailSiteId(row.siteId)}
                aria-label={`Details for ${row.siteName}`}
                style={{ height: 28, padding: '0 12px', borderRadius: 7, border: `1px solid ${T.line}`, background: T.chip, color: T.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Details
              </button>
            </span>
          </div>
        ))}

        {status === 'ready' && (
          <ViewMoreButton
            hasMore={hasMore}
            loadingMore={loadingMore}
            loaded={items.length}
            total={total}
            onClick={loadMore}
          />
        )}
      </Card>

      {detailSiteId && (
        <ClosureDetailsDrawer
          siteId={detailSiteId}
          fetchDetail={getFCAdminDetail}
          onClose={() => setDetailSiteId(null)}
        />
      )}
    </div>
  );
}
