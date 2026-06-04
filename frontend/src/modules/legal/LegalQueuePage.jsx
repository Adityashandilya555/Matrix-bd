import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getLegalQueue, getLegalHistory } from '../../services/api/legalApi.js';
import { listLegalDelegationsForSite } from '../../services/api/legalDelegationApi.js';
import { getSiteActivity, colorForAction, labelForEntry } from '../../services/api/audit.js';
import { legalSiteAgreementRoute, legalSiteDdrRoute, legalSiteLicensingRoute } from '../../router/routes.js';
import { agreementAllowsLicensing, normalizeAgreementStatus } from '../../lib/agreementStatus.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS = {
  pending:   { label: 'Awaiting review',    tone: 'var(--zm-fg-3)' },
  in_review: { label: 'In review',           tone: 'var(--zm-accent)' },
  positive:  { label: 'DD positive',         tone: 'var(--zm-success)' },
  negative:  { label: 'DD negative',         tone: 'var(--zm-danger)' },
};

const STAGE_LABELS = {
  draft:          { label: 'Draft',          tone: 'var(--zm-fg-3)' },
  pending_review: { label: 'Pending review', tone: 'var(--zm-warning, #E0A659)' },
  published:      null,
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

function StagePill({ value }) {
  const meta = STAGE_LABELS[value];
  if (!meta) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
      borderRadius: 4, border: `1px solid ${meta.tone}`, color: meta.tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
      letterSpacing: '0.14em', textTransform: 'uppercase', background: 'transparent',
    }}>
      {meta.label}
    </span>
  );
}

