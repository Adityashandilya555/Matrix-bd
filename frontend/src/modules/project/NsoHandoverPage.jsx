// skipcq: JS-0833
import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { usePageContext } from '../../App.jsx';
import { ROUTES } from '../../router/routes.js';
import {
  getNsoHandoverQueue,
  pushToNso,
  getQAReports,
  markQAReportsViewed,
} from '../../services/api/projectApi.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// NSO Handover tab — project-completed sites awaiting the supervisor's push to
// NSO. The push is gated on Project Excellence having pushed BOTH quality-audit
// reports (before + after). Each row shows the report status + a View button
// (yellow when a report was pushed since Project last opened it).
function fmtDate(d) {
  if (!d) return '—';
  const p = new Date(d);
  return Number.isNaN(p.getTime()) ? '—' : p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const p = new Date(d);
  return Number.isNaN(p.getTime()) ? '—' : p.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function humanizeDuration(fromISO, toISO) {
  if (fromISO == null || toISO == null) return null;
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

const needsPrimary = (r) => !r.qaBeforePushedAt;
const needsSecondary = (r) => Boolean(r.qaBeforePushedAt) && !r.qaAfterPushedAt;

function KpiTile({ label, count, active, tone, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, minWidth: 180, textAlign: 'left', cursor: 'pointer',
      border: `1px solid ${active ? tone : 'var(--zm-line)'}`,
      background: active ? `color-mix(in srgb, ${tone} 12%, var(--zm-surface))` : 'var(--zm-surface)',
      borderRadius: 12, padding: '16px 18px', transition: 'all .15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: tone }}/>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 34, color: 'var(--zm-fg)', marginTop: 6, lineHeight: 1 }}>{String(count).padStart(2, '0')}</div>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)', marginTop: 6 }}>{active ? 'Filtering — click to clear' : 'Click to filter'}</div>
    </button>
  );
}

