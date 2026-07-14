import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { listSites } from '../../../services/api/siteService.js';
import { siteTrackerDetailRoute } from '../../../router/routes.js';
import { useSiteDataRefresh } from '../../../hooks/useSiteDataRefresh.js';
import StageStatusModal from '../../shared/stage-status/StageStatusModal.jsx';

// A site becomes a staging tracker item as soon as BD uploads the signed LOI.
// Legal owns the editable checklist data; this BD surface reads the live mirror
// columns and published legal child rows.
//
// LEGAL_REJECTED is intentionally NOT tracked here — rejected sites live in
// the "Due diligence failed" view (DdFailedPage). A site that recovers from
// rejection (negative → positive via PR #29's auto-recovery) automatically
// reappears in this list because its status transitions back to LEGAL_REVIEW
// and its legal_dd_status flips to 'positive'.
const TRACKED_STATUSES = [
  'loi_uploaded',
  'legal_review',
  'legal_approved',
  'pushed_to_payments',
];

const FILTERS = [
  { key: 'all',                 label: 'All sites' },
  { key: 'loi_uploaded',        label: 'LOI signed' },
  { key: 'legal_review',        label: 'Legal review' },
  { key: 'legal_approved',      label: 'Legal cleared' },
  { key: 'pushed_to_payments',  label: 'Payments handoff' },
];

const STAGE_LABELS = {
  loi_uploaded:       'LOI signed',
  legal_review:       'Legal review',
  legal_approved:     'Legal cleared',
  pushed_to_payments: 'Payments handoff',
};

// Every node is clickable — clicking opens the read-only stage-status popup
// focused on that stage, so BD can see what each downstream module has done
// (recce/2D/3D/BOQ, quality audit, licences) the same way they see Legal.
const PIPELINE_NODES = [
  { id: 'loi',     label: 'BD LOI Signed',       short: 'LOI',     icon: 'file' },
  { id: 'legal',  label: 'Legal & Compliance',  short: 'Legal',   icon: 'shield' },
  { id: 'ca',     label: 'CA / Commercial Code', short: 'CA Code', icon: 'rupee' },
  { id: 'design', label: 'Design / Technical',  short: 'Design',  icon: 'grid' },
  { id: 'project', label: 'Project Execution',  short: 'Project', icon: 'box' },
  { id: 'nso',    label: 'NSO',                 short: 'NSO',     icon: 'home' },
  { id: 'launch', label: 'Site Launched',       short: 'Launch',  icon: 'flag' },
];

const PIPELINE_NODE_WIDTH = 142;
const PIPELINE_CONNECTOR_WIDTH = 22;

const STATUS_TONES = {
  waiting:  { color: 'var(--zm-warning, #B0712E)', border: 'var(--zm-warning, #B0712E)', bg: 'var(--zm-warning-soft, #F8EEDC)', label: 'Open' },
  active:   { color: 'var(--zm-warning, #B0712E)', border: 'var(--zm-warning, #B0712E)', bg: 'var(--zm-warning-soft, #F8EEDC)', label: 'Open' },
  complete: { color: 'var(--zm-success, #2D7A48)', border: 'var(--zm-success, #2D7A48)', bg: 'var(--zm-success-soft, rgba(45,122,72,0.08))', label: 'Complete' },
  rejected: { color: 'var(--zm-danger, #B91C1C)', border: 'var(--zm-danger, #B91C1C)', bg: 'rgba(185,28,28,0.08)', label: 'Rejected' },
  future:   { color: 'var(--zm-fg-4)', border: 'var(--zm-line-faint)', bg: 'rgba(255,255,255,0.56)', label: 'Queued' },
};

const ACTIVE_PROJECT_STATUSES = new Set(['pending', 'allocated', 'budgeting', 'in_progress']);

