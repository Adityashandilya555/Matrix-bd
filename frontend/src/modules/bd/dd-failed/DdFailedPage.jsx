import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { getDdFailedQueue } from '../../../services/api/changeRequestApi.js';
import { bdSiteStatusRoute } from '../../../router/routes.js';
import { useSiteDataRefresh } from '../../../hooks/useSiteDataRefresh.js';

export default function DdFailedPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], total: 0, error: null });
    getDdFailedQueue()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load' });
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 07"
        eyebrow="BD module"
        title={<>Due diligence <em>failed</em></>}
        lede="Sites the legal team rejected on due diligence. Open one to see the reason and request a change."
        right={<HeaderTag icon="alert" label="LEGAL_REJECTED"/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading…
        </div>
      )}
      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="check" size={20}/>
          <p style={{ margin: '12px 0 0' }}>No failed sites — clean slate.</p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{
          borderRadius: 12, overflow: 'hidden',
          borderLeft: '4px solid var(--zm-danger)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px minmax(220px,1fr) 140px',
            gap: 12, padding: '12px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span><span>Site</span><span>City</span><span>Drafted by</span>
            <span>Reason</span><span style={{ textAlign: 'right' }}>Action</span>
          </div>
          {state.items.map((row) => (
            <div
              key={row.siteId}
              onClick={() => navigate(bdSiteStatusRoute(row.siteId))}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px minmax(220px,1fr) 140px',
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
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                {row.submittedByName || '—'}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)', fontStyle: 'italic' }}>
                {row.rejectionReason || '—'}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate(bdSiteStatusRoute(row.siteId)); }}
                style={{
                  justifySelf: 'end',
                  height: 32, padding: '0 14px', border: 'none', borderRadius: 7,
                  background: 'var(--zm-accent)', color: '#fff',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                View status
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