export default function NsoHandoverPage() {
  const navigate = useNavigate();
  const { showToast } = usePageContext();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [filter, setFilter] = React.useState(null);
  const [pushingId, setPushingId] = React.useState(null);
  const [pushError, setPushError] = React.useState(null);
  const [viewSiteId, setViewSiteId] = React.useState(null);
  const [reports, setReports] = React.useState({ status: 'idle', data: null, error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getNsoHandoverQueue()
      .then((data) => { if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null }); })
      .catch((err) => {
        if (!cancelled) setState((prev) => ({
          ...prev, status: prev.items.length ? 'ready' : 'error',
          error: err?.detail || err?.message || 'Failed to load NSO handover queue',
        }));
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  // 'project_excellence' so a pushed after-report (unread + gating) refreshes here.
  useSiteDataRefresh(load, { sources: ['project', 'project_excellence', 'nso', 'businessAdmin', 'siteTrackerApi'] });

  const items = state.items;
  const primaryPending = items.filter(needsPrimary).length;
  const secondaryPending = items.filter(needsSecondary).length;
  const visible = filter === 'primary' ? items.filter(needsPrimary)
    : filter === 'secondary' ? items.filter(needsSecondary) : items;
  const viewRow = items.find((r) => r.siteId === viewSiteId) || null;

  const handlePush = React.useCallback((row) => {
    setPushError(null);
    setPushingId(row.siteId);
    pushToNso(row.siteId)
      .then(() => { showToast?.('Pushed to NSO.', 'success'); load(); })
      .catch((err) => setPushError(err?.detail || err?.message || 'Failed to push to NSO'))
      .finally(() => setPushingId(null));
  }, [load, showToast]);

  const openView = (siteId) => {
    setViewSiteId(siteId);
    setReports({ status: 'loading', data: null, error: null });
    getQAReports(siteId)
      .then((d) => setReports({ status: 'ready', data: d, error: null }))
      .catch((err) => setReports({ status: 'error', data: null, error: err?.detail || err?.message || 'Failed to load reports' }));
    // Opening clears the unread (yellow) flag; refresh the queue so it updates.
    markQAReportsViewed(siteId).then(() => load()).catch(() => {});
  };

  const COLS = '110px minmax(190px, 1fr) 120px minmax(230px, 1.1fr) 170px';

  const statusCell = (row) => {
    const afterState = row.qaAfterPushedAt ? 'pushed' : row.qaAfterUploadedAt ? 'uploaded' : 'missing';
    const between = humanizeDuration(row.qaBeforeUploadedAt, row.qaAfterUploadedAt);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)' }}>Completed {fmtDate(row.projectCompletedAt)}</span>
          <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: afterState === 'pushed' ? 'var(--zm-success)' : 'var(--zm-fg-3)' }}>
            {afterState === 'pushed' ? 'After report ✓' : afterState === 'uploaded' ? 'After report • uploaded' : 'After report — not uploaded yet'}
          </span>
        </div>
        {between && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
            padding: '5px 12px', borderRadius: 999,
            background: 'color-mix(in srgb, var(--zm-accent) 14%, var(--zm-surface))',
            border: '1px solid var(--zm-accent)', color: 'var(--zm-accent)',
            fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 800,
          }}>
            <Icon name="clock" size={14}/> {between} between reports
          </span>
        )}
        <button type="button" onClick={() => openView(row.siteId)} style={{
          alignSelf: 'flex-start', height: 28, padding: '0 12px', borderRadius: 7,
          border: `1px solid ${row.qaReportUnread ? 'var(--zm-warning, #d98a00)' : 'var(--zm-line)'}`,
          background: row.qaReportUnread ? 'color-mix(in srgb, var(--zm-warning, #d98a00) 18%, var(--zm-surface))' : 'var(--zm-surface)',
          color: row.qaReportUnread ? 'var(--zm-warning, #d98a00)' : 'var(--zm-fg-2)',
          fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name="box" size={12}/> View reports{row.qaReportUnread ? ' • new' : ''}
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 09"
        eyebrow="Project module"
        title="NSO Handover"
        onBack={() => navigate(ROUTES.PROJECT_OVERVIEW)}
        lede="Project complete — push to open NSO at stage three (needs both quality-audit reports)."
        right={<HeaderTag icon="route" label="STAGE THREE"/>}
      />

      {state.status === 'ready' && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiTile label="Primary audit pending" count={primaryPending} tone="var(--zm-accent)"
            active={filter === 'primary'} onClick={() => setFilter(filter === 'primary' ? null : 'primary')}/>
          <KpiTile label="Secondary audit pending" count={secondaryPending} tone="var(--zm-warning, #d98a00)"
            active={filter === 'secondary'} onClick={() => setFilter(filter === 'secondary' ? null : 'secondary')}/>
        </div>
      )}

      {pushError && <div className="zm-glass" style={{ padding: 14, color: 'var(--zm-danger)' }}>{pushError}</div>}
      {state.status === 'loading' && <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading NSO handover queue...</div>}
      {state.error && <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>}

      {state.status === 'ready' && visible.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="route" size={20}/>
          <p style={{ margin: '12px 0 0' }}>{filter ? 'No sites match this filter.' : 'No project-completed sites are waiting for NSO handover right now.'}</p>
        </div>
      )}

      {state.status === 'ready' && visible.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span><span>Site</span><span>City</span><span>Status</span>
            <span style={{ textAlign: 'right', paddingRight: 16 }}>Action</span>
          </div>
          {visible.map((row) => {
            const pushing = pushingId === row.siteId;
            const bothPushed = Boolean(row.qaBeforePushedAt) && Boolean(row.qaAfterPushedAt);
            return (
              <div key={row.siteId} data-site-id={row.siteId} className="zm-row" style={{
                display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 16px',
                borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'center',
              }}>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>{row.siteCode}</span>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>{row.siteName}</span>
                <span style={{ color: 'var(--zm-fg-2)' }}>{row.city}</span>
                {statusCell(row)}
                {isSupervisor ? (
                  <div style={{ justifySelf: 'end', marginRight: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <button type="button" disabled={pushing || !!pushingId || !bothPushed} onClick={() => handlePush(row)} style={{
                      height: 32, padding: '0 14px', border: 'none', borderRadius: 7,
                      background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)',
                      fontSize: 12, fontWeight: 800,
                      cursor: (pushing || !!pushingId || !bothPushed) ? 'not-allowed' : 'pointer',
                      opacity: (!bothPushed || (!!pushingId && !pushing)) ? 0.5 : 1,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}>
                      {pushing ? 'Pushing...' : <>Push to NSO<Icon name="arrow" size={12}/></>}
                    </button>
                    {!bothPushed && <span style={{ fontSize: 10, color: 'var(--zm-fg-3)' }}>Waiting for the after report</span>}
                  </div>
                ) : (
                  <span style={{ justifySelf: 'end', marginRight: 16, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700 }}>
                    <Icon name="clock" size={13}/> Awaiting supervisor push
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewRow && (
        <div role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
          <div className="zm-glass" style={{
            width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 14, padding: 20,
            background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 16, color: 'var(--zm-fg)' }}>Quality-audit reports</div>
                <div style={{ fontSize: 12.5, color: 'var(--zm-fg-3)', marginTop: 2 }}>{viewRow.siteCode} · {viewRow.siteName} · {viewRow.city}</div>
              </div>
              <button type="button" onClick={() => setViewSiteId(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--zm-fg-3)', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            {reports.status === 'loading' && <div style={{ marginTop: 16, color: 'var(--zm-fg-3)', fontSize: 13 }}>Loading reports…</div>}
            {reports.status === 'error' && <div style={{ marginTop: 16, color: 'var(--zm-danger)', fontSize: 13 }}>{reports.error}</div>}
            {reports.status === 'ready' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                {[['before', 'Before quality audit (primary)', reports.data.before], ['after', 'After quality audit (secondary)', reports.data.after]].map(([kind, label, r]) => (
                  <div key={kind} style={{ border: '1px solid var(--zm-line)', borderRadius: 10, padding: 14, background: 'var(--zm-surface-2)' }}>
                    <div style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 12.5, color: 'var(--zm-fg)' }}>{label}</div>
                    {r ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11.5, color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)' }}>
                          {r.fileName || 'report.pdf'} · Uploaded {fmtDateTime(r.uploadedAt)}{r.pushedAt ? ` · Pushed ${fmtDateTime(r.pushedAt)}` : ' · not pushed yet'}
                        </div>
                        {r.downloadUrl ? (
                          <a href={r.downloadUrl} target="_blank" rel="noopener noreferrer" style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, height: 32, padding: '0 14px',
                            borderRadius: 7, background: 'var(--zm-accent)', color: '#fff', textDecoration: 'none',
                            fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                          }}>Open PDF<Icon name="arrow" size={12}/></a>
                        ) : (
                          <div style={{ fontSize: 11.5, color: 'var(--zm-fg-3)', marginTop: 8 }}>Download link unavailable.</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--zm-fg-3)', marginTop: 8 }}>Not uploaded yet.</div>
                    )}
                  </div>
                ))}
                {reports.data.timeBetweenSeconds != null && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                    padding: '5px 12px', borderRadius: 999,
                    background: 'color-mix(in srgb, var(--zm-accent) 14%, var(--zm-surface))',
                    border: '1px solid var(--zm-accent)', color: 'var(--zm-accent)',
                    fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 800,
                  }}>
                    <Icon name="clock" size={14}/> {humanizeDuration(0, reports.data.timeBetweenSeconds * 1000) || '—'} between reports
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