function pretty(value) {
  if (!value) return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusTone(value) {
  const displayValue = value === 'signed' ? 'executed' : value;
  if (!displayValue || displayValue === 'pending') return { color: 'var(--zm-fg-3)', label: 'Pending' };
  if (['positive', 'complete', 'executed', 'registered', 'yes'].includes(displayValue)) {
    return { color: 'var(--zm-success, #2D7A48)', label: pretty(displayValue) };
  }
  if (['negative', 'rejected', 'no'].includes(displayValue)) {
    return { color: 'var(--zm-danger, #B91C1C)', label: pretty(displayValue) };
  }
  return { color: 'var(--zm-accent)', label: pretty(displayValue) };
}

function legalNodeState(site) {
  if (site.status === 'legal_rejected' || site.legalDdStatus === 'negative') return 'rejected';
  if (
    site.status === 'legal_approved' ||
    site.status === 'pushed_to_payments' ||
    (site.legalDdStatus === 'positive' && site.agreementStatus === 'registered' && site.licensingStatus === 'complete')
  ) {
    return 'complete';
  }
  if (
    site.status === 'legal_review' ||
    site.legalDdStatus === 'in_review' ||
    site.legalDdStatus === 'positive' ||
    site.agreementStatus === 'signed' ||
    site.agreementStatus === 'executed' ||
    site.agreementStatus === 'registered' ||
    site.licensingStatus === 'partial'
  ) {
    return 'active';
  }
  return 'active';
}

function nodeState(site, nodeId) {
  if (nodeId === 'loi') return 'complete';
  if (nodeId === 'legal') return legalNodeState(site);
  if (nodeId === 'ca') {
    if (site.financeStatus === 'approved' || site.status === 'pushed_to_payments') return 'complete';
    if (legalNodeState(site) === 'complete') return 'active';
  }
  if (nodeId === 'design') {
    if (site.designStatus === 'approved') return 'complete';
    if (site.financeStatus === 'approved' && site.status === 'pushed_to_payments') return 'active';
  }
  if (nodeId === 'project') {
    if (site.projectStatus === 'done') return 'complete';
    if (site.designStatus === 'approved') {
      if (!site.projectStatus || ACTIVE_PROJECT_STATUSES.has(site.projectStatus)) return 'active';
    }
  }
  if (nodeId === 'nso') {
    if (site.nsoStatus === 'complete') return 'complete';
    if (site.projectStatus === 'done') return 'active';
  }
  if (nodeId === 'launch') {
    if (site.isLaunched || site.launchStatus === 'launched') return 'complete';
    if (site.nsoStatus === 'complete') return 'active';
  }
  return 'future';
}

// The stage narrative ("Design approved, Project Execution is active", etc.) is
// now computed server-side as the stage-status `headline` and shown in the
// View-status popup, so it no longer renders inline on the row.

function StatusChip({ value, compact = false }) {
  const t = statusTone(value);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: compact ? 20 : 22,
      padding: compact ? '0 7px' : '0 8px',
      borderRadius: 999,
      border: `1px solid ${t.color}`,
      color: t.color,
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 800,
      fontSize: compact ? 10 : 10.5,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {t.label}
    </span>
  );
}

