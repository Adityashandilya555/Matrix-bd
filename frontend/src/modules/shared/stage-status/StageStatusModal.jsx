import React from 'react';
import Icon from '../primitives/Icon.jsx';
import { getSiteStageStatus } from '../../../services/api/siteTrackerApi.js';

// Read-only "View status" popup for the BD process flow. Fetches the per-stage
// status detail (design deliverables, project milestones, NSO licences) plus a
// recent stage-events timeline and renders it as a visibility surface — no
// action controls, no module features. Optionally focuses one stage (used when
// a specific pipeline node is clicked).

const TONE_COLOR = {
  positive: 'var(--zm-success, #2D7A48)',
  negative: 'var(--zm-danger, #B91C1C)',
  active:   'var(--zm-warning, #B0712E)',
  neutral:  'var(--zm-fg-3)',
};

const STATE_COLOR = {
  complete: 'var(--zm-success, #2D7A48)',
  active:   'var(--zm-warning, #B0712E)',
  rejected: 'var(--zm-danger, #B91C1C)',
  future:   'var(--zm-fg-3)',
};

const NODE_ICON = {
  loi: 'file', legal: 'shield', ca: 'rupee', design: 'grid',
  project: 'box', nso: 'home', launch: 'flag',
};

function StateChip({ state, label }) {
  const color = STATE_COLOR[state] || STATE_COLOR.future;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
      borderRadius: 999, border: `1px solid ${color}`, color,
      fontFamily: 'var(--zm-font-mono)', fontWeight: 700, fontSize: 9.5,
      letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function StageSection({ stage, focused, innerRef }) {
  return (
    <section
      ref={innerRef}
      style={{
        border: `1px solid ${focused ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
        borderRadius: 12,
        background: focused ? 'var(--zm-accent-soft, var(--zm-surface-2))' : 'var(--zm-surface)',
        boxShadow: focused ? '0 0 0 2px rgba(14,91,69,0.10)' : 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--zm-line-faint)',
        background: 'var(--zm-surface-2)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ color: STATE_COLOR[stage.state] || 'var(--zm-fg-3)', display: 'inline-flex' }}>
            <Icon name={NODE_ICON[stage.id] || 'layers'} size={15}/>
          </span>
          <span style={{
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 12,
            letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--zm-fg)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {stage.title}
          </span>
        </span>
        <StateChip state={stage.state} label={stage.stateLabel}/>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {stage.rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
              {r.label}
            </span>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700,
              color: TONE_COLOR[r.tone] || 'var(--zm-fg)', textAlign: 'right',
            }}>
              {r.value}
            </span>
          </div>
        ))}
        {stage.note && (
          <div style={{
            marginTop: 2, fontFamily: 'var(--zm-font-body)', fontSize: 11.5,
            color: 'var(--zm-fg-3)', fontStyle: 'italic',
          }}>
            {stage.note}
          </div>
        )}
      </div>
    </section>
  );
}

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function Timeline({ entries }) {
  if (!entries.length) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
      }}>
        Recent activity
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((e, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'baseline', gap: 10,
            fontFamily: 'var(--zm-font-body)', fontSize: 12,
          }}>
            <span style={{
              flex: '0 0 62px', fontFamily: 'var(--zm-font-mono)', fontSize: 10.5,
              color: 'var(--zm-fg-3)',
            }}>
              {relTime(e.occurredAt)}
            </span>
            <span style={{ color: 'var(--zm-fg)', flex: 1, minWidth: 0 }}>
              {String(e.eventType || '').replace(/_/g, ' ')}
              {e.toStatus ? ` → ${String(e.toStatus).replace(/_/g, ' ')}` : ''}
              {e.actorName ? <span style={{ color: 'var(--zm-fg-3)' }}> · {e.actorName}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function StageStatusModal({ siteId, focusStage = null, onClose }) {
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const focusRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    getSiteStageStatus(siteId)
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({
        status: 'error', data: null,
        error: err?.detail || err?.message || 'Failed to load status',
      }); });
    return () => { cancelled = true; };
  }, [siteId]);

  // Close on Escape.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Scroll the focused stage into view once loaded.
  React.useEffect(() => {
    if (state.status === 'ready' && focusStage && focusRef.current) {
      focusRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [state.status, focusStage]);

  const data = state.data;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '48px 16px', overflowY: 'auto',
    }}>
      {/* Presentational scrim — click only dismisses; the card's close button is
          the keyboard-reachable affordance. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,20,0.42)' }}/>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: 620,
          background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
          borderRadius: 16, boxShadow: 'var(--zm-shadow-2, 0 24px 60px rgba(0,0,0,0.24))',
          display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 96px)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          padding: '16px 18px', borderBottom: '1px solid var(--zm-line)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)',
              letterSpacing: '0.06em',
            }}>
              {data?.siteCode || ''}
            </div>
            <div style={{
              fontFamily: 'var(--zm-font-body)', fontSize: 16, fontWeight: 800,
              color: 'var(--zm-fg)', lineHeight: 1.25,
            }}>
              {data?.siteName || 'Site status'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close status"
            style={{
              flex: '0 0 auto', width: 30, height: 30, padding: 0, border: '1px solid var(--zm-line)',
              borderRadius: 8, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="x" size={13}/>
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {state.status === 'loading' && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading status…</div>
          )}
          {state.status === 'error' && (
            <div style={{ padding: 16, color: 'var(--zm-danger, #B91C1C)' }}>{state.error}</div>
          )}
          {state.status === 'ready' && data && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 10,
                background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line-faint)',
              }}>
                <span style={{ color: 'var(--zm-accent)', display: 'inline-flex' }}>
                  <Icon name="activity" size={15}/>
                </span>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>
                  {data.headline}
                </span>
              </div>

              {data.stages.map((stage) => (
                <StageSection
                  key={stage.id}
                  stage={stage}
                  focused={focusStage === stage.id}
                  innerRef={focusStage === stage.id ? focusRef : undefined}
                />
              ))}

              <Timeline entries={data.timeline}/>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
