import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { getLegalQueue } from '../../services/api/legalApi.js';
import { legalSiteDdrRoute } from '../../router/routes.js';

const STATUS_LABELS = {
  pending:   { label: 'Awaiting review',    tone: 'var(--zm-fg-3)' },
  in_review: { label: 'In review',           tone: 'var(--zm-accent)' },
  positive:  { label: 'DD positive',         tone: 'var(--zm-success)' },
  negative:  { label: 'DD negative',         tone: 'var(--zm-danger)' },
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

export default function LegalQueuePage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], total: 0, error: null });
    getLegalQueue()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load legal queue' });
      });
    return () => { cancelled = true; };
  }, []);

  const open = (siteId) => navigate(legalSiteDdrRoute(siteId));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 05"
        eyebrow="Legal module"
        title={<>Legal <em>queue</em></>}
        lede="Sites pushed to legal review. Open a row to start the due-diligence checklist."
        right={<HeaderTag icon="shield" label="LEGAL_REVIEW"/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading queue…
        </div>
      )}

      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="shield" size={20}/>
          <p style={{ margin: '12px 0 0' }}>No sites are awaiting legal review right now.</p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px 140px',
            gap: 12, padding: '12px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Site</span>
            <span>City</span>
            <span>DD status</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          {state.items.map((row) => (
            <div
              key={row.siteId}
              onClick={() => open(row.siteId)}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px 140px',
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
                {row.siteName}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                {row.city}
              </span>
              <StatusPill value={row.legalDdStatus}/>
              <button
                type="button"
                className="zm-btn-primary"
                onClick={(e) => { e.stopPropagation(); open(row.siteId); }}
                style={{
                  justifySelf: 'end',
                  height: 32, padding: '0 14px',
                  border: 'none', borderRadius: 7,
                  background: 'var(--zm-accent)', color: '#fff',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                Open DDR
                <Icon name="arrow-right" size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
