import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getDesignQueue } from '../../services/api/designApi.js';
import { designSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

const STATUS_LABELS = {
  pending:     { label: 'Awaiting allocation', tone: 'var(--zm-fg-3)' },
  allocated:   { label: 'Allocated',           tone: 'var(--zm-info)' },
  in_progress: { label: 'In progress',         tone: 'var(--zm-accent)' },
  gfc_pending: { label: 'Awaiting GFC',        tone: 'var(--zm-copper)' },
  approved:    { label: 'Design approved',     tone: 'var(--zm-success)' },
  rejected:    { label: 'Rejected',            tone: 'var(--zm-danger)' },
};

// Stage-based filter chips shown above the queue table.
// Each chip maps to a `currentStage` value returned by the backend.
const STAGE_FILTERS = [
  { id: 'all',  label: 'All' },
  { id: 'recce', label: 'Recce' },
  { id: '2d',    label: '2D Approved' },  // site is at/past 2d stage
  { id: '3d',    label: '3D Approved' },  // site is at/past 3d stage
  { id: 'boq',   label: 'BOQ Approved' },
  { id: 'gfc',   label: 'GFC Approved' },
];

// Stage ordering so "2D Approved" shows sites where 2d is done (stage ≥ 3d)
const STAGE_ORDER = ['recce', '2d', '3d', 'boq', 'gfc', 'done'];
function stageIndex(s) { return STAGE_ORDER.indexOf(s); }

function matchesStageFilter(row, filterId) {
  if (filterId === 'all') return true;
  const idx = stageIndex(row.currentStage);
  const filterIdx = stageIndex(filterId);
  if (filterId === 'recce') return row.currentStage === 'recce';
  // "2D Approved" means stage has advanced past 2d (currently at 3d or later)
  return idx > filterIdx;
}

const STAGE_LABELS = {
  recce: 'Recce', '2d': '2D', '3d': '3D', boq: 'BOQ', gfc: 'GFC', done: 'Done',
};

function StatusPill({ value }) {
  const meta = STATUS_LABELS[value] || { label: value || 'unknown', tone: 'var(--zm-fg-3)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${meta.tone}`, color: meta.tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }}>
      {meta.label}
    </span>
  );
}

export default function DesignQueuePage() {
  const navigate = useNavigate();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [stageFilter, setStageFilter] = React.useState('all');

  const load = React.useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], total: 0, error: null });
    getDesignQueue()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load design queue' });
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load);

  const open = (row) => navigate(designSiteRoute(row.siteId));

  const COLS = '120px minmax(200px, 1fr) 120px 170px 110px 120px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 06"
        eyebrow="Design module"
        title="Design queue"
        lede={isSupervisor
          ? 'Finance-approved sites. Open a row to allocate it to an executive and review deliverables.'
          : 'Sites allocated to you. Open a row to upload Recce → 2D → 3D → BOQ.'}
        right={<HeaderTag icon="box" label="FINANCE APPROVED"/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading queue…
        </div>
      )}

      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="box" size={20}/>
          <p style={{ margin: '12px 0 0' }}>
            {isSupervisor
              ? 'No finance-approved sites are waiting for design right now. Waiting for Finance admin approval.'
              : 'No sites have been allocated to you yet. Design opens after Finance admin approval.'}
          </p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <>
          {/* Stage filter chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {STAGE_FILTERS.map((f) => {
              const active = stageFilter === f.id;
              const count = f.id === 'all'
                ? state.items.length
                : state.items.filter((r) => matchesStageFilter(r, f.id)).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStageFilter(f.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 30, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
                    background: active ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
                    color: active ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
                    fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
                  }}
                >
                  {f.label}
                  <span style={{
                    fontFamily: 'var(--zm-font-mono)', fontSize: 10.5,
                    color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
                  }}>{count}</span>
                </button>
              );
            })}
          </div>

        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: COLS,
            gap: 12, padding: '12px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Site</span>
            <span>City</span>
            <span>Design status</span>
            <span>Stage</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          {state.items.filter((r) => matchesStageFilter(r, stageFilter)).map((row) => (
            <div
              key={row.siteId}
              onClick={() => open(row)}
              style={{
                display: 'grid', gridTemplateColumns: COLS,
                gap: 12, padding: '14px 16px',
                borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                {row.siteCode}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 700, color: 'var(--zm-fg)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{row.siteName}</span>
                  {isSupervisor && row.allocatedToName && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 8px',
                      borderRadius: 4, border: '1px solid var(--zm-accent)', color: 'var(--zm-accent)',
                      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
                      letterSpacing: '0.12em', textTransform: 'uppercase',
                    }}>
                      {row.allocatedToName}
                    </span>
                  )}
                </span>
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                {row.city}
              </span>
              <span><StatusPill value={row.designStatus}/></span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                {STAGE_LABELS[row.currentStage] || '—'}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open(row); }}
                style={{
                  justifySelf: 'end', height: 32, padding: '0 14px',
                  border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                Open<Icon name="arrow-right" size={12}/>
              </button>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
