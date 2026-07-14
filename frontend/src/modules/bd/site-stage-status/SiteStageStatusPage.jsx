import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { getSiteStageStatus } from '../../../services/api/siteTrackerApi.js';
import { bdSiteStatusRoute } from '../../../router/routes.js';
import { useSiteDataRefresh } from '../../../hooks/useSiteDataRefresh.js';

// Focused, read-only department detail page for the BD process flow. Reached by
// clicking a pipeline node — the content column swaps to it (with a back button),
// the same pattern as the CA / Commercial-code and Legal status pages. Shows one
// department's sub-status (recce/2D/3D/BOQ, project milestones, NSO stage 1/2/3,
// legal DD checks, budgeting …) plus a recent stage-events timeline. With no
// ?stage it falls back to the full overview. All actions (legal flip-to-Yes)
// live on their own pages, reachable from the buttons here.

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
  excellence: 'trend', project: 'box', nso: 'home', launch: 'flag',
};

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32, padding: '0 14px', border: '1px solid var(--zm-line)',
        borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg)',
        fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
        cursor: 'pointer', alignSelf: 'flex-start',
      }}
    >
      ← Back to flow
    </button>
  );
}

function StateChip({ state, label }) {
  const color = STATE_COLOR[state] || STATE_COLOR.future;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px',
      borderRadius: 999, border: `1px solid ${color}`, color,
      fontFamily: 'var(--zm-font-mono)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function LegalNegativeBanner({ negatives, onOpenLegal }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 14px', borderRadius: 10,
      background: 'rgba(185,28,28,0.07)', border: '1px solid var(--zm-danger, #B91C1C)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--zm-danger, #B91C1C)', display: 'inline-flex' }}>
          <Icon name="alert" size={15}/>
        </span>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 800, color: 'var(--zm-danger, #B91C1C)' }}>
          {negatives.length} due-diligence {negatives.length === 1 ? 'check is' : 'checks are'} negative
        </span>
      </div>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
        {negatives.join(', ')} — raise a flip-to-Yes request from the Legal status page.
      </div>
      <button
        type="button"
        onClick={onOpenLegal}
        style={{
          alignSelf: 'flex-start', height: 34, padding: '0 16px',
          border: 'none', borderRadius: 8,
          background: 'var(--zm-danger, #B91C1C)', color: '#fff',
          fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 800,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7,
        }}
      >
        <Icon name="shield" size={13}/>
        Open Legal status &amp; flip-to-Yes
      </button>
    </div>
  );
}

function StageCard({ stage, focused, action }) {
  return (
    <section
      style={{
        border: `1px solid ${focused ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
        borderRadius: 12,
        background: 'var(--zm-surface)',
        boxShadow: focused ? '0 0 0 2px rgba(14,91,69,0.12), var(--zm-shadow-1)' : 'var(--zm-shadow-1)',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)',
        background: 'var(--zm-surface-2)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span style={{ color: STATE_COLOR[stage.state] || 'var(--zm-fg-3)', display: 'inline-flex' }}>
            <Icon name={NODE_ICON[stage.id] || 'layers'} size={16}/>
          </span>
          <span style={{
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 12.5,
            letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--zm-fg)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {stage.title}
          </span>
        </span>
        <StateChip state={stage.state} label={stage.stateLabel}/>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stage.rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>
              {r.label}
            </span>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700,
              color: TONE_COLOR[r.tone] || 'var(--zm-fg)', textAlign: 'right',
            }}>
              {r.value}
            </span>
          </div>
        ))}
        {stage.note && (
          <div style={{
            marginTop: 2, paddingTop: 8, borderTop: '1px dashed var(--zm-line-faint)',
            fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)', fontStyle: 'italic',
          }}>
            {stage.note}
          </div>
        )}
        {action}
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

function TimelineCard({ entries }) {
  if (!entries.length) return null;
  return (
    <section style={{
      border: '1px solid var(--zm-line)', borderRadius: 12,
      background: 'var(--zm-surface)', boxShadow: 'var(--zm-shadow-1)', overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)',
        background: 'var(--zm-surface-2)',
        fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
      }}>
        Recent activity
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {entries.map((e, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'baseline', gap: 12,
            fontFamily: 'var(--zm-font-body)', fontSize: 12.5,
          }}>
            <span style={{
              flex: '0 0 66px', fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)',
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

export default function SiteStageStatusPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusStage = searchParams.get('stage');
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const cancelledRef = React.useRef(false);

  const load = React.useCallback((silent = false) => {
    if (!siteId) return;
    if (!silent) setState((s) => ({ ...s, status: 'loading' }));
    getSiteStageStatus(siteId)
      .then((data) => { if (!cancelledRef.current) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelledRef.current) setState({
        status: 'error', data: null,
        error: err?.detail || err?.message || 'Failed to load stage status',
      }); });
  }, [siteId]);

  React.useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => { cancelledRef.current = true; };
  }, [load]);
  useSiteDataRefresh(React.useCallback(() => load(true), [load]), { siteId });

  if (state.status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading status…</div>;
  }
  if (state.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger, #B91C1C)' }}>{state.error}</div>
        <BackButton onClick={() => navigate(-1)}/>
      </div>
    );
  }

  const data = state.data;
  const focused = focusStage ? data.stages.find((s) => s.id === focusStage) : null;
  const shown = focused ? [focused] : data.stages;
  const openLegal = () => navigate(bdSiteStatusRoute(siteId));

  // Legal action + negative summary, rendered inside the Legal card's footer.
  const legalAction = (stage) => {
    if (stage.id !== 'legal') return null;
    const negatives = stage.rows.filter((r) => String(r.value).toLowerCase() === 'no').map((r) => r.label);
    if (data.legalHasNegative && negatives.length) {
      return <LegalNegativeBanner negatives={negatives} onOpenLegal={openLegal}/>;
    }
    return (
      <button
        type="button"
        onClick={openLegal}
        style={{
          alignSelf: 'flex-start', height: 34, padding: '0 16px',
          border: '1px solid var(--zm-accent)', borderRadius: 8,
          background: 'var(--zm-accent)', color: '#fff',
          fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 800,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7,
        }}
      >
        <Icon name="shield" size={13}/>
        Open Legal status &amp; flip-to-Yes
      </button>
    );
  };

  const heading = focused ? focused.title : 'Stage status';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <BackButton onClick={() => navigate(-1)}/>

      <PageHeader
        file="No. 08"
        eyebrow={`Site · ${data.siteCode || data.siteId}`}
        title={focused ? heading : <>Stage <em>status</em></>}
        lede={`${data.siteName}${data.city ? ' · ' + data.city : ''} — ${data.headline}`}
        right={<HeaderTag icon="activity" label="READ ONLY"/>}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: focused ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 12,
      }}>
        {shown.map((stage) => (
          <StageCard
            key={stage.id}
            stage={stage}
            focused={Boolean(focused)}
            action={legalAction(stage)}
          />
        ))}
      </div>

      <TimelineCard entries={data.timeline}/>
    </div>
  );
}
