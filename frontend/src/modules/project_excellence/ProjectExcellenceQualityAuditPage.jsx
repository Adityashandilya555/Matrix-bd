// skipcq: JS-0833
import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { usePageContext } from '../../App.jsx';
import { ROUTES } from '../../router/routes.js';
import { listMyTeam } from '../../services/api/adapters/httpAdapter.js';
import {
  getPEQualityAuditQueue,
  getPEQAReports,
  uploadQAReport,
  pushQAReport,
  listQADelegations,
  allocateQA,
  revokeQAAllocation,
} from '../../services/api/projectExcellenceApi.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// Project Excellence → Quality Audit. The chain: the project executive sets the
// quality-audit date → the project supervisor approves → it lands here. The PE
// supervisor (or a delegated executive) uploads the BEFORE (primary) and AFTER
// (secondary) quality-audit report PDFs and pushes each independently. Pushing
// 'before' completes the project (surfacing it in the Project NSO Handover tab);
// 'after' can be pushed later. Push-to-NSO (in Project) is gated on both.
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
export function humanizeDuration(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
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
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, minWidth: 180, textAlign: 'left', cursor: 'pointer',
        border: `1px solid ${active ? tone : 'var(--zm-line)'}`,
        background: active ? `color-mix(in srgb, ${tone} 12%, var(--zm-surface))` : 'var(--zm-surface)',
        borderRadius: 12, padding: '16px 18px', transition: 'all .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: tone }}/>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 34, color: 'var(--zm-fg)', marginTop: 6, lineHeight: 1 }}>
        {String(count).padStart(2, '0')}
      </div>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)', marginTop: 6 }}>
        {active ? 'Filtering — click to clear' : 'Click to filter'}
      </div>
    </button>
  );
}

// One before/after report slot inside the dialog.
function ReportSlot({ kind, label, uploadedAt, pushedAt, fileUrl, fileName, canManage, canPush, busy, uploading, pushing, onUpload, onPush }) {
  const fileRef = React.useRef(null);
  const pushed = Boolean(pushedAt);
  const uploaded = Boolean(uploadedAt);
  // The uploaded PDF can be viewed by anyone who can open the dialog (supervisor
  // or delegated executive), independent of the manage/upload controls.
  const viewLink = uploaded && fileUrl ? (
    <a
      href={fileUrl} target="_blank" rel="noopener noreferrer" title={fileName || 'Open PDF'}
      style={{
        height: 32, padding: '0 12px', borderRadius: 7, border: '1px solid var(--zm-accent)',
        background: 'color-mix(in srgb, var(--zm-accent) 10%, var(--zm-surface))', color: 'var(--zm-accent)',
        fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800, textDecoration: 'none',
        display: 'inline-flex', alignItems: 'center', gap: 7,
      }}
    >
      <Icon name="box" size={12}/> View PDF
    </a>
  ) : null;
  return (
    <div style={{ border: '1px solid var(--zm-line)', borderRadius: 10, padding: 14, background: 'var(--zm-surface-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 12.5, color: 'var(--zm-fg)' }}>{label}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800,
          color: pushed ? 'var(--zm-success)' : uploaded ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
        }}>
          <Icon name={pushed ? 'check' : uploaded ? 'box' : 'clock'} size={12}/>
          {pushed ? 'Pushed' : uploaded ? 'Uploaded' : 'Not uploaded'}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--zm-fg-3)', marginTop: 6, fontFamily: 'var(--zm-font-mono)' }}>
        {uploaded ? `Uploaded ${fmtDateTime(uploadedAt)}${fileName ? ` · ${fileName}` : ''}` : 'PDF · max 25 MB'}
        {pushed ? ` · Pushed ${fmtDateTime(pushedAt)}` : ''}
      </div>
      {canManage ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {viewLink}
          <input
            ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(kind, f); e.target.value = ''; }}
          />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={{
            height: 32, padding: '0 12px', borderRadius: 7, border: '1px solid var(--zm-line)',
            background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)',
            fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 7,
          }}>
            {uploading && <span aria-hidden="true" style={{ width: 12, height: 12, border: '2px solid var(--zm-line-strong)', borderTopColor: 'var(--zm-accent)', borderRadius: '50%', display: 'inline-block', animation: 'zm-spin 0.7s linear infinite' }}/>}
            {uploading ? 'Uploading…' : uploaded ? 'Replace PDF' : 'Choose PDF'}
          </button>
          <button type="button" disabled={busy || !uploaded || pushed || !canPush} onClick={() => onPush(kind)} style={{
            height: 32, padding: '0 14px', borderRadius: 7, border: 'none',
            background: pushed ? 'var(--zm-success)' : 'var(--zm-accent)', color: '#fff',
            fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
            cursor: (busy || !uploaded || pushed || !canPush) ? 'not-allowed' : 'pointer',
            opacity: (busy && pushing) || (!uploaded || pushed || !canPush) ? 0.5 : 1,
          }}>
            {pushed ? 'Pushed ✓' : pushing ? 'Pushing…' : 'Push'}
          </button>
        </div>
      ) : (
        // Read-only viewer (a supervisor viewing someone else's delegated site):
        // still let them open the uploaded PDF.
        viewLink && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>{viewLink}</div>
      )}
      {kind === 'after' && !canPush && !pushed && (
        <div style={{ fontSize: 11, color: 'var(--zm-fg-3)', marginTop: 8 }}>Push the “before” report first.</div>
      )}
    </div>
  );
}

