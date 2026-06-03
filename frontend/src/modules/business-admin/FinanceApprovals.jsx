import React from 'react';
import {
  approveFinanceApproval,
  listFinanceApprovals,
} from '../../services/api/adapters/httpAdapter.js';

const card = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.03)',
  padding: 16,
};

const btn = (bg) => ({
  height: 30,
  padding: '0 12px',
  borderRadius: 8,
  border: 'none',
  background: bg,
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
});

function formatAmount(value) {
  if (value == null || value === '') return 'Amount not set';
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

function MiniField({ label, value }) {
  return (
    <div style={{
      minWidth: 0,
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 9,
      background: 'rgba(255,255,255,0.035)',
      padding: '8px 10px',
    }}>
      <div style={{
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.46)',
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 12.5,
        fontWeight: 700,
        color: 'rgba(255,255,255,0.88)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
    </div>
  );
}

export default function FinanceApprovals() {
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [busySiteId, setBusySiteId] = React.useState(null);

  const load = React.useCallback(() => {
    setState({ status: 'loading', items: [], error: null });
    listFinanceApprovals()
      .then((items) => setState({ status: 'ready', items, error: null }))
      .catch((e) => setState({
        status: 'error',
        items: [],
        error: e?.detail || e?.message || 'Failed to load finance approvals',
      }));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const approve = async (siteId) => {
    setBusySiteId(siteId);
    try {
      await approveFinanceApproval(siteId);
      await listFinanceApprovals()
        .then((items) => setState({ status: 'ready', items, error: null }));
    } catch (e) {
      window.alert(e?.detail || e?.message || 'Finance approval failed');
    } finally {
      setBusySiteId(null);
    }
  };

  if (state.status === 'loading') {
    return <div style={{ ...card, color: 'rgba(255,255,255,0.6)' }}>Loading…</div>;
  }
  if (state.status === 'error') {
    return <div style={{ ...card, color: '#f0888c' }}>{state.error}</div>;
  }
  if (state.items.length === 0) {
    return <div style={{ ...card, color: 'rgba(255,255,255,0.55)' }}>No finance requests awaiting admin approval.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {state.items.map((row) => {
        const busy = busySiteId === row.siteId;
        return (
          <div key={row.siteId} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                {row.caCode || row.siteCode}
              </span>
              <strong style={{ fontSize: 14 }}>{row.siteName}</strong>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{row.city}</span>
              <span style={{
                height: 22,
                padding: '0 8px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 999,
                border: '1px solid rgba(176,113,46,0.8)',
                color: '#f0b86c',
                background: 'rgba(176,113,46,0.12)',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                Awaiting admin
              </span>
              <span style={{ flex: 1 }}/>
              <button
                type="button"
                disabled={busy}
                style={{ ...btn('#2f9e5e'), opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}
                onClick={() => approve(row.siteId)}
              >
                {busy ? 'Approving…' : 'Approve finance'}
              </button>
            </div>

            <div style={{
              marginTop: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8,
            }}>
              <MiniField label="KYC" value={row.kycVerified ? 'Verified' : 'Not verified'}/>
              <MiniField label="Amount" value={formatAmount(row.financeAmount)}/>
              <MiniField label="Submitted by" value={row.submittedByName || 'Unknown'}/>
              <MiniField label="Site status" value={(row.siteStatus || '').replace(/_/g, ' ')}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}