function FilterBar({ filter, setFilter, query, setQuery }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 10,
      padding: 14,
      alignItems: 'center',
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      boxShadow: 'var(--zm-shadow-1)',
    }}>
      <div style={{ position: 'relative', minWidth: 240, flex: '1 1 260px' }}>
        <Icon name="search" size={13} style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--zm-fg-3)',
          pointerEvents: 'none',
        }}/>
        <input
          placeholder="Search by name, code or city..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            height: 36,
            padding: '0 10px 0 32px',
            background: 'var(--zm-bg)',
            border: '1px solid var(--zm-line)',
            borderRadius: 6,
            fontFamily: 'var(--zm-font-body)',
            fontSize: 13,
            color: 'var(--zm-fg)',
            outline: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 999,
                border: '1px solid ' + (on ? 'var(--zm-accent)' : 'var(--zm-line)'),
                background: on ? 'var(--zm-accent-soft, var(--zm-surface-2))' : 'var(--zm-surface)',
                color: on ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
                fontFamily: 'var(--zm-font-body)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PipelineNode({ site, node, onOpenStage }) {
  const state = nodeState(site, node.id);
  const tone = STATUS_TONES[state] || STATUS_TONES.future;
  const label =
    state === 'complete' ? (node.id === 'loi' ? 'Done' : 'Complete') :
    state === 'active' ? (['ca', 'project', 'nso', 'launch'].includes(node.id) ? 'Pending' : 'Open') :
    state === 'rejected' ? 'Rejected' :
    'Queued';

  return (
    <button
      type="button"
      onClick={() => onOpenStage(site, node.id)}
      title={`View ${node.label} status`}
      style={{
        position: 'relative',
        zIndex: 2,
        minWidth: PIPELINE_NODE_WIDTH,
        height: 74,
        padding: '10px 12px',
        borderRadius: 12,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: state === 'future' ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
        cursor: 'pointer',
        opacity: state === 'future' ? 0.82 : 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        boxShadow: 'var(--zm-shadow-1)',
        textAlign: 'left',
        textDecoration: 'none',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ color: tone.color, display: 'inline-flex', flex: '0 0 auto' }}>
          <Icon name={node.icon} size={15}/>
        </span>
        <span style={{
          fontFamily: 'var(--zm-font-body)',
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textDecoration: 'none',
        }}>
          {node.short}
        </span>
      </span>
      <span style={{
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12,
        fontWeight: 700,
        color: state === 'future' ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
        lineHeight: 1.2,
        textDecoration: 'none',
      }}>
        {node.label}
      </span>
      <span style={{
        fontFamily: 'var(--zm-font-mono)',
        fontSize: 10,
        color: tone.color,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
    </button>
  );
}

function PipelineConnector({ from, to }) {
  const fromState = nodeState(from.site, from.node.id);
  const toState = nodeState(to.site, to.node.id);
  const done = fromState === 'complete' && (toState === 'complete' || toState === 'active');
  return (
    <span
      aria-hidden="true"
      style={{
        width: PIPELINE_CONNECTOR_WIDTH,
        height: 2,
        borderRadius: 999,
        background: done ? 'var(--zm-success, #2D7A48)' : 'var(--zm-line)',
        opacity: done ? 0.62 : 0.8,
        flex: `0 0 ${PIPELINE_CONNECTOR_WIDTH}px`,
      }}
    />
  );
}

function FooterButton({ onClick, icon, children, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 34,
        padding: '0 14px',
        border: primary ? '1px solid var(--zm-accent)' : '1px solid var(--zm-line)',
        borderRadius: 8,
        background: primary ? 'var(--zm-accent-soft, var(--zm-surface-2))' : 'var(--zm-surface)',
        color: primary ? 'var(--zm-accent)' : 'var(--zm-fg)',
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12,
        fontWeight: 800,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
      }}
    >
      {icon && <Icon name={icon} size={12}/>}
      {children}
    </button>
  );
}

