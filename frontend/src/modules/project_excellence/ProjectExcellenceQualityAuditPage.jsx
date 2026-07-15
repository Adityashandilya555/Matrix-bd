// skipcq: JS-0833
import React from 'react';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getPEQualityAuditQueue, completePEQualityAudit } from '../../services/api/projectExcellenceApi.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// Project Excellence → Quality Audit tab. The chain: the project executive sets
// the quality-audit date → the project supervisor approves it → it lands here,
// where the PE supervisor clicks "Mark as completed". That marks the project complete
// (recording the completion date) and the site then appears in the Project
// module's NSO Handover tab for the supervisor to push (which opens NSO stage 3).
function fmtDate(d) {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ProjectExcellenceQualityAuditPage() {
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [completingId, setCompletingId] = React.useState(null);
  const [actionError, setActionError] = React.useState(null);

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getPEQualityAuditQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
            error: err?.detail || err?.message || 'Failed to load the quality-audit queue',
          }));
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['project', 'project_excellence', 'businessAdmin'] });

  const handleComplete = React.useCallback((row) => {
    setActionError(null);
    setCompletingId(row.siteId);
    completePEQualityAudit(row.siteId)
      .then(() => load())
      .catch((err) => setActionError(err?.detail || err?.message || 'Failed to mark completed'))
      .finally(() => setCompletingId(null));
  }, [load]);

  const COLS = '120px minmax(220px, 1fr) 140px 150px 200px';
  const pendingCount = state.items.filter((r) => r.qualityAuditStatus === 'supervisor_approved').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow="Project Excellence module"
        title="Quality Audit"
        lede={state.status === 'ready'
          ? `${pendingCount} site${pendingCount === 1 ? '' : 's'} awaiting completion`
          : 'Final quality-audit sign-off'}
        right={<HeaderTag icon="box" label="SUPERVISOR APPROVED → COMPLETE"/>}
      />

      {actionError && (
        <div className="zm-glass" style={{ padding: 14, color: 'var(--zm-danger)' }}>{actionError}</div>
      )}

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading the quality-audit queue…
        </div>
      )}

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="box" size={20}/>
          <p style={{ margin: '12px 0 0' }}>
            No sites have a supervisor-approved quality audit awaiting completion.
          </p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Site</span>
            <span>City</span>
            <span>Audit date</span>
            <span style={{ textAlign: 'right' }}>Status</span>
          </div>

          {state.items.map((row) => {
            const completing = completingId === row.siteId;
            const done = row.qualityAuditStatus === 'approved';
            return (
              <div
                key={row.siteId}
                data-site-id={row.siteId}
                className="zm-row"
                style={{
                  display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 16px',
                  borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'center',
                }}
              >
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>{row.siteCode}</span>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>{row.siteName}</span>
                <span style={{ color: 'var(--zm-fg-2)' }}>{row.city}</span>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{fmtDate(row.inspectionDate)}</span>
                {done ? (
                  <span style={{
                    justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 6,
                    color: 'var(--zm-success)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                  }}>
                    <Icon name="check" size={13}/>
                    Completed {fmtDate(row.projectCompletedAt)}
                  </span>
                ) : isSupervisor ? (
                  <button
                    type="button"
                    disabled={completing || !!completingId}
                    onClick={() => handleComplete(row)}
                    style={{
                      justifySelf: 'end', height: 32, padding: '0 14px', border: 'none', borderRadius: 7,
                      background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)',
                      fontSize: 12, fontWeight: 800,
                      cursor: completing || !!completingId ? 'not-allowed' : 'pointer',
                      opacity: completing || (!!completingId && !completing) ? 0.6 : 1,
                      display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                    }}
                  >
                    {completing ? 'Saving…' : <>Mark as completed<Icon name="check" size={12}/></>}
                  </button>
                ) : (
                  <span style={{
                    justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 6,
                    color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
                  }}>
                    <Icon name="clock" size={13}/>
                    Awaiting supervisor
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
