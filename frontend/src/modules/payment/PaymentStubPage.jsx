import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { listSites } from '../../services/api/siteService.js';
import { siteTrackerDetailRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// Payments membership = sites pushed from "Sites in process". The push moves
// site.status to legal_review, and Legal + Finance then run in parallel — so a
// freshly pushed site MUST show here immediately (under "Pending") even though
// Legal has not cleared it yet.
const PAYMENT_STATUSES = [
  'legal_review',
  'legal_approved',
  'pushed_to_payments',
];

const FINANCE_LABELS = {
  pending: 'Not started',
  awaiting_supervisor: 'Awaiting supervisor',
  awaiting_admin: 'Awaiting admin',
  approved: 'Approved',
};

// Three states the BD team thinks in:
//   pending  — pushed from Sites in process, Finance/CA not concluded yet
//   awaiting — details pushed, approval pending (supervisor → business admin)
//   approved — Finance approved
function paymentState(site) {
  const financeStatus = site.financeStatus || 'pending';
  if (financeStatus === 'approved') return 'approved';
  if (financeStatus === 'awaiting_supervisor' || financeStatus === 'awaiting_admin') return 'awaiting';
  return 'pending';
}

function stateTone(state) {
  if (state === 'approved') {
    return {
      label: 'Approved',
      bg: 'var(--zm-success-soft, #E7F2E9)',
      border: 'var(--zm-success, #2F7A4A)',
      fg: 'var(--zm-success, #2F7A4A)',
      icon: 'check',
    };
  }
  if (state === 'awaiting') {
    return {
      label: 'Awaiting approval',
      bg: 'var(--zm-warning-soft, #F8EEDC)',
      border: 'var(--zm-warning, #B0712E)',
      fg: 'var(--zm-warning, #B0712E)',
      icon: 'clock',
    };
  }
  return {
    label: 'Pending',
    bg: 'var(--zm-accent-soft, #E7F0EA)',
    border: 'var(--zm-accent, #0E5B45)',
    fg: 'var(--zm-accent, #0E5B45)',
    icon: 'paymentCard',
  };
}

function formatAmount(value) {
  if (value == null || value === '') return 'Not set';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function unlockCopy(site) {
  if (site.financeStatus === 'approved') return 'Finance approved and ready for final handoff.';
  if (site.financeStatus === 'awaiting_admin') return 'Supervisor approved. Business-admin approval is pending.';
  if (site.financeStatus === 'awaiting_supervisor') return 'Details pushed. Supervisor approval is pending.';
  return 'Pushed from Sites in process. Finance / CA runs in parallel with Legal — prepare the CA code and amount.';
}

function Metric({ icon, label, value, tone = 'accent', active = false, onClick }) {
  const color =
    tone === 'success' ? 'var(--zm-success, #2F7A4A)' :
    tone === 'warning' ? 'var(--zm-warning, #B0712E)' :
    tone === 'muted' ? 'var(--zm-fg-3)' :
    'var(--zm-accent, #0E5B45)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'color-mix(in srgb, currentColor 0%, var(--zm-surface))' : 'var(--zm-surface)',
        border: active ? `2px solid ${color}` : '1px solid var(--zm-line)',
        borderRadius: 12,
        padding: active ? '13px 15px' : '14px 16px',
        boxShadow: active ? 'var(--zm-shadow-2)' : 'var(--zm-shadow-1)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minWidth: 0,
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'border 120ms var(--zm-ease), box-shadow 120ms var(--zm-ease)',
      }}
    >
      <span style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        background: tone === 'muted' ? 'var(--zm-surface-2)' : 'color-mix(in srgb, currentColor 12%, white)',
        border: `1px solid ${color}`,
        flex: '0 0 auto',
      }}>
        <Icon name={icon} size={16}/>
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--zm-font-mono)',
          fontSize: 24,
          lineHeight: 1,
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--zm-fg)',
        }}>
          {String(value).padStart(2, '0')}
        </div>
        <div style={{
          marginTop: 4,
          fontFamily: 'var(--zm-font-body)',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: active ? color : 'var(--zm-fg-3)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {label}
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ state }) {
  const tone = stateTone(state);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 26,
      padding: '0 10px',
      borderRadius: 999,
      border: `1px solid ${tone.border}`,
      background: tone.bg,
      color: tone.fg,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      <Icon name={tone.icon} size={12}/>
      {tone.label}
    </span>
  );
}

