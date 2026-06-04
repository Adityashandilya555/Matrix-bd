import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getDesignQueue, getDesignHistory } from '../../services/api/designApi.js';
import { designSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS = {
  pending:     { label: 'Awaiting allocation', tone: 'var(--zm-fg-3)' },
  allocated:   { label: 'Allocated',           tone: 'var(--zm-info)' },
  in_progress: { label: 'In progress',         tone: 'var(--zm-accent)' },
  gfc_pending: { label: 'Awaiting GFC',        tone: 'var(--zm-copper)' },
  approved:    { label: 'Design approved',     tone: 'var(--zm-success)' },
  rejected:    { label: 'Rejected',            tone: 'var(--zm-danger)' },
};

// Stage-based filter chips shown above the queue table.
const STAGE_FILTERS = [
  { id: 'all',  label: 'All' },
  { id: 'recce', label: 'Recce' },
  { id: '2d',    label: '2D Approved' },
  { id: '3d',    label: '3D Approved' },
  { id: 'boq',   label: 'BOQ Approved' },
  { id: 'gfc',   label: 'GFC Approved' },
];

const STAGE_ORDER = ['recce', '2d', '3d', 'boq', 'gfc', 'done'];
function stageIndex(s) { return STAGE_ORDER.indexOf(s); }

function matchesStageFilter(row, filterId) {
  if (filterId === 'all') return true;
  const idx = stageIndex(row.currentStage);
  const filterIdx = stageIndex(filterId);
  if (filterId === 'recce') return row.currentStage === 'recce';
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

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ active, onChange, queueCount, historyCount }) {
  const tabs = [
    { id: 'queue',   label: 'Queue',   count: queueCount },
    { id: 'history', label: 'History', count: historyCount },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--zm-line)', marginBottom: 4 }}>
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 38, padding: '0 16px',
              border: 'none', borderBottom: `2px solid ${isActive ? 'var(--zm-accent)' : 'transparent'}`,
              background: 'transparent',
              color: isActive ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
              fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: isActive ? 700 : 500,
              cursor: 'pointer', marginBottom: -1,
              transition: 'color 160ms, border-color 160ms',
            }}
          >
            {t.label}
            {t.count != null && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                height: 18, minWidth: 18, padding: '0 5px', borderRadius: 999,
                background: isActive ? 'var(--zm-accent-soft)' : 'var(--zm-surface-2)',
                color: isActive ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
                fontFamily: 'var(--zm-font-mono)', fontSize: 10, fontWeight: 700,
              }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DesignQueuePage() {
  const navigate = useNavigate();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';

  const [activeTab, setActiveTab] = React.useState('queue');
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [stageFilter, setStageFilter] = React.useState('all');
  const [hist, setHist] = React.useState({ status: 'idle', items: [], total: 0, error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], total: 0, error: null });
    getDesignQueue()
      .then((data) => { if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load design queue' }); });
    return () => { cancelled = true; };
  }, []);

  const loadHistory = React.useCallback(() => {
    let cancelled = false;
    setHist({ status: 'loading', items: [], total: 0, error: null });
    getDesignHistory()
      .then((data) => { if (!cancelled) setHist({ status: 'ready', items: data.items, total: data.total, error: null }); })
      .catch((err) => { if (!cancelled) setHist({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load design history' }); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load);

  React.useEffect(() => {
    if (activeTab === 'history' && hist.status === 'idle') loadHistory();
  }, [activeTab, hist.status, loadHistory]);

  const open = (row) => navigate(designSiteRoute(row.siteId));

  const COLS = '120px minmax(200px, 1fr) 120px 170px 110px 120px';
  const HIST_COLS = '120px minmax(200px, 1fr) 140px 170px';

  const queueCount = state.status === 'ready' ? state.total : null;
  const historyCount = hist.status === 'ready' ? hist.total : null;

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

      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        queueCount={queueCount}
        historyCount={historyCount}
      />

      {/* ── Queue tab ── */}
      {activeTab === 'queue' && (
        <>
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
                      borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer', alignItems: 'center',
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
        </>
      )}

      {/* ── History tab ── */}
      {activeTab === 'history' && (
        <>
          {hist.status === 'loading' && (
            <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
              Loading history…
            </div>
          )}
          {hist.status === 'error' && (
            <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{hist.error}</div>
          )}
          {hist.status === 'ready' && hist.items.length === 0 && (
            <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)', borderRadius: 12 }}>
              <Icon name="box" size={20}/>
              <p style={{ margin: '12px 0 0' }}>No design-approved sites yet.</p>
            </div>
          )}
          {hist.status === 'ready' && hist.items.length > 0 && (
            <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: HIST_COLS,
                gap: 12, padding: '12px 16px',
                background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
                fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
                letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
              }}>
                <span>Code</span>
                <span>Site</span>
                <span>City</span>
                <span>Design approved</span>
              </div>
              {hist.items.map((row) => (
                <div
                  key={row.siteId}
                  style={{
                    display: 'grid', gridTemplateColumns: HIST_COLS,
                    gap: 12, padding: '14px 16px',
                    borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'center',
                  }}
                >
                  <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                    {row.siteCode}
                  </span>
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 700, color: 'var(--zm-fg)' }}>
                    {row.siteName}
                    {row.submittedByName && (
                      <span style={{
                        display: 'block', marginTop: 2,
                        fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 500,
                        color: 'var(--zm-fg-3)',
                      }}>
                        by {row.submittedByName}
                      </span>
                    )}
                  </span>
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                    {row.city}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
                      borderRadius: 4, border: '1px solid var(--zm-success)', color: 'var(--zm-success)',
                      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
                      letterSpacing: '0.14em', textTransform: 'uppercase',
                    }}>
                      Approved
                    </span>
                    <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>
                      {formatDate(row.designApprovedAt)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