function OutcomePill({ value }) {
  const isApproved = value === 'approved';
  const tone = isApproved ? 'var(--zm-success)' : 'var(--zm-danger)';
  const label = isApproved ? 'Approved' : 'Rejected';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${tone}`, color: tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }}>
      {label}
    </span>
  );
}

// ── History drawer (site activity log) ───────────────────────────────────────

function HistoryDrawer({ site, history, onClose }) {
  if (!site) return null;
  const isRejected = site.outcome === 'rejected';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 120, display: 'flex', justifyContent: 'flex-end',
      background: 'rgba(11,12,16,0.38)', backdropFilter: 'blur(4px)',
      animation: 'zm-fade 160ms var(--zm-ease)',
    }}>
      <aside className="zm-glass" style={{
        width: 440, maxWidth: '94vw', height: '100%',
        borderRadius: 0, borderTop: 'none', borderBottom: 'none', borderRight: 'none',
        background: 'var(--zm-bg)', boxShadow: 'var(--zm-shadow-pop)',
        display: 'flex', flexDirection: 'column',
        animation: 'zm-slide 220ms var(--zm-ease-emp)',
      }}>
        <header style={{
          padding: '18px 20px', borderBottom: '1px solid var(--zm-line)',
          background: 'var(--zm-surface)', display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <span style={{
            width: 38, height: 38, borderRadius: 10,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: isRejected ? 'rgba(185,28,28,0.10)' : 'rgba(22,163,74,0.10)',
            color: isRejected ? 'var(--zm-danger)' : 'var(--zm-success)',
            border: `1px solid ${isRejected ? 'rgba(185,28,28,0.25)' : 'rgba(22,163,74,0.25)'}`,
            flex: '0 0 38px',
          }}>
            <Icon name={isRejected ? 'alert' : 'check'} size={18}/>
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
              {site.siteCode}
            </div>
            <h2 style={{ margin: '4px 0 0', fontFamily: 'var(--zm-font-display)', fontSize: 20, lineHeight: 1.15, color: 'var(--zm-fg)' }}>
              {site.siteName}
            </h2>
            <p style={{ margin: '4px 0 0', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>
              {site.city} · drafted by {site.submittedByName || '—'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close history" style={{
            width: 30, height: 30, borderRadius: 8, border: '1px solid var(--zm-line)',
            background: 'var(--zm-surface)', color: 'var(--zm-fg-2)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <Icon name="x" size={14}/>
          </button>
        </header>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          {/* Outcome summary */}
          <section style={{ border: '1px solid var(--zm-line)', borderRadius: 10, background: 'var(--zm-surface)', overflow: 'hidden' }}>
            <div style={{
              padding: '10px 12px', borderBottom: '1px solid var(--zm-line)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 850, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg)' }}>
                {isRejected ? 'Rejection summary' : 'Approval summary'}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: isRejected ? 'var(--zm-danger)' : 'var(--zm-success)' }}>
                {formatDate(site.outcomeAt)}
              </span>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                DD verdict:{' '}
                <strong style={{ color: isRejected ? 'var(--zm-danger)' : 'var(--zm-success)' }}>
                  {isRejected ? 'Negative' : 'Positive'}
                </strong>
              </div>
              {isRejected && (
                <div style={{
                  padding: 12, borderRadius: 8, background: 'var(--zm-surface-2)',
                  color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 13,
                  lineHeight: 1.5, fontStyle: site.rejectionReason ? 'normal' : 'italic',
                }}>
                  {site.rejectionReason || 'No rejection reason captured.'}
                </div>
              )}
            </div>
          </section>

          {/* Activity timeline */}
          <section style={{ border: '1px solid var(--zm-line)', borderRadius: 10, background: 'var(--zm-surface)', overflow: 'hidden' }}>
            <div style={{
              padding: '10px 12px', borderBottom: '1px solid var(--zm-line)',
              fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 850,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg)',
            }}>
              Activity history
            </div>
            {history.status === 'loading' && (
              <div style={{ padding: 18, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Loading history…</div>
            )}
            {history.status === 'error' && (
              <div style={{ padding: 18, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-danger)' }}>{history.error}</div>
            )}
            {history.status === 'ready' && history.items.length === 0 && (
              <div style={{ padding: 18, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>No activity recorded.</div>
            )}
            {history.status === 'ready' && history.items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {history.items.map((entry) => (
                  <div key={entry.id} style={{
                    display: 'grid', gridTemplateColumns: '12px minmax(0, 1fr)', gap: 10,
                    padding: '12px 14px', borderBottom: '1px solid var(--zm-line-faint)',
                  }}>
                    <span style={{ width: 8, height: 8, marginTop: 5, borderRadius: 999, background: colorForAction(entry.action) }}/>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg)', fontWeight: 650 }}>
                        {labelForEntry(entry)}
                      </span>
                      <span style={{ display: 'block', marginTop: 3, fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>
                        {entry.actor || 'system'} · {formatDate(entry.createdAt)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
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

export default function LegalQueuePage() {
  const navigate = useNavigate();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';

  const [activeTab, setActiveTab] = React.useState('queue');

  // Queue state
  const [queue, setQueue] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [delegateNames, setDelegateNames] = React.useState({});

  // History state
  const [hist, setHist] = React.useState({ status: 'idle', items: [], total: 0, error: null });
  const [activeSite, setActiveSite] = React.useState(null);
  const [siteHistory, setSiteHistory] = React.useState({ status: 'idle', items: [], error: null });

  const loadQueue = React.useCallback(() => {
    let cancelled = false;
    setQueue({ status: 'loading', items: [], total: 0, error: null });
    getLegalQueue()
      .then((data) => { if (!cancelled) setQueue({ status: 'ready', items: data.items, total: data.total, error: null }); })
      .catch((err) => { if (!cancelled) setQueue({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load legal queue' }); });
    return () => { cancelled = true; };
  }, []);

  const loadHistory = React.useCallback(() => {
    let cancelled = false;
    setHist({ status: 'loading', items: [], total: 0, error: null });
    getLegalHistory()
      .then((data) => { if (!cancelled) setHist({ status: 'ready', items: data.items, total: data.total, error: null }); })
      .catch((err) => { if (!cancelled) setHist({ status: 'error', items: [], total: 0, error: err?.detail || err?.message || 'Failed to load history' }); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => loadQueue(), [loadQueue]);
  useSiteDataRefresh(loadQueue);

  // Load history when the tab is first activated
  React.useEffect(() => {
    if (activeTab === 'history' && hist.status === 'idle') loadHistory();
  }, [activeTab, hist.status, loadHistory]);

  // Supervisor: hydrate delegate names for queue rows
  React.useEffect(() => {
    if (!isSupervisor || queue.status !== 'ready' || queue.items.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      await Promise.all(queue.items.map(async (row) => {
        try {
          const r = await listLegalDelegationsForSite(row.siteId);
          if (r.items?.length) updates[row.siteId] = r.items[0].delegateName || r.items[0].delegateEmail;
        } catch { /* silent */ }
      }));
      if (!cancelled && Object.keys(updates).length) setDelegateNames((prev) => ({ ...prev, ...updates }));
    })();
    return () => { cancelled = true; };
  }, [isSupervisor, queue.status, queue.items]);

  const open = (row) => {
    const agreementStatus = normalizeAgreementStatus(row.agreementStatus);
    const target = row.legalDdStatus !== 'positive'
      ? legalSiteDdrRoute(row.siteId)
      : agreementAllowsLicensing(agreementStatus)
        ? legalSiteLicensingRoute(row.siteId)
        : legalSiteAgreementRoute(row.siteId);
    navigate(target);
  };

  const actionLabel = (row) => {
    if (row.legalDdStatus !== 'positive') return 'Open DDR';
    return agreementAllowsLicensing(row.agreementStatus) ? 'Open licensing' : 'Open agreement';
  };

  const openSiteHistory = React.useCallback((site) => {
    setActiveSite(site);
    setSiteHistory({ status: 'loading', items: [], error: null });
    getSiteActivity(site.siteId)
      .then((data) => setSiteHistory({ status: 'ready', items: data.items || [], error: null }))
      .catch((err) => setSiteHistory({ status: 'error', items: [], error: err?.detail || err?.message || 'Failed to load history' }));
  }, []);

  const queueCount = queue.status === 'ready' ? queue.total : null;
  const historyCount = hist.status === 'ready' ? hist.total : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 05"
        eyebrow="Legal module"
        title={<>Legal <em>queue</em></>}
        lede="Sites pushed to legal review. Open a row to start the due-diligence checklist."
        right={<HeaderTag icon="shield" label="LEGAL_REVIEW"/>}
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
          {queue.status === 'loading' && (
            <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
              Loading queue…
            </div>
          )}
          {queue.status === 'error' && (
            <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{queue.error}</div>
          )}
          {queue.status === 'ready' && queue.items.length === 0 && (
            <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
              <Icon name="shield" size={20}/>
              <p style={{ margin: '12px 0 0' }}>No sites are awaiting legal review right now.</p>
            </div>
          )}
          {queue.status === 'ready' && queue.items.length > 0 && (
            <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px 140px',
                gap: 12, padding: '12px 16px',
                background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
                fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
                letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
              }}>
                <span>Code</span>
                <span>Site</span>
                <span>City</span>
                <span>DD status</span>
                <span style={{ textAlign: 'right' }}>Action</span>
              </div>
              {queue.items.map((row) => (
                <div
                  key={row.siteId}
                  onClick={() => open(row)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px 140px',
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
                      {isSupervisor && delegateNames[row.siteId] && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 8px',
                          borderRadius: 4, border: '1px solid var(--zm-accent)', color: 'var(--zm-accent)',
                          fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
                          letterSpacing: '0.12em', textTransform: 'uppercase',
                        }}>
                          Delegated · {delegateNames[row.siteId]}
                        </span>
                      )}
                    </span>
                  </span>
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                    {row.city}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <StatusPill value={row.legalDdStatus}/>
                    <StagePill value={row.ddStage}/>
                  </span>
                  <button
                    type="button"
                    className="zm-btn-primary"
                    onClick={(e) => { e.stopPropagation(); open(row); }}
                    style={{
                      justifySelf: 'end', height: 32, padding: '0 14px',
                      border: 'none', borderRadius: 7,
                      background: 'var(--zm-accent)', color: '#fff',
                      fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {actionLabel(row)}
                    <Icon name="arrow-right" size={12}/>
                  </button>
                </div>
              ))}
            </div>
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
              <Icon name="shield" size={20}/>
              <p style={{ margin: '12px 0 0' }}>No completed legal reviews yet.</p>
            </div>
          )}
          {hist.status === 'ready' && hist.items.length > 0 && (
            <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(220px, 1fr) 140px 130px 200px 110px',
                gap: 12, padding: '12px 16px',
                background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
                fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
                letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
              }}>
                <span>Code</span>
                <span>Site</span>
                <span>City</span>
                <span>Outcome</span>
                <span>Reason / date</span>
                <span style={{ textAlign: 'right' }}>Inspect</span>
              </div>
              {hist.items.map((row) => (
                <div
                  key={row.siteId}
                  onClick={() => openSiteHistory(row)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px minmax(220px, 1fr) 140px 130px 200px 110px',
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
                    {row.siteName}
                  </span>
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                    {row.city}
                  </span>
                  <span><OutcomePill value={row.outcome}/></span>
                  <span style={{
                    fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {row.outcome === 'rejected' && row.rejectionReason
                      ? row.rejectionReason
                      : <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{formatDate(row.outcomeAt)}</span>
                    }
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openSiteHistory(row); }}
                    style={{
                      justifySelf: 'end', height: 30, padding: '0 12px', borderRadius: 7,
                      border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
                      color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 750,
                      display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    }}
                  >
                    <Icon name="clock" size={13}/>
                    Inspect
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <HistoryDrawer
        site={activeSite}
        history={siteHistory}
        onClose={() => setActiveSite(null)}
      />
    </div>
  );
}