function PaymentRow({ site, onOpen }) {
  const state = paymentState(site);
  const tone = stateTone(state);
  return (
    <article data-site-id={site.siteId} style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(160px, 0.8fr) minmax(220px, 1fr) 132px',
      gap: 14,
      alignItems: 'center',
      padding: '16px 18px',
      borderBottom: '1px solid var(--zm-line-faint)',
      background: state === 'pending' ? 'var(--zm-accent-soft, #E7F0EA)' : 'transparent',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--zm-font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--zm-fg-3)',
        }}>
          {site.siteCode || site.siteId}
        </div>
        <div style={{
          marginTop: 4,
          fontFamily: 'var(--zm-font-body)',
          fontSize: 15,
          fontWeight: 800,
          color: 'var(--zm-fg)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {site.siteName}
        </div>
        <div style={{
          marginTop: 3,
          fontFamily: 'var(--zm-font-body)',
          fontSize: 12.5,
          color: 'var(--zm-fg-2)',
        }}>
          {site.city || 'City not set'}
        </div>
      </div>

      <div>
        <StatusBadge state={state}/>
        <div style={{
          marginTop: 7,
          fontFamily: 'var(--zm-font-body)',
          fontSize: 12,
          color: tone.fg,
          fontWeight: 700,
        }}>
          {FINANCE_LABELS[site.financeStatus || 'pending'] || site.financeStatus}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          marginBottom: 8,
        }}>
          <MiniField label="KYC" value={site.kycVerified ? 'Verified' : 'Open'}/>
          <MiniField label="CA code" value={site.caCode || 'Unset'}/>
          <MiniField label="Amount" value={formatAmount(site.financeAmount)}/>
        </div>
        <div style={{
          fontFamily: 'var(--zm-font-body)',
          fontSize: 12.5,
          lineHeight: 1.4,
          color: 'var(--zm-fg-2)',
        }}>
          {unlockCopy(site)}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpen(site)}
        style={{
          height: 34,
          padding: '0 12px',
          borderRadius: 8,
          border: 'none',
          background: 'var(--zm-accent)',
          color: 'var(--zm-accent-on, #fff)',
          fontFamily: 'var(--zm-font-body)',
          fontSize: 12,
          fontWeight: 800,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        Open CA panel
        <Icon name="arrow" size={12}/>
      </button>
    </article>
  );
}

