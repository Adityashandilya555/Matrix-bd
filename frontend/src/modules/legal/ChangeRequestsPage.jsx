import React from 'react';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { usePageContext } from '../../App.jsx';
import { useFocusSite } from '../../hooks/useFocusSite.js';
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

const btnStyle = (bg, textCol) => ({
  height: 32, padding: '0 14px', border: bg === 'transparent' ? '1px solid var(--zm-line)' : 'none', 
  borderRadius: 7, background: bg === 'transparent' ? 'var(--zm-surface)' : bg, 
  color: textCol || (bg === 'transparent' ? 'var(--zm-fg)' : '#fff'),
  cursor: 'pointer', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 500,
});

function ConfirmModal({ title, message, busy, onConfirm, onClose }) {
  return (
    // Presentational backdrop — click on the scrim dismisses the modal; the
    // dialog's own Cancel/Approve buttons provide keyboard dismissal.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div role="dialog" aria-modal="true" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)',
      zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      {/* onClick only stops the click from bubbling to the backdrop (which
          would close the modal); the panel is not an interactive control. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14,
        width: 'min(460px, 96vw)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
        boxShadow: 'var(--zm-shadow-pop)',
      }}>
        <strong style={{ fontSize: 15 }}>{title}</strong>
        <span style={{ fontSize: 13, color: 'var(--zm-fg-2)' }}>{message}</span>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
          <button style={btnStyle('transparent')} disabled={busy} onClick={onClose}>Cancel</button>
          <button style={btnStyle('var(--zm-success)')} disabled={busy} onClick={onConfirm}>Approve</button>
        </div>
      </div>
    </div>
  );
}

function PromptModal({ title, placeholder, busy, onConfirm, onClose }) {
  const [text, setText] = React.useState('');
  return (
    // Presentational backdrop — click on the scrim dismisses the modal; the
    // dialog's own Cancel/Confirm buttons provide keyboard dismissal.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div role="dialog" aria-modal="true" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)',
      zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      {/* onClick only stops the click from bubbling to the backdrop (which
          would close the modal); the panel is not an interactive control. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14,
        width: 'min(460px, 96vw)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
        boxShadow: 'var(--zm-shadow-pop)',
      }}>
        <strong style={{ fontSize: 15 }}>{title}</strong>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
          placeholder={placeholder}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg)',
            fontFamily: 'var(--zm-font-body)', fontSize: 13, resize: 'vertical'
          }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
          <button style={btnStyle('transparent')} disabled={busy} onClick={onClose}>Cancel</button>
          <button style={btnStyle('var(--zm-danger)')} disabled={busy || !text.trim()} onClick={() => onConfirm(text.trim())}>Reject</button>
        </div>
      </div>
    </div>
  );
}

export default function ChangeRequestsPage() {
  const { showToast } = usePageContext();
  useFocusSite();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [busy, setBusy] = React.useState(null);
  const [confirmCr, setConfirmCr] = React.useState(null);
  const [promptCr, setPromptCr] = React.useState(null);

  const load = React.useCallback(() => {
    let cancelled = false;
    // Keep loaded rows visible during approve/reject reloads; failed
    // refreshes keep stale data + a banner instead of blanking the list.
    setState((s) => ({ ...s, status: s.items.length ? s.status : 'loading', error: null }));
    listPendingChangeRequests()
      .then((data) => { if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: s.items.length ? 'ready' : 'error',
          error: err?.detail || err?.message || 'Failed to load',
        }));
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);

  const approve = async (cr) => {
    setBusy(cr.id);
    try {
      await approveChangeRequest(cr.id, {});
      showToast?.('Change approved · status overwritten');
      load();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Failed to approve');
    } finally { 
      setBusy(null); 
      setConfirmCr(null);
    }
  };

  const reject = async (cr, note) => {
    setBusy(cr.id);
    try {
      await rejectChangeRequest(cr.id, { reviewerNote: note });
      showToast?.('Change request rejected');
      load();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Failed to reject');
    } finally { 
      setBusy(null); 
      setPromptCr(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageHeader
          file="No. 08"
          eyebrow="Legal module"
          title={<>Change <em>requests</em></>}
          right={<HeaderTag icon="alert" label={`${state.total} PENDING`}/>}
        />
        {state.status === 'loading' && (
          <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading…</div>
        )}
        {state.error && (
          <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
        )}
        {state.status === 'ready' && state.items.length === 0 && (
          <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
            <Icon name="check" size={20}/>
            <p style={{ margin: '12px 0 0' }}>No pending change requests.</p>
          </div>
        )}
      </div>

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            flexShrink: 0,
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
            <span style={{ textAlign: 'right', paddingRight: 16 }}>Action</span>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto' }}>
          {state.items.map((cr) => (
            <div key={cr.id} data-site-id={cr.siteId} style={{
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
                  onClick={() => setPromptCr(cr)}
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
                  onClick={() => setConfirmCr(cr)}
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
        </div>
      )}
      
      {confirmCr && (
        <ConfirmModal 
          title="Approve Change Request" 
          message={`Approve and overwrite ${confirmCr.targetTable}.${confirmCr.fieldName} from "${confirmCr.currentValue}" to "${confirmCr.requestedValue}"?`}
          busy={busy === confirmCr.id}
          onConfirm={() => approve(confirmCr)}
          onClose={() => setConfirmCr(null)}
        />
      )}
      
      {promptCr && (
        <PromptModal
          title="Reject Change Request"
          placeholder="Reason for rejection? (BD will see this)"
          busy={busy === promptCr.id}
          onConfirm={(note) => reject(promptCr, note)}
          onClose={() => setPromptCr(null)}
        />
      )}
    </div>
  );
}
