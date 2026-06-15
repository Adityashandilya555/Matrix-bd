import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getNsoHandoverQueue, pushToNso } from '../../services/api/projectApi.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// Render an ISO datetime as a short calendar date ("15 Jun 2026"), or "—".
function fmtDate(d) {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// NSO Handover tab — project-COMPLETED sites awaiting the supervisor's push to
// NSO. The supervisor's push opens the NSO record at stage three; executives see
// the queue read-only and wait for that push.
export default function NsoHandoverPage() {
  const navigate = useNavigate(); // eslint-disable-line no-unused-vars -- kept for parity with sibling queue pages
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  // Per-row push state: the siteId currently being pushed (button spinner /
  // disabled) and a row-scoped error surfaced in an inline banner.
  const [pushingId, setPushingId] = React.useState(null);
  const [pushError, setPushError] = React.useState(null);

  const load = React.useCallback(() => {
    let cancelled = false;
    // Keep loaded rows on screen during refreshes; failed refreshes keep stale
    // data + a banner instead of blanking the table.
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getNsoHandoverQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
            error: err?.detail || err?.message || 'Failed to load NSO handover queue',
          }));
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['project', 'nso', 'businessAdmin', 'siteTrackerApi'] });

  const handlePush = React.useCallback((row) => {
    setPushError(null);
    setPushingId(row.siteId);
    pushToNso(row.siteId)
      .then(() => {
        // Re-fetch so the pushed row drops off the queue.
        load();
      })
      .catch((err) => {
        setPushError(err?.detail || err?.message || 'Failed to push to NSO');
      })
      .finally(() => {
        setPushingId(null);
      });
  }, [load]);

  const COLS = '120px minmax(220px, 1fr) 140px 140px 180px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 09"
        eyebrow="Project module"
        title="NSO Handover"
        right={<HeaderTag icon="route" label="STAGE THREE"/>}
      />

      <p style={{
        margin: 0,
        color: 'var(--zm-fg-3)',
        fontFamily: 'var(--zm-font-body)',
        fontSize: 13,
        lineHeight: 1.5,
      }}>
        Project complete — push to open NSO at stage three.
      </p>

      {pushError && (
        <div className="zm-glass" style={{ padding: 14, color: 'var(--zm-danger)' }}>
          {pushError}
        </div>
      )}

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading NSO handover queue...
        </div>
      )}

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="route" size={20}/>
          <p style={{ margin: '12px 0 0' }}>
            No project-completed sites are waiting for NSO handover right now.
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
            <span>Completed</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          {state.items.map((row) => {
            const pushing = pushingId === row.siteId;
            return (
              <div
                key={row.siteId}
                data-site-id={row.siteId}
                className="zm-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  gap: 12,
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--zm-line-faint)',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                  {row.siteCode}
                </span>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>
                  {row.siteName}
                </span>
                <span style={{ color: 'var(--zm-fg-2)' }}>{row.city}</span>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                  {fmtDate(row.projectCompletedAt)}
                </span>
                {isSupervisor ? (
                  <button
                    type="button"
                    disabled={pushing || !!pushingId}
                    onClick={() => handlePush(row)}
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
                      cursor: pushing || !!pushingId ? 'not-allowed' : 'pointer',
                      opacity: pushing || (!!pushingId && !pushing) ? 0.6 : 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {pushing ? 'Pushing...' : <>Push to NSO<Icon name="arrow" size={12}/></>}
                  </button>
                ) : (
                  <span style={{
                    justifySelf: 'end',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--zm-fg-3)',
                    fontFamily: 'var(--zm-font-body)',
                    fontSize: 12,
                    fontWeight: 700,
                  }}>
                    <Icon name="clock" size={13}/>
                    Awaiting supervisor push
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
