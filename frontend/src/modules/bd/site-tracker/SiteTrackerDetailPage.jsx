import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { getSiteTrackerView } from '../../../services/api/siteTrackerApi.js';
import { bdSiteFinanceRoute, bdSiteStagesRoute } from '../../../router/routes.js';
import { agreementStatusLabel, normalizeAgreementStatus } from '../../../lib/agreementStatus.js';
import { useSiteDataRefresh } from '../../../hooks/useSiteDataRefresh.js';

// LOI-forward hand-over graph. Every node is clickable: CA opens the finance
// workflow page; all others open that department's focused read-only detail page.
const NODES = [
  { id: 'loi',        label: 'BD LOI Signed',        icon: 'file',   interactive: true },
  { id: 'legal',      label: 'Legal & Compliance',   icon: 'shield', interactive: true },
  { id: 'ca',         label: 'CA / Commercial Code', icon: 'rupee',  interactive: true },
  { id: 'design',     label: 'Design / Technical',   icon: 'grid',   interactive: true },
  { id: 'excellence', label: 'Project Excellence',   icon: 'trend',  interactive: true },
  { id: 'project',    label: 'Project Execution',    icon: 'box',    interactive: true },
  { id: 'nso',        label: 'NSO',                  icon: 'home',   interactive: true },
  { id: 'launch',     label: 'Site Launched',        icon: 'flag',   interactive: true },
];

const NODE_TONES = {
  complete: {
    bg: 'var(--zm-success-soft, rgba(45,122,72,0.08))',
    border: 'var(--zm-success, #2D7A48)',
    color: 'var(--zm-success, #2D7A48)',
  },
  active: {
    bg: 'var(--zm-warning-soft, #F8EEDC)',
    border: 'var(--zm-warning, #B0712E)',
    color: 'var(--zm-warning, #B0712E)',
  },
  future: {
    bg: 'rgba(255,255,255,0.56)',
    border: 'var(--zm-line-faint)',
    color: 'var(--zm-fg-4)',
  },
};

const ACTIVE_PROJECT_STATUSES = new Set(['pending', 'allocated', 'budgeting', 'in_progress']);

function verdictTone(verdict) {
  if (verdict === 'positive') return { color: 'var(--zm-success, #2D7A48)', label: 'POSITIVE' };
  if (verdict === 'negative') return { color: 'var(--zm-danger,  #B91C1C)', label: 'NEGATIVE' };
  return { color: 'var(--zm-fg-3)', label: 'PENDING' };
}

function NodeCard({ node, selected, onClick, state, statusOverride }) {
  const tone = NODE_TONES[state] || NODE_TONES.future;
  const greyed = state === 'future';
  const defaultLabel =
    state === 'complete' ? (node.id === 'loi' ? 'DONE' : 'COMPLETE') :
    state === 'active' ? (['ca', 'excellence', 'project', 'nso', 'launch'].includes(node.id) ? 'PENDING' : 'OPEN') :
    'QUEUED';
  const statusLabel = statusOverride?.label ?? defaultLabel;
  const statusColor = statusOverride?.color ?? tone.color;
  return (
    <button
      type="button"
      onClick={node.interactive ? onClick : undefined}
      disabled={!node.interactive}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 10px', minWidth: 120,
        borderRadius: 12,
        border: '1px solid ' + (selected ? tone.border : tone.border),
        background: tone.bg,
        color: greyed ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
        cursor: node.interactive ? 'pointer' : 'default',
        opacity: greyed ? 0.7 : 1,
        boxShadow: selected ? '0 0 0 2px rgba(14,91,69,0.12), var(--zm-shadow-1)' : 'none',
        textDecoration: 'none',
      }}
    >
      <span style={{ color: tone.color }}>
        <Icon name={node.icon} size={20}/>
      </span>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        textDecoration: 'none',
      }}>{node.label}</span>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 600,
        color: statusColor,
      }}>
        {statusLabel}
      </span>
    </button>
  );
}

function financeStatusOverride(financeStatus) {
  if (financeStatus === 'approved')
    return { label: 'DONE', color: 'var(--zm-success, #2D7A48)' };
  if (financeStatus === 'awaiting_admin' || financeStatus === 'awaiting_supervisor')
    return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  return null; // default 'OPEN'
}

function projectStatusOverride(data) {
  const projectStatus = data?.projectStatus;
  if (projectStatus === 'done') return { label: 'DONE', color: 'var(--zm-success, #2D7A48)' };
  if (data?.designStatus === 'approved' && (ACTIVE_PROJECT_STATUSES.has(projectStatus) || !projectStatus)) {
    return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  }
  return null;
}

function nsoStatusOverride(data) {
  if (data?.nsoStatus === 'complete') return { label: 'DONE', color: 'var(--zm-success, #2D7A48)' };
  if (data?.projectStatus === 'done') return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  return null;
}

function launchStatusOverride(data) {
  if (data?.isLaunched || data?.launchStatus === 'launched') {
    return { label: 'LAUNCHED', color: 'var(--zm-success, #2D7A48)' };
  }
  if (data?.nsoStatus === 'complete') return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  return null;
}

function legalNodeState(data) {
  if (data.siteStatus === 'legal_rejected' || data.legalDdStatus === 'negative') return 'rejected';
  if (
    data.siteStatus === 'legal_approved' ||
    data.siteStatus === 'pushed_to_payments' ||
    (data.legalDdStatus === 'positive' && normalizeAgreementStatus(data) === 'registered' && data.licensingStatus === 'complete')
  ) {
    return 'complete';
  }
  return 'active';
}