function MiniField({ label, value }) {
  return (
    <div style={{
      minWidth: 0,
      padding: '7px 8px',
      border: '1px solid var(--zm-line-faint)',
      borderRadius: 8,
      background: 'rgba(255,255,255,0.54)',
    }}>
      <div style={{
        fontFamily: 'var(--zm-font-body)',
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--zm-fg-4)',
      }}>
        {label}
      </div>
      <div style={{
        marginTop: 3,
        fontFamily: label === 'CA code' ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
        fontSize: 11.5,
        fontWeight: 700,
        color: 'var(--zm-fg)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
    </div>
  );
}

// Rows come straight off GET /sites — the finance/CA mirror columns now ride
// on the list response, so there is no per-site tracker fan-out and a pushed
// site can never silently vanish from this list (the old bug where "push from
// Sites in process" looked like a no-op).
function rowFromSite(site) {
  return {
    siteId: site.id,
    siteCode: site.code || '',
    siteName: site.name,
    city: site.city,
    siteStatus: site.status,
    financeStatus: site.financeStatus || 'pending',
    kycVerified: site.kycVerified ?? false,
    caCode: site.caCode ?? null,
    financeAmount: site.financeAmount ?? null,
  };
}

const FILTERS = ['all', 'pending', 'awaiting', 'approved'];

export default function PaymentStubPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialFilter = (() => {
    const f = new URLSearchParams(location.search).get('filter');
    return FILTERS.includes(f) ? f : 'all';
  })();
  const [filter, setFilter] = React.useState(initialFilter);
  const [q, setQ] = React.useState('');
  const [state, setState] = React.useState({ status: 'loading', rows: [], error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: s.rows.length ? 'ready' : 'loading', error: null }));
    // One request: the backend accepts a comma-separated status list and the
    // list response carries the finance mirror columns.
    listSites({ status: PAYMENT_STATUSES })
      .then((sites) => {
        if (cancelled) return;
        const seen = new Set();
        const cleanRows = (sites || [])
          .filter((site) => {
            if (!site?.id || seen.has(site.id)) return false;
            seen.add(site.id);
            return true;
          })
          .map(rowFromSite)
          .sort((a, b) => {
            const rank = { pending: 0, awaiting: 1, approved: 2 };
            return (rank[paymentState(a)] ?? 9) - (rank[paymentState(b)] ?? 9);
          });
        setState({ status: 'ready', rows: cleanRows, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'error',
          rows: [],
          error: err?.detail || err?.message || 'Failed to load payment readiness',
        });
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load);

  const rows = state.rows;
  const counts = rows.reduce((acc, site) => {
    const key = paymentState(site);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { pending: 0, awaiting: 0, approved: 0 });

  const needle = q.trim().toLowerCase();
  const visible = rows.filter((site) => {
    if (filter !== 'all' && paymentState(site) !== filter) return false;
    if (!needle) return true;
    const hay = `${site.siteCode || ''} ${site.siteName || ''} ${site.city || ''}`.toLowerCase();
    return hay.includes(needle);
  });

  const openPayment = (site) => {
    navigate(`${siteTrackerDetailRoute(site.siteId)}?node=ca`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 09"
        eyebrow="BD module"
        title="Payment"
        right={<HeaderTag icon="paymentCard" label={`${counts.pending + counts.awaiting} ACTIVE`}/>}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))',
        gap: 12,
      }}>
        <Metric icon="layers"       label="All"               value={rows.length}     tone="muted"   active={filter === 'all'}      onClick={() => setFilter('all')}/>
        <Metric icon="paymentCard"  label="Pending"           value={counts.pending}  tone="accent"  active={filter === 'pending'}  onClick={() => setFilter('pending')}/>
        <Metric icon="clock"        label="Awaiting approval" value={counts.awaiting} tone="warning" active={filter === 'awaiting'} onClick={() => setFilter('awaiting')}/>
        <Metric icon="check"        label="Approved"          value={counts.approved} tone="success" active={filter === 'approved'} onClick={() => setFilter('approved')}/>
      </div>

      <section style={{
        background: 'var(--zm-surface)',
        border: '1px solid var(--zm-line)',
        borderRadius: 14,
        boxShadow: 'var(--zm-shadow-1)',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '15px 18px',
          borderBottom: '1px solid var(--zm-line)',
          background: 'var(--zm-surface-2)',
          flexWrap: 'wrap',
        }}>
          <div>
            <h2 style={{
              margin: 0,
              fontFamily: 'var(--zm-font-display)',
              fontSize: 18,
              lineHeight: 1.1,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--zm-fg)',
            }}>
              Sites in Payments
            </h2>
            <p style={{
              margin: '5px 0 0',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 12.5,
              color: 'var(--zm-fg-2)',
            }}>
              A push from Sites in process lands here immediately — Finance / CA and Legal run in parallel from that point.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', width: 240, border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)' }}>
              <Icon name="search" size={14} style={{ color: 'var(--zm-fg-3)' }}/>
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search code, site, city…"
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg)' }}
              />
            </div>
            <button
              type="button"
              onClick={load}
              style={{
                height: 32,
                padding: '0 12px',
                border: '1px solid var(--zm-line)',
                borderRadius: 8,
                background: 'var(--zm-surface)',
                color: 'var(--zm-fg)',
                fontFamily: 'var(--zm-font-body)',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="refresh" size={13}/>
              Refresh
            </button>
          </div>
        </div>

        {state.status === 'loading' && (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
            Loading payment readiness...
          </div>
        )}

        {state.status === 'error' && (
          <div style={{
            margin: 18,
            padding: 14,
            borderRadius: 10,
            border: '1px solid var(--zm-danger, #9B2A2A)',
            background: 'var(--zm-danger-soft, #F0D6D2)',
            color: 'var(--zm-danger, #9B2A2A)',
            fontFamily: 'var(--zm-font-body)',
            fontSize: 13,
          }}>
            {state.error}
          </div>
        )}

        {state.status === 'ready' && visible.length === 0 && (
          <div style={{ padding: 42, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
            <Icon name="paymentCard" size={24}/>
            <p style={{ margin: '10px 0 0', fontFamily: 'var(--zm-font-body)' }}>
              {rows.length === 0
                ? 'No sites in Payments yet. Push a site from Sites in process to start Finance / CA.'
                : 'No sites match the current filter / search.'}
            </p>
          </div>
        )}

        {state.status === 'ready' && visible.map((site) => (
          <PaymentRow key={site.siteId} site={site} onOpen={openPayment}/>
        ))}
      </section>
    </div>
  );
}
