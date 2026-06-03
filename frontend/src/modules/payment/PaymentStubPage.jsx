import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { listSites } from '../../services/api/siteService.js';
import { getSiteTrackerView } from '../../services/api/siteTrackerApi.js';
import { siteTrackerDetailRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

const PAYMENT_STATUSES = [
  'loi_uploaded',
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

function isPaymentReady(site) {
  return site.siteStatus === 'legal_approved' ||
    site.siteStatus === 'pushed_to_payments' ||
    site.licensingStatus === 'complete';
}

function paymentState(site) {
  const financeStatus = site.financeStatus || 'pending';
  if (financeStatus === 'approved') return 'approved';
  if (financeStatus === 'awaiting_supervisor' || financeStatus === 'awaiting_admin') return 'awaiting';
  if (isPaymentReady(site)) return 'ready';
  return 'locked';
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
      label: 'Approval pending',
      bg: 'var(--zm-warning-soft, #F8EEDC)',
      border: 'var(--zm-warning, #B0712E)',
      fg: 'var(--zm-warning, #B0712E)',
      icon: 'clock',
    };
  }
  if (state === 'ready') {
    return {
      label: 'Ready',
      bg: 'var(--zm-accent-soft, #E7F0EA)',
      border: 'var(--zm-accent, #0E5B45)',
      fg: 'var(--zm-accent, #0E5B45)',
      icon: 'paymentCard',
    };
  }
  return {
    label: 'Locked',
    bg: 'rgba(255,255,255,0.62)',
    border: 'var(--zm-line)',
    fg: 'var(--zm-fg-3)',
    icon: 'lock',
  };
}

function formatAmount(value) {
  if (value == null || value === '') return 'Not set';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function unlockCopy(site) {
  if (isPaymentReady(site)) {
    if (site.financeStatus === 'approved') return 'Finance approved and ready for final handoff.';
    if (site.financeStatus === 'awaiting_admin') return 'Supervisor approved. Admin approval is pending.';
    if (site.financeStatus === 'awaiting_supervisor') return 'Draft is complete. Supervisor approval is pending.';
    return 'Legal cleared the site. Finance can prepare the CA code and amount.';
  }
  if (site.legalDdStatus !== 'positive') return 'Waiting for positive due diligence.';
  if (site.agreementStatus !== 'registered' && site.agreementStatus !== 'executed' && site.agreementStatus !== 'signed') return 'Waiting for agreement execution.';
  if (site.licensingStatus !== 'complete') return 'Payment unlocks after licensing is complete.';
  return 'Waiting for Legal to clear the site.';
}

function Metric({ icon, label, value, tone = 'accent' }) {
  const color =
    tone === 'success' ? 'var(--zm-success, #2F7A4A)' :
    tone === 'warning' ? 'var(--zm-warning, #B0712E)' :
    tone === 'muted' ? 'var(--zm-fg-3)' :
    'var(--zm-accent, #0E5B45)';
  return (
    <div style={{
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      padding: '14px 16px',
      boxShadow: 'var(--zm-shadow-1)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 0,
    }}>
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
          color: 'var(--zm-fg-3)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {label}
        </div>
      </div>
    </div>
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
    <article style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(160px, 0.8fr) minmax(220px, 1fr) 132px',
      gap: 14,
      alignItems: 'center',
      padding: '16px 18px',
      borderBottom: '1px solid var(--zm-line-faint)',
      background: state === 'ready' ? 'var(--zm-accent-soft, #E7F0EA)' : 'transparent',
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
          border: state === 'locked' ? '1px solid var(--zm-line)' : 'none',
          background: state === 'locked' ? 'var(--zm-surface)' : 'var(--zm-accent)',
          color: state === 'locked' ? 'var(--zm-fg)' : 'var(--zm-accent-on, #fff)',
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
        {state === 'locked' ? 'View flow' : 'Open payment'}
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

export default function PaymentStubPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', rows: [], error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading', rows: [], error: null });
    Promise.all(PAYMENT_STATUSES.map((status) => listSites({ status }).catch(() => [])))
      .then((groups) => {
        const seen = new Set();
        const sites = [];
        for (const group of groups) {
          for (const site of group || []) {
            if (!site?.id || seen.has(site.id)) continue;
            seen.add(site.id);
            sites.push(site);
          }
        }
        return Promise.all(sites.map((site) => getSiteTrackerView(site.id).catch(() => null)));
      })
      .then((rows) => {
        if (cancelled) return;
        const cleanRows = rows.filter(Boolean).sort((a, b) => {
          const rank = { awaiting: 0, ready: 1, locked: 2, approved: 3 };
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
  }, { locked: 0, ready: 0, awaiting: 0, approved: 0 });

  const openPayment = (site) => {
    navigate(`${siteTrackerDetailRoute(site.siteId)}?node=ca`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 09"
        eyebrow="BD module"
        title="Payment"
        lede="Track CA / Commercial Code readiness, approval status, and finance handoff from the process flow."
        right={<HeaderTag icon="paymentCard" label={`${counts.ready + counts.awaiting} ACTIVE`}/>}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))',
        gap: 12,
      }}>
        <Metric icon="lock" label="Locked" value={counts.locked} tone="muted"/>
        <Metric icon="paymentCard" label="Ready for payment" value={counts.ready} tone="accent"/>
        <Metric icon="clock" label="Awaiting approval" value={counts.awaiting} tone="warning"/>
        <Metric icon="check" label="Approved" value={counts.approved} tone="success"/>
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
              Sites waiting for finance
            </h2>
            <p style={{
              margin: '5px 0 0',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 12.5,
              color: 'var(--zm-fg-2)',
            }}>
              Payment unlocks after licensing completes and Legal clears the site.
            </p>
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

        {state.status === 'ready' && rows.length === 0 && (
          <div style={{ padding: 42, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
            <Icon name="paymentCard" size={24}/>
            <p style={{ margin: '10px 0 0', fontFamily: 'var(--zm-font-body)' }}>
              No LOI-stage sites are ready for payment tracking yet.
            </p>
          </div>
        )}

        {state.status === 'ready' && rows.map((site) => (
          <PaymentRow key={site.siteId} site={site} onOpen={openPayment}/>
        ))}
      </section>
    </div>
  );
}
