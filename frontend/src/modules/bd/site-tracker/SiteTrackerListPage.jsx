import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { listSites } from '../../../services/api/siteService.js';
import { getSiteTrackerView } from '../../../services/api/siteTrackerApi.js';
import { siteTrackerDetailRoute } from '../../../router/routes.js';
import { normalizeAgreementStatus } from '../../../lib/agreementStatus.js';

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

const PIPELINE_NODES = [
  { id: 'loi',     label: 'BD LOI Signed',       short: 'LOI',     icon: 'file' },
  { id: 'legal',  label: 'Legal & Compliance',  short: 'Legal',   icon: 'shield', interactive: true },
  { id: 'ca',     label: 'CA / Commercial Code', short: 'CA Code', icon: 'rupee' },
  { id: 'design', label: 'Design / Technical',  short: 'Design',  icon: 'grid' },
  { id: 'project', label: 'Project Execution',  short: 'Project', icon: 'box' },
  { id: 'final',  label: 'Final Approval',      short: 'Final',   icon: 'check' },
];

const STATUS_TONES = {
  waiting:  { color: 'var(--zm-fg-3)', border: 'var(--zm-line)', bg: 'var(--zm-surface)', label: 'Waiting' },
  active:   { color: 'var(--zm-accent)', border: 'var(--zm-accent)', bg: 'var(--zm-accent-soft, var(--zm-surface-2))', label: 'In review' },
  complete: { color: 'var(--zm-success, #2D7A48)', border: 'var(--zm-success, #2D7A48)', bg: 'rgba(45,122,72,0.08)', label: 'Complete' },
  rejected: { color: 'var(--zm-danger, #B91C1C)', border: 'var(--zm-danger, #B91C1C)', bg: 'rgba(185,28,28,0.08)', label: 'Rejected' },
  future:   { color: 'var(--zm-fg-4)', border: 'var(--zm-line-faint)', bg: 'var(--zm-surface-2)', label: 'Queued' },
};

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
  return 'waiting';
}

function nodeState(site, nodeId) {
  if (nodeId === 'loi') return 'complete';
  if (nodeId === 'legal') return legalNodeState(site);
  return 'future';
}

function stageCopy(site) {
  const legalState = legalNodeState(site);
  if (legalState === 'rejected') return 'BD notified, legal correction required';
  if (legalState === 'complete') return 'Legal cleared, ready for downstream handoff';
  if (legalState === 'active') return 'Legal team is updating DDR, agreement, or licensing';
  return 'Signed LOI received, awaiting Legal action';
}

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