function PipelineRow({ site, onOpenStage, onOpenDetail }) {
  return (
    <section style={{
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 14,
      boxShadow: 'var(--zm-shadow-1)',
      overflow: 'hidden',
    }}>
      {/* Header: identity only. The stage narrative now lives in the View-status popup. */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        flexWrap: 'wrap',
        padding: '14px 16px 10px',
      }}>
        <span style={{
          fontFamily: 'var(--zm-font-mono)',
          fontSize: 11,
          color: 'var(--zm-fg-3)',
          letterSpacing: '0.06em',
        }}>
          {site.code || site.id}
        </span>
        <span style={{
          fontFamily: 'var(--zm-font-body)',
          fontSize: 15,
          fontWeight: 800,
          color: 'var(--zm-fg)',
          lineHeight: 1.2,
        }}>
          {site.name}
        </span>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
          {site.city || 'City not set'} · {STAGE_LABELS[site.status] || pretty(site.status)}
        </span>
      </div>

      {/* Pipeline — full width, scrolls horizontally without clipping any control. */}
      <div style={{ minWidth: 0, overflowX: 'auto', padding: '4px 16px 12px' }}>
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: 'max-content',
          minWidth: '100%',
        }}>
          {PIPELINE_NODES.map((node, index) => (
            <React.Fragment key={node.id}>
              {index > 0 && (
                <PipelineConnector
                  from={{ site, node: PIPELINE_NODES[index - 1] }}
                  to={{ site, node }}
                />
              )}
              <PipelineNode
                site={site}
                node={node}
                onOpenStage={onOpenStage}
              />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Footer: status chips on the left, actions pinned bottom-right. */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        rowGap: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderTop: '1px solid var(--zm-line-faint)',
        background: 'var(--zm-surface-2)',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <StatusChip value={site.legalDdStatus}/>
          <StatusChip value={site.agreementStatus}/>
          <StatusChip value={site.licensingStatus}/>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <FooterButton onClick={() => onOpenStage(site, null)} icon="activity" primary>
            View status
          </FooterButton>
          <FooterButton onClick={() => onOpenDetail(site)} icon="arrow">
            Detail
          </FooterButton>
        </div>
      </div>
    </section>
  );
}

export default function SiteTrackerListPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [filter, setFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');
  // Read-only stage-status popup: { siteId, focusStage }.
  const [statusView, setStatusView] = React.useState(null);

  const loadSites = React.useCallback((silent = false) => {
    let cancelled = false;
    if (!silent) setState({ status: 'loading', items: [], error: null });
    Promise.all(TRACKED_STATUSES.map((s) =>
      listSites({ status: s }).catch(() => []),
    ))
      .then((groups) => {
        if (cancelled) return;
        const seen = new Set();
        const merged = [];
        for (const group of groups) {
          for (const row of group || []) {
            if (!row || seen.has(row.id)) continue;
            // Defensive: even if a site somehow has status in TRACKED_STATUSES
            // but legal_dd_status === 'negative' (e.g. row mid-recovery from
            // a stale mirror column), keep it out of the staging tracker. The
            // failed-DDR queue owns negative-verdict sites.
            if (row.legalDdStatus === 'negative') continue;
            seen.add(row.id);
            merged.push(row);
          }
        }
        setState({ status: 'ready', items: merged, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        if (silent && err?.code === 'TIMEOUT') return;
        setState((s) => ({
          status: (silent && s.items.length) ? 'ready' : 'error',
          items: (silent && s.items.length) ? s.items : [],
          error: err?.detail || err?.message || 'Failed to load sites',
        }));
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => loadSites(), [loadSites]);

  useSiteDataRefresh(React.useCallback((silent) => {
    loadSites(silent);
  }, [loadSites]));

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.items.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!q) return true;
      const hay = [s.name, s.code, s.city, STAGE_LABELS[s.status]].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [state.items, filter, query]);

  const counts = React.useMemo(() => {
    const base = { all: state.items.length };
    for (const s of TRACKED_STATUSES) base[s] = 0;
    for (const item of state.items) {
      if (base[item.status] != null) base[item.status] += 1;
    }
    return base;
  }, [state.items]);

  const openDetail = React.useCallback((site) => {
    navigate(siteTrackerDetailRoute(site.id));
  }, [navigate]);

  // Any pipeline node — and the footer "View status" button — opens the same
  // read-only stage-status popup. A null focusStage shows the full flow.
  const openStage = React.useCallback((site, focusStage) => {
    setStatusView({ siteId: site.id, focusStage });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow="BD module"
        title="Process flow"
        right={<HeaderTag icon="activity" label={`${filtered.length} IN FLOW`}/>}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))',
        gap: 10,
      }}>
        <Metric label="LOI signed" value={counts.loi_uploaded || 0}/>
        <Metric label="Legal review" value={counts.legal_review || 0}/>
        <Metric label="Legal cleared" value={counts.legal_approved || 0}/>
        <Metric label="Payments handoff" value={counts.pushed_to_payments || 0}/>
      </div>

      <FilterBar
        filter={filter}
        setFilter={setFilter}
        query={query}
        setQuery={setQuery}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading...
        </div>
      )}

      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger, #B91C1C)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && filtered.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="activity" size={20}/>
          <p style={{ margin: '12px 0 0' }}>No LOI-stage sites match these filters.</p>
        </div>
      )}

      {state.status === 'ready' && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((site) => (
            <PipelineRow
              key={site.id}
              site={site}
              onOpenStage={openStage}
              onOpenDetail={openDetail}
            />
          ))}
        </div>
      )}

      {statusView && (
        <StageStatusModal
          siteId={statusView.siteId}
          focusStage={statusView.focusStage}
          onClose={() => setStatusView(null)}
        />
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{
      minWidth: 0,
      padding: '12px 14px',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      background: 'var(--zm-surface)',
      boxShadow: 'var(--zm-shadow-1)',
    }}>
      <div style={{
        fontFamily: 'var(--zm-font-body)',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.13em',
        textTransform: 'uppercase',
        color: 'var(--zm-fg-3)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <div style={{
        marginTop: 5,
        fontFamily: 'var(--zm-font-mono)',
        fontSize: 24,
        fontWeight: 700,
        color: 'var(--zm-fg)',
        lineHeight: 1,
      }}>
        {String(value).padStart(2, '0')}
      </div>
    </div>
  );
}
