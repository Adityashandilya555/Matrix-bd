import React from 'react';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { listLegalRejectedSites } from '../../services/api/legalApi.js';
import { getSiteActivity, colorForAction, labelForEntry } from '../../services/api/audit.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EmptyState() {
  return (
    <div className="zm-glass" style={{
      minHeight: 220,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 12,
      color: 'var(--zm-fg-3)',
      borderRadius: 12,
    }}>
      <span style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--zm-success)',
        background: 'var(--zm-success-soft, rgba(45,122,72,0.10))',
        border: '1px solid var(--zm-line)',
      }}>
        <Icon name="check" size={20}/>
      </span>
      <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
        No rejected Legal sites in this tenant.
      </p>
    </div>
  );
}

function HistoryDrawer({ site, history, onClose }) {
  if (!site) return null;
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 120,
      display: 'flex',
      justifyContent: 'flex-end',
      background: 'rgba(11,12,16,0.38)',
      backdropFilter: 'blur(4px)',
      animation: 'zm-fade 160ms var(--zm-ease)',
    }}>
      <aside className="zm-glass" style={{
        width: 440,
        maxWidth: '94vw',
        height: '100%',
        borderRadius: 0,
        borderTop: 'none',
        borderBottom: 'none',
        borderRight: 'none',
        background: 'var(--zm-bg)',
        boxShadow: 'var(--zm-shadow-pop)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'zm-slide 220ms var(--zm-ease-emp)',
      }}>
        <header style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--zm-line)',
          background: 'var(--zm-surface)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <span style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(185,28,28,0.10)',
            color: 'var(--zm-danger)',
            border: '1px solid rgba(185,28,28,0.25)',
            flex: '0 0 38px',
          }}>
            <Icon name="alert" size={18}/>
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: 'var(--zm-font-mono)',
              fontSize: 10.5,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--zm-fg-3)',
            }}>
              {site.siteCode}
            </div>
            <h2 style={{
              margin: '4px 0 0',
              fontFamily: 'var(--zm-font-display)',
              fontSize: 20,
              lineHeight: 1.15,
              color: 'var(--zm-fg)',
            }}>
              {site.siteName}
            </h2>
            <p style={{ margin: '4px 0 0', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>
              {site.city} · drafted by {site.submittedByName || '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--zm-line)',
              background: 'var(--zm-surface)',
              color: 'var(--zm-fg-2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon name="x" size={14}/>
          </button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <section style={{
            border: '1px solid var(--zm-line)',
            borderRadius: 10,
            background: 'var(--zm-surface)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--zm-line)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}>
              <span style={{
                fontFamily: 'var(--zm-font-body)',
                fontSize: 11,
                fontWeight: 850,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--zm-fg)',
              }}>
                Rejection summary
              </span>
              <span style={{
                fontFamily: 'var(--zm-font-mono)',
                fontSize: 10.5,
                color: 'var(--zm-danger)',
              }}>
                {formatDate(site.legalRejectedAt)}
              </span>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                DD verdict: <strong style={{ color: 'var(--zm-danger)' }}>Negative</strong>
              </div>
              <div style={{
                padding: 12,
                borderRadius: 8,
                background: 'var(--zm-surface-2)',
                color: 'var(--zm-fg-2)',
                fontFamily: 'var(--zm-font-body)',
                fontSize: 13,
                lineHeight: 1.5,
                fontStyle: site.rejectionReason ? 'normal' : 'italic',
              }}>
                {site.rejectionReason || 'No rejection reason captured.'}
              </div>
            </div>
          </section>

          <section style={{
            border: '1px solid var(--zm-line)',
            borderRadius: 10,
            background: 'var(--zm-surface)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--zm-line)',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 11,
              fontWeight: 850,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--zm-fg)',
            }}>
              Activity history
            </div>
            {history.status === 'loading' && (
              <div style={{ padding: 18, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
                Loading history…
              </div>
            )}
            {history.status === 'error' && (
              <div style={{ padding: 18, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-danger)' }}>
                {history.error}
              </div>
            )}
            {history.status === 'ready' && history.items.length === 0 && (
              <div style={{ padding: 18, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
                No activity recorded for this site.
              </div>
            )}
            {history.status === 'ready' && history.items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {history.items.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '12px minmax(0, 1fr)',
                      gap: 10,
                      padding: '12px 14px',
                      borderBottom: '1px solid var(--zm-line-faint)',
                    }}
                  >
                    <span style={{
                      width: 8,
                      height: 8,
                      marginTop: 5,
                      borderRadius: 999,
                      background: colorForAction(entry.action),
                    }}/>
                    <span style={{ minWidth: 0 }}>
                      <span style={{
                        display: 'block',
                        fontFamily: 'var(--zm-font-body)',
                        fontSize: 12.5,
                        color: 'var(--zm-fg)',
                        fontWeight: 650,
                      }}>
                        {labelForEntry(entry)}
                      </span>
                      <span style={{
                        display: 'block',
                        marginTop: 3,
                        fontFamily: 'var(--zm-font-mono)',
                        fontSize: 10.5,
                        color: 'var(--zm-fg-3)',
                      }}>
                        {entry.actor || 'system'} · {formatDate(entry.createdAt)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function RejectedSitesPage() {
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [activeSite, setActiveSite] = React.useState(null);
  const [history, setHistory] = React.useState({ status: 'idle', items: [], error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], total: 0, error: null });
    listLegalRejectedSites()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load rejected sites' });
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load);

  const openHistory = React.useCallback((site) => {
    setActiveSite(site);
    setHistory({ status: 'loading', items: [], error: null });
    getSiteActivity(site.siteId)
      .then((data) => setHistory({ status: 'ready', items: data.items || [], error: null }))
      .catch((err) => setHistory({ status: 'error', items: [], error: err?.detail || err?.message || 'Failed to load history' }));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow="Legal module · exception queue"
        title={<>Rejected <em>sites</em></>}
        lede="Legal DD failures stay visible here with the rejection reason and the exact site history."
        right={<HeaderTag icon="alert" label={`${state.total || 0} REJECTED`}/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading rejected sites…
        </div>
      )}
      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}
      {state.status === 'ready' && state.items.length === 0 && <EmptyState/>}

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '120px minmax(220px, 1fr) 140px 150px minmax(220px, 1.3fr) 140px 120px',
            gap: 12,
            padding: '12px 16px',
            background: 'var(--zm-surface-2)',
            borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)',
            fontWeight: 850,
            fontSize: 10.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Site</span>
            <span>City</span>
            <span>Drafted by</span>
            <span>Reason</span>
            <span>Rejected</span>
            <span style={{ textAlign: 'right' }}>History</span>
          </div>
          {state.items.map((row) => (
            <div
              key={row.siteId}
              onClick={() => openHistory(row)}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(220px, 1fr) 140px 150px minmax(220px, 1.3fr) 140px 120px',
                gap: 12,
                padding: '14px 16px',
                borderBottom: '1px solid var(--zm-line-faint)',
                alignItems: 'center',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                {row.siteCode}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 750, color: 'var(--zm-fg)' }}>
                {row.siteName}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                {row.city}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                {row.submittedByName || '—'}
              </span>
              <span style={{
                fontFamily: 'var(--zm-font-body)',
                fontSize: 12.5,
                color: 'var(--zm-fg-2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {row.rejectionReason || '—'}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>
                {formatDate(row.legalRejectedAt)}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openHistory(row); }}
                style={{
                  justifySelf: 'end',
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 7,
                  border: '1px solid var(--zm-line)',
                  background: 'var(--zm-surface)',
                  color: 'var(--zm-fg)',
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 12,
                  fontWeight: 750,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <Icon name="clock" size={13}/>
                Inspect
              </button>
            </div>
          ))}
        </div>
      )}

      <HistoryDrawer site={activeSite} history={history} onClose={() => setActiveSite(null)}/>
    </div>
  );
}