function detailNodeState(data, nodeId) {
  if (nodeId === 'loi') return 'complete';
  if (nodeId === 'legal') return legalNodeState(data) === 'rejected' ? 'active' : legalNodeState(data);
  if (nodeId === 'ca') {
    if (data.financeStatus === 'approved' || data.siteStatus === 'pushed_to_payments') return 'complete';
    if (legalNodeState(data) === 'complete') return 'active';
  }
  if (nodeId === 'design') {
    if (data.designStatus === 'approved') return 'complete';
    if (data.financeStatus === 'approved' && data.siteStatus === 'pushed_to_payments') return 'active';
  }
  if (nodeId === 'excellence') {
    if (data.designStatus === 'approved') {
      return data.projectStatus === 'done' ? 'complete' : 'active';
    }
  }
  if (nodeId === 'project') {
    if (data.projectStatus === 'done') return 'complete';
    if (data.designStatus === 'approved') {
      if (!data.projectStatus || ACTIVE_PROJECT_STATUSES.has(data.projectStatus)) return 'active';
    }
  }
  if (nodeId === 'nso') {
    if (data.nsoStatus === 'complete') return 'complete';
    if (data.projectStatus === 'done') return 'active';
  }
  if (nodeId === 'launch') {
    if (data.isLaunched || data.launchStatus === 'launched') return 'complete';
    if (data.nsoStatus === 'complete') return 'active';
  }
  return 'future';
}

function NodeConnector({ complete }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 20,
        height: 2,
        flex: '0 0 20px',
        borderRadius: 999,
        background: complete ? 'var(--zm-success, #2D7A48)' : 'var(--zm-line)',
        opacity: complete ? 0.62 : 0.78,
      }}
    />
  );
}

function NodeDiagram({ selected, onSelect, data }) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, padding: '24px 16px',
      overflowX: 'auto',
    }}>
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: 1200,
      }}>
        {NODES.map((n, index) => {
          const state = detailNodeState(data, n.id);
          const prev = index > 0 ? detailNodeState(data, NODES[index - 1].id) : null;
          return (
            <React.Fragment key={n.id}>
              {index > 0 && <NodeConnector complete={prev === 'complete' && (state === 'complete' || state === 'active')}/>}
              <NodeCard
                node={n}
                selected={selected === n.id}
                onClick={() => onSelect(n.id)}
                state={state}
                statusOverride={
                  n.id === 'ca'
                    ? financeStatusOverride(data.financeStatus)
                    : n.id === 'project'
                      ? projectStatusOverride(data)
                      : n.id === 'nso'
                        ? nsoStatusOverride(data)
                        : n.id === 'launch'
                          ? launchStatusOverride(data)
                          : undefined
                }
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function SiteTrackerDetailPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });

  const load = React.useCallback((silent = false) => {
    if (!siteId) return;
    if (!silent) setState((s) => ({ ...s, status: 'loading' }));
    getSiteTrackerView(siteId)
      .then((data) => { if (!cancelledRef.current) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelledRef.current) setState({
        status: 'error', data: null,
        error: err?.detail || err?.message || 'Failed to load site flow',
      }); });
  }, [siteId]);

  const cancelledRef = React.useRef(false);
  React.useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => { cancelledRef.current = true; };
  }, [load]);
  useSiteDataRefresh(React.useCallback(() => load(true), [load]), { siteId });

  if (state.status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading…</div>;
  }
  if (state.status === 'error') {
    return <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger, #B91C1C)' }}>{state.error}</div>;
  }

  const data = state.data;
  const verdict = verdictTone(data.dd?.final_verdict);
  // Use CA code as the display identifier once it's set
  const displayCode = data.caCode || data.siteCode || data.siteId;

  // CA opens the finance workflow page; every other node opens that department's
  // focused detail page (the content column swaps, like the Site status page).
  const handleNodeSelect = (nodeId) => {
    if (nodeId === 'ca') { navigate(bdSiteFinanceRoute(siteId)); return; }
    navigate(bdSiteStagesRoute(siteId, nodeId));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow={`Site · ${displayCode}`}
        title={`${data.siteName} flow`}
        lede={`${data.city}${data.submittedByName ? ' · drafted by ' + data.submittedByName : ''}`}
        right={<HeaderTag icon="shield" label={`DD ${verdict.label}`}/>}
      />

      <NodeDiagram
        selected={null}
        onSelect={handleNodeSelect}
        data={data}
      />

      <div>
        <div style={{ minWidth: 0 }}>
          <div className="zm-glass" style={{
            padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8,
            border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
          }}>
            <div style={{
              fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
            }}>
              Mirror columns (read-only)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Legal DD</div>
                <div style={{ fontWeight: 700 }}>{data.legalDdStatus || 'pending'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Agreement</div>
                <div style={{ fontWeight: 700 }}>{agreementStatusLabel(normalizeAgreementStatus(data))}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Licensing</div>
                <div style={{ fontWeight: 700 }}>{data.licensingStatus || 'pending'}</div>
              </div>
            </div>
            {data.caCode && (
              <div style={{
                marginTop: 4, padding: '6px 10px', borderRadius: 6,
                background: 'rgba(45,122,72,0.07)', border: '1px solid var(--zm-success, #2D7A48)',
                fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-success, #2D7A48)',
              }}>
                CA code active: <strong>{data.caCode}</strong>
                {' '}— site is tracked as this code across all modules.
              </div>
            )}
            <p style={{ margin: 0, fontSize: 12, color: 'var(--zm-fg-3)' }}>
              Click any <strong>stage node</strong> above to open its detail —
              Legal (DD &amp; flip-to-Yes), CA / Commercial Code (finance workflow),
              Design, Project Excellence, Project Execution, NSO and Launch.
            </p>
          </div>
        </div>

      </div>

      <div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            height: 32, padding: '0 14px', border: '1px solid var(--zm-line)',
            borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg)',
            fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ← Back to flow
        </button>
      </div>
    </div>
  );
}
