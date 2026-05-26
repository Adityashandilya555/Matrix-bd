import React from 'react';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { usePageContext } from '../../App.jsx';
import {
  listPendingChangeRequests,
  approveChangeRequest,
  rejectChangeRequest,
} from '../../services/api/changeRequestApi.js';

function StatusPill({ value }) {
  const meta = value === 'approved'
    ? { color: 'var(--zm-success)', label: 'Approved' }
    : value === 'rejected'
      ? { color: 'var(--zm-danger)',  label: 'Rejected' }
      : { color: 'var(--zm-fg-3)',    label: 'Pending'  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${meta.color}`, color: meta.color,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10.5,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>{meta.label}</span>
  );
}

export default function ChangeRequestsPage() {
  const { showToast } = usePageContext();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [busy, setBusy] = React.useState(null);

  const load = React.useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    listPendingChangeRequests()
      .then((data) => setState({ status: 'ready', items: data.items, total: data.total, error: null }))
      .catch((err) => setState({
        status: 'error', items: [], total: 0,
        error: err?.detail || err?.message || 'Failed to load',
      }));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const approve = async (cr) => {
    if (!window.confirm(
      `Approve and overwrite ${cr.targetTable}.${cr.fieldName} from "${cr.currentValue}" to "${cr.requestedValue}"?`,
    )) return;
    setBusy(cr.id);
    try {
      await approveChangeRequest(cr.id, {});
      showToast?.('Change approved · status overwritten');
      load();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Failed to approve');
    } finally { setBusy(null); }
  };

  const reject = async (cr) => {
    const note = window.prompt('Reason for rejection? (BD will see this)', '');
    if (note === null) return;
    setBusy(cr.id);
    try {
      await rejectChangeRequest(cr.id, { reviewerNote: note });
      showToast?.('Change request rejected');
      load();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Failed to reject');
    } finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow="Legal module"
        title={<>Change <em>requests</em></>}
        lede="BD-opened requests to flip a legal field on a site. Approving overwrites the underlying status immediately."
        right={<HeaderTag icon="alert" label={`${state.total} PENDING`}/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading…</div>
      )}
      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="check" size={20}/>
          <p style={{ margin: '12px 0 0' }}>No pending change requests.</p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px,1fr) minmax(220px,1.2fr) 140px 100px 220px',
            gap: 12, padding: '12px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Site</span>
            <span>Field / change</span>
            <span>Requested by</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>
          {state.items.map((cr) => (
            <div key={cr.id} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px,1fr) minmax(220px,1.2fr) 140px 100px 220px',
              gap: 12, padding: '14px 16px',
              borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 700 }}>
                  {cr.siteName}
                </div>
                <div style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>
                  {cr.siteCode}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13 }}>
                  <strong>{cr.targetTable.replace(/_/g, ' ')}</strong> · {cr.fieldName}
                </div>
                <div style={{ fontSize: 12, color: 'var(--zm-fg-3)' }}>
                  {cr.currentValue} → {cr.requestedValue}
                  {cr.justification && (
                    <span style={{ display: 'block', fontStyle: 'italic' }}>
                      “{cr.justification}”
                    </span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{cr.requestedByName || '—'}</span>
              <StatusPill value={cr.status}/>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => reject(cr)}
                  disabled={busy === cr.id}
                  style={{
                    height: 32, padding: '0 12px', border: '1px solid var(--zm-line)',
                    borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg)',
                    fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
                    cursor: busy === cr.id ? 'not-allowed' : 'pointer',
                  }}
                >Reject</button>
                <button
                  type="button"
                  onClick={() => approve(cr)}
                  disabled={busy === cr.id}
                  style={{
                    height: 32, padding: '0 14px', border: 'none', borderRadius: 7,
                    background: 'var(--zm-success)', color: '#fff',
                    fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                    cursor: busy === cr.id ? 'not-allowed' : 'pointer',
                  }}
                >Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