export default function ProjectExcellenceQualityAuditPage() {
  const navigate = useNavigate();
  const { showToast } = usePageContext();
  const { role, session } = useSession();
  const isSupervisor = role === 'supervisor';
  const myUserId = session?.userId || session?.id || session?.sub || null;
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [filter, setFilter] = React.useState(null);         // null | 'primary' | 'secondary'
  const [dialogSiteId, setDialogSiteId] = React.useState(null);
  const [team, setTeam] = React.useState([]);
  const [allocation, setAllocation] = React.useState(null); // QA delegation of the open dialog's site
  const [chosenExec, setChosenExec] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [uploadingKind, setUploadingKind] = React.useState(null); // 'before' | 'after' while a PDF uploads
  const [pushingKind, setPushingKind] = React.useState(null);     // 'before' | 'after' while a push is in flight
  const [qaReports, setQaReports] = React.useState(null);         // { before, after } signed PDFs for the open dialog
  const [actionError, setActionError] = React.useState(null);
  const inFlight = React.useRef(false);                           // re-entrancy guard against rapid double-clicks

  // Returns the fetch promise so runAction can keep buttons disabled THROUGH the
  // refetch — otherwise the un-awaited reload dropped the guard while the row
  // still held stale (pre-push) flags, briefly re-enabling a duplicate push.
  const load = React.useCallback(() => {
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    return getPEQualityAuditQueue()
      .then((data) => setState({ status: 'ready', items: data.items, error: null }))
      .catch((err) => setState((prev) => ({
        ...prev, status: prev.items.length ? 'ready' : 'error',
        error: err?.detail || err?.message || 'Failed to load the quality-audit queue',
      })));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useSiteDataRefresh(load, { sources: ['project', 'project_excellence', 'businessAdmin'] });

  React.useEffect(() => {
    if (!isSupervisor) return undefined;
    let cancelled = false;
    listMyTeam('project_excellence')
      .then((rows) => { if (!cancelled) setTeam(rows || []); })
      .catch(() => { if (!cancelled) setTeam([]); });
    return () => { cancelled = true; };
  }, [isSupervisor]);

  // Load the open site's QA delegation whenever the dialog opens.
  React.useEffect(() => {
    if (!dialogSiteId || !isSupervisor) { setAllocation(null); return undefined; }
    let cancelled = false;
    listQADelegations(dialogSiteId)
      .then((d) => { if (!cancelled) setAllocation(d.items?.[0] || null); })
      .catch(() => { if (!cancelled) setAllocation(null); });
    return () => { cancelled = true; };
  }, [dialogSiteId, isSupervisor]);

  const items = state.items;
  const primaryPending = items.filter(needsPrimary).length;
  const secondaryPending = items.filter(needsSecondary).length;
  const visible = filter === 'primary' ? items.filter(needsPrimary)
    : filter === 'secondary' ? items.filter(needsSecondary) : items;
  const dialogRow = items.find((r) => r.siteId === dialogSiteId) || null;

  // Signed before/after PDF URLs for the open dialog — refetched when an upload
  // changes the timestamps so the "View PDF" link always points at the latest.
  React.useEffect(() => {
    if (!dialogSiteId) { setQaReports(null); return undefined; }
    let cancelled = false;
    getPEQAReports(dialogSiteId)
      .then((r) => { if (!cancelled) setQaReports(r); })
      .catch(() => { if (!cancelled) setQaReports(null); });
    return () => { cancelled = true; };
  }, [dialogSiteId, dialogRow?.qaBeforeUploadedAt, dialogRow?.qaAfterUploadedAt]);

  const runAction = async (fn, okMsg) => {
    if (inFlight.current) return;   // block a rapid second click / stale-state re-fire
    inFlight.current = true;
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      if (okMsg) showToast?.(okMsg, 'success');
      await load();                 // keep buttons disabled until the refetch reflects the new state
    } catch (err) {
      setActionError(err?.detail || err?.message || 'Action failed');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const onUpload = (kind, file) => {
    setUploadingKind(kind);
    runAction(() => uploadQAReport(dialogSiteId, kind, file), `${kind === 'before' ? 'Before' : 'After'} report uploaded.`)
      .finally(() => setUploadingKind(null));
  };
  const onPush = (kind) => {
    setPushingKind(kind);
    runAction(() => pushQAReport(dialogSiteId, kind), `${kind === 'before' ? 'Before' : 'After'} report pushed.`)
      .finally(() => setPushingKind(null));
  };
  const onAllocate = () => {
    const target = chosenExec === '__self__' ? myUserId : chosenExec;
    if (!target) { setActionError('Could not resolve the executive — refresh and try again.'); return; }
    runAction(async () => {
      await allocateQA(dialogSiteId, target);
      setChosenExec('');
      const d = await listQADelegations(dialogSiteId).catch(() => ({ items: [] }));
      setAllocation(d.items?.[0] || null);
    }, 'Quality-audit task delegated.');
  };
  const onRevoke = () => {
    if (!allocation) return;
    runAction(async () => {
      await revokeQAAllocation(dialogSiteId, allocation.delegateUserId);
      setAllocation(null);
    }, 'Delegation revoked.');
  };

  const COLS = '110px minmax(190px, 1fr) 120px 120px minmax(210px, 1fr) 120px';

  const reportsCell = (row) => {
    const beforeState = row.qaBeforePushedAt ? 'pushed' : row.qaBeforeUploadedAt ? 'uploaded' : 'pending';
    const afterState = row.qaAfterPushedAt ? 'pushed' : row.qaAfterUploadedAt ? 'uploaded' : 'pending';
    const between = humanizeDuration(row.qaBeforeUploadedAt, row.qaAfterUploadedAt);
    const pill = (lbl, st) => (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800,
        padding: '2px 7px', borderRadius: 5, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: st === 'pushed' ? 'var(--zm-success)' : st === 'uploaded' ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
        border: `1px solid ${st === 'pushed' ? 'var(--zm-success)' : st === 'uploaded' ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
      }}>{lbl} {st === 'pushed' ? '✓' : st === 'uploaded' ? '•' : '○'}</span>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{pill('Before', beforeState)}{pill('After', afterState)}</div>
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
        {row.qaReportDelegateName && <span style={{ fontSize: 10.5, color: 'var(--zm-fg-3)' }}>Delegated · {row.qaReportDelegateName}</span>}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow="Project Excellence module"
        title="Quality Audit"
        onBack={() => navigate(ROUTES.PROJECT_EXCELLENCE_OVERVIEW)}
        lede={state.status === 'ready'
          ? `${primaryPending + secondaryPending} report${primaryPending + secondaryPending === 1 ? '' : 's'} pending`
          : 'Before/after quality-audit report sign-off'}
        right={<HeaderTag icon="box" label="BEFORE → AFTER REPORTS"/>}
      />

      {state.status === 'ready' && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiTile label="Primary audit pending" count={primaryPending} tone="var(--zm-accent)"
            active={filter === 'primary'} onClick={() => setFilter(filter === 'primary' ? null : 'primary')}/>
          <KpiTile label="Secondary audit pending" count={secondaryPending} tone="var(--zm-warning, #d98a00)"
            active={filter === 'secondary'} onClick={() => setFilter(filter === 'secondary' ? null : 'secondary')}/>
        </div>
      )}

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading the quality-audit queue…</div>
      )}
      {state.error && <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>}

      {state.status === 'ready' && visible.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="box" size={20}/>
          <p style={{ margin: '12px 0 0' }}>{filter ? 'No sites match this filter.' : 'No sites awaiting quality-audit reports.'}</p>
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
            <span>Code</span><span>Site</span><span>City</span><span>Audit date</span><span>Reports</span>
            <span style={{ textAlign: 'right', paddingRight: 16 }}>Action</span>
          </div>
          {visible.map((row) => {
            const canManage = isSupervisor || Boolean(row.qaReportDelegateName);
            return (
              <div key={row.siteId} data-site-id={row.siteId} className="zm-row" style={{
                display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 16px',
                borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'center',
              }}>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>{row.siteCode}</span>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>{row.siteName}</span>
                <span style={{ color: 'var(--zm-fg-2)' }}>{row.city}</span>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{fmtDate(row.inspectionDate)}</span>
                {reportsCell(row)}
                <button type="button" onClick={() => { setDialogSiteId(row.siteId); setActionError(null); }} style={{
                  justifySelf: 'end', marginRight: 16, height: 32, padding: '0 14px', borderRadius: 7,
                  background: canManage ? 'var(--zm-accent)' : 'var(--zm-surface-2)',
                  color: canManage ? '#fff' : 'var(--zm-fg-2)', border: canManage ? 'none' : '1px solid var(--zm-line)',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                }}>
                  {canManage ? 'Manage' : 'View'}<Icon name="arrow" size={12}/>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {dialogRow && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}
        >
          <div className="zm-glass" style={{
            width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', borderRadius: 14, padding: 20,
            background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 16, color: 'var(--zm-fg)' }}>Quality-audit reports</div>
                <div style={{ fontSize: 12.5, color: 'var(--zm-fg-3)', marginTop: 2 }}>{dialogRow.siteCode} · {dialogRow.siteName} · {dialogRow.city}</div>
              </div>
              <button type="button" onClick={() => setDialogSiteId(null)} disabled={busy} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--zm-fg-3)', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            {actionError && <div style={{ marginTop: 12, color: 'var(--zm-danger)', fontSize: 12.5 }}>{actionError}</div>}

            {isSupervisor && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: '1px dashed var(--zm-line)' }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 8 }}>Delegation</div>
                {allocation ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--zm-fg)' }}>Delegated to <strong>{allocation.delegateName || allocation.delegateEmail}</strong></span>
                    <button type="button" disabled={busy} onClick={onRevoke} style={{ height: 30, padding: '0 12px', border: 'none', borderRadius: 7, background: 'var(--zm-danger)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Revoke</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select value={chosenExec} onChange={(e) => setChosenExec(e.target.value)} style={{ flex: 1, minWidth: 200, height: 34, padding: '0 10px', borderRadius: 7, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
                      <option value="">Delegate to executive…</option>
                      <option value="__self__">Delegate to self (me)</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                    </select>
                    <button type="button" disabled={busy || !chosenExec || (chosenExec === '__self__' && !myUserId)} onClick={onAllocate} style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: (!chosenExec) ? 0.5 : 1 }}>Delegate</button>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
              <ReportSlot
                kind="before" label="Before quality audit (primary)"
                uploadedAt={dialogRow.qaBeforeUploadedAt} pushedAt={dialogRow.qaBeforePushedAt}
                fileUrl={qaReports?.before?.downloadUrl} fileName={qaReports?.before?.fileName}
                canManage={isSupervisor || Boolean(dialogRow.qaReportDelegateName)} canPush busy={busy}
                uploading={uploadingKind === 'before'} pushing={pushingKind === 'before'}
                onUpload={onUpload} onPush={onPush}
              />
              <ReportSlot
                kind="after" label="After quality audit (secondary)"
                uploadedAt={dialogRow.qaAfterUploadedAt} pushedAt={dialogRow.qaAfterPushedAt}
                fileUrl={qaReports?.after?.downloadUrl} fileName={qaReports?.after?.fileName}
                canManage={isSupervisor || Boolean(dialogRow.qaReportDelegateName)}
                canPush={Boolean(dialogRow.qaBeforePushedAt)} busy={busy}
                uploading={uploadingKind === 'after'} pushing={pushingKind === 'after'}
                onUpload={onUpload} onPush={onPush}
              />
            </div>

            <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--zm-fg-3)', lineHeight: 1.5 }}>
              Pushing the <strong>before</strong> report completes the project and sends it to the Project team’s NSO Handover. Push-to-NSO stays blocked until the <strong>after</strong> report is pushed too.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