function PipelineNode({ site, node, onOpenLegal }) {
  const state = nodeState(site, node.id);
  const tone = STATUS_TONES[state] || STATUS_TONES.future;
  const interactive = node.interactive;
  const label = node.id === 'legal' ? tone.label : (node.id === 'loi' ? 'Done' : 'Queued');

  return (
    <button
      type="button"
      onClick={interactive ? () => onOpenLegal(site) : undefined}
      disabled={!interactive}
      title={interactive ? 'Open Legal status' : `${node.label} will be connected in a later module`}
      style={{
        position: 'relative',
        minWidth: 142,
        height: 74,
        padding: '10px 12px',
        borderRadius: 12,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: state === 'future' ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
        cursor: interactive ? 'pointer' : 'default',
        opacity: state === 'future' ? 0.76 : 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        boxShadow: interactive ? 'var(--zm-shadow-1)' : 'none',
        textAlign: 'left',
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

function PipelineRow({ site, onOpenLegal, onOpenDetail }) {
  return (
    <section style={{
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 14,
      boxShadow: 'var(--zm-shadow-1)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 0.72fr) minmax(620px, 1.7fr) 120px',
        gap: 16,
        alignItems: 'center',
        padding: '16px 16px 14px',
      }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
            {site.city || 'City not set'} - {STAGE_LABELS[site.status] || pretty(site.status)}
          </span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>
            {stageCopy(site)}
          </span>
        </div>

        <div style={{ minWidth: 0, overflowX: 'auto', padding: '4px 2px' }}>
          <div style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: `repeat(${PIPELINE_NODES.length}, 142px)`,
            gap: 22,
            width: 'max-content',
            minWidth: '100%',
          }}>
            <div style={{
              position: 'absolute',
              left: 24,
              right: 24,
              top: 37,
              height: 1,
              background: 'linear-gradient(90deg, var(--zm-accent), var(--zm-line) 48%, var(--zm-line-faint))',
              pointerEvents: 'none',
            }}/>
            {PIPELINE_NODES.map((node) => (
              <PipelineNode
                key={node.id}
                site={site}
                node={node}
                onOpenLegal={onOpenLegal}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => onOpenDetail(site)}
            style={{
              height: 34,
              padding: '0 12px',
              border: '1px solid var(--zm-line)',
              borderRadius: 8,
              background: 'var(--zm-bg)',
              color: 'var(--zm-fg)',
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
            Detail <Icon name="arrow" size={12}/>
          </button>
        </div>
      </div>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '10px 16px',
        borderTop: '1px solid var(--zm-line-faint)',
        background: 'var(--zm-surface-2)',
      }}>
        <StatusChip value={site.legalDdStatus}/>
        <StatusChip value={site.agreementStatus}/>
        <StatusChip value={site.licensingStatus}/>
      </div>
    </section>
  );
}

function DetailLine({ label, value }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: 12,
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid var(--zm-line-faint)',
    }}>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>
        {label}
      </span>
      <StatusChip value={value} compact/>
    </div>
  );
}

function legalSummary(data) {
  if (!data) {
    return {
      dd: 'pending',
      agreement: 'pending',
      licensing: 'pending',
      overall: 'pending',
    };
  }
  const dd = data.legalDdStatus || data.dd?.final_verdict || 'pending';
  const agreement = normalizeAgreementStatus(data);
  const licensing = data.licensingStatus || 'pending';
  let overall = 'pending';
  if (data.siteStatus === 'legal_rejected' || dd === 'negative') overall = 'rejected';
  else if (data.siteStatus === 'legal_approved' || data.siteStatus === 'pushed_to_payments') overall = 'complete';
  else if (dd !== 'pending' || agreement !== 'pending' || licensing !== 'pending') overall = 'in_review';
  return { dd, agreement, licensing, overall };
}

function LegalDrawer({ site, state, onClose, onRefresh, onOpenDetail }) {
  if (!site) return null;
  const data = state.data;
  const summary = legalSummary(data);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      justifyContent: 'flex-end',
      background: 'rgba(10, 12, 10, 0.34)',
      backdropFilter: 'blur(2px)',
    }}>
      <button
        type="button"
        aria-label="Close Legal status"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'default',
        }}
      />
      <aside style={{
        position: 'relative',
        width: 'min(460px, calc(100vw - 24px))',
        height: '100%',
        background: 'var(--zm-surface)',
        borderLeft: '1px solid var(--zm-line)',
        boxShadow: '-24px 0 60px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <header style={{
          padding: '18px 18px 14px',
          borderBottom: '1px solid var(--zm-line)',
          background: 'var(--zm-surface-2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--zm-accent)',
                border: '1px solid var(--zm-accent)',
                background: 'var(--zm-accent-soft, transparent)',
                flex: '0 0 auto',
              }}>
                <Icon name="shield" size={17}/>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--zm-fg-3)',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}>
                  Legal & Compliance
                </div>
                <div style={{
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 16,
                  fontWeight: 800,
                  color: 'var(--zm-fg)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {site.name}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Legal status"
              style={{
                width: 32,
                height: 32,
                padding: 0,
                border: '1px solid var(--zm-line)',
                borderRadius: 8,
                background: 'var(--zm-surface)',
                color: 'var(--zm-fg-2)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="x" size={13}/>
            </button>
          </div>
        </header>

        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {state.status === 'loading' && (
            <div style={{ padding: 24, color: 'var(--zm-fg-3)', textAlign: 'center' }}>Loading legal status...</div>
          )}

          {state.status === 'error' && (
            <div style={{
              padding: 14,
              border: '1px solid var(--zm-danger, #B91C1C)',
              borderRadius: 10,
              color: 'var(--zm-danger, #B91C1C)',
              background: 'rgba(185,28,28,0.06)',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 13,
            }}>
              {state.error}
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <section style={{
                border: '1px solid var(--zm-line)',
                borderRadius: 12,
                padding: 14,
                background: 'var(--zm-bg)',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  paddingBottom: 10,
                  borderBottom: '1px solid var(--zm-line-faint)',
                }}>
                  <div>
                    <div style={{
                      fontFamily: 'var(--zm-font-body)',
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--zm-fg-3)',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                    }}>
                      Overall Legal Status
                    </div>
                    <div style={{ marginTop: 3, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>
                      {STAGE_LABELS[data.siteStatus] || pretty(data.siteStatus)}
                    </div>
                  </div>
                  <StatusChip value={summary.overall}/>
                </div>

                <DetailLine label="Due Diligence Status" value={summary.dd}/>
                <DetailLine label="Agreement Generation / Execution" value={summary.agreement}/>
                <DetailLine label="Licenses / Permits Tracking" value={summary.licensing}/>
              </section>

              <section style={{
                border: '1px solid var(--zm-line)',
                borderRadius: 12,
                padding: 14,
                background: 'var(--zm-surface)',
              }}>
                <div style={{
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--zm-fg-3)',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                }}>
                  Source records
                </div>
                <p style={{
                  margin: 0,
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--zm-fg-2)',
                }}>
                  Status is read from the site mirror columns and published Legal rows. Legal users update these values in the Legal module.
                </p>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                  marginTop: 12,
                }}>
                  <StatusSource label="DD row" present={Boolean(data.dd)}/>
                  <StatusSource label="Agreement" present={Boolean(data.agreement)}/>
                  <StatusSource label="Licensing" present={Boolean(data.licensing)}/>
                </div>
              </section>
            </>
          )}
        </div>

        <footer style={{
          marginTop: 'auto',
          padding: 14,
          borderTop: '1px solid var(--zm-line)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          background: 'var(--zm-surface)',
        }}>
          <button
            type="button"
            onClick={onRefresh}
            style={{
              height: 34,
              padding: '0 12px',
              border: '1px solid var(--zm-line)',
              borderRadius: 8,
              background: 'var(--zm-bg)',
              color: 'var(--zm-fg)',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Refresh status
          </button>
          <button
            type="button"
            onClick={() => onOpenDetail(site)}
            style={{
              height: 34,
              padding: '0 12px',
              border: 'none',
              borderRadius: 8,
              background: 'var(--zm-accent)',
              color: '#fff',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            Full flow <Icon name="arrow" size={12}/>
          </button>
        </footer>
      </aside>
    </div>
  );
}

function StatusSource({ label, present }) {
  return (
    <div style={{
      padding: '10px 8px',
      borderRadius: 9,
      border: '1px solid var(--zm-line-faint)',
      background: present ? 'rgba(45,122,72,0.06)' : 'var(--zm-surface-2)',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--zm-font-body)',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: present ? 'var(--zm-success, #2D7A48)' : 'var(--zm-fg-3)',
      }}>
        {present ? 'Present' : 'Pending'}
      </div>
      <div style={{ marginTop: 4, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
        {label}
      </div>
    </div>
  );
}

export default function SiteTrackerListPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [filter, setFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [activeSite, setActiveSite] = React.useState(null);
  const [drawerState, setDrawerState] = React.useState({ status: 'idle', data: null, error: null });

  const loadSites = React.useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], error: null });
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
        setState({
          status: 'error',
          items: [],
          error: err?.detail || err?.message || 'Failed to load sites',
        });
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => loadSites(), [loadSites]);

  const loadLegalStatus = React.useCallback((site) => {
    if (!site?.id) return undefined;
    let cancelled = false;
    setDrawerState({ status: 'loading', data: null, error: null });
    getSiteTrackerView(site.id)
      .then((data) => {
        if (cancelled) return;
        setDrawerState({ status: 'ready', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setDrawerState({
          status: 'error',
          data: null,
          error: err?.detail || err?.message || 'Failed to load legal status',
        });
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!activeSite) return undefined;
    return loadLegalStatus(activeSite);
  }, [activeSite, loadLegalStatus]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow="BD module"
        title={<>Staging Sites <em>flow</em></>}
        lede="Signed LOIs flow through Legal, CA, Design, Project, and Final Approval. Legal status is live from the module records."
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
              onOpenLegal={setActiveSite}
              onOpenDetail={openDetail}
            />
          ))}
        </div>
      )}

      <LegalDrawer
        site={activeSite}
        state={drawerState}
        onClose={() => setActiveSite(null)}
        onRefresh={() => {
          if (activeSite) loadLegalStatus(activeSite);
          loadSites();
        }}
        onOpenDetail={openDetail}
      />
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
