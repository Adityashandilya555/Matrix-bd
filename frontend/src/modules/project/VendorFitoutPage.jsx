// skipcq: JS-0833
// Project module → Vendor fit-out. The Blue Tokai team's side of the vendor
// platform, inside the normal Matrix shell: every site allocated to a fit-out
// vendor, its live progress from the vendor's daily updates, and (supervisors)
// issuing a new PO to a vendor company.
import React from 'react';
import { useSession } from '../../state/SessionContext.jsx';
import {
  createVendorProject, getVendorProjectAdmin, listVendorProjects, listVendors,
} from '../../services/api/vendorAdminApi.js';
import ProgressCurve from '../vendor-portal/ProgressCurve.jsx';
import { STATUS_LABEL, STATUS_TONE, fmtDate, fmtDateTime, inr, lakh, slipText } from '../vendor-portal/format.js';
import '../vendor-portal/vendor-portal.css';

const errText = (err, fallback) => err?.detail || err?.message || fallback;
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_PO = { vendorId: '', caCode: '', name: '', city: '', brand: '', siteType: 'non_mall', poNumber: '', poValue: '', poDate: today(), startDate: today() };

function Pill({ status }) {
  return <span className={`vp-pill ${STATUS_TONE[status] || 'muted'}`}>{STATUS_LABEL[status] || status}</span>;
}

function IssuePo({ vendors, onDone }) {
  const [f, setF] = React.useState(EMPTY_PO);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.vendorId || !f.name.trim() || !f.city.trim() || !f.poNumber.trim() || !(Number(f.poValue) > 0)) {
      setMsg({ tone: 'bad', text: 'Pick a vendor and fill in site name, city, PO number and a PO value above zero.' }); return;
    }
    if (f.startDate < f.poDate) { setMsg({ tone: 'bad', text: 'The start date cannot be before the PO date.' }); return; }
    setBusy(true); setMsg(null);
    try { await createVendorProject(f); setMsg({ tone: 'ok', text: `PO ${f.poNumber} issued. The vendor sees it on their portal now.` }); setF(EMPTY_PO); onDone(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not issue the PO.') }); }
    finally { setBusy(false); }
  };
  return (
    <form className="vp-card" onSubmit={submit}>
      <h3>Issue a PO to a vendor</h3>
      {msg && <div className={`vp-note ${msg.tone === 'bad' ? 'bad' : 'ok'}`} role="status">{msg.text}</div>}
      <div className="vp-grid vp-g2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <label className="vp-field" htmlFor="po-vendor">Vendor<select id="po-vendor" className="vp-input" value={f.vendorId} onChange={set('vendorId')}>
          <option value="">Choose a vendor…</option>{vendors.filter((v) => v.status === 'active').map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="vp-field" htmlFor="po-ca">CA code<input id="po-ca" className="vp-input" value={f.caCode} onChange={set('caCode')} placeholder="CA-2187" /></label>
        <label className="vp-field" htmlFor="po-name">Site name<input id="po-name" className="vp-input" value={f.name} onChange={set('name')} /></label>
        <label className="vp-field" htmlFor="po-city">City<input id="po-city" className="vp-input" value={f.city} onChange={set('city')} /></label>
        <label className="vp-field" htmlFor="po-brand">Brand<input id="po-brand" className="vp-input" value={f.brand} onChange={set('brand')} placeholder="Blue Tokai" /></label>
        <label className="vp-field" htmlFor="po-type">Site type<select id="po-type" className="vp-input" value={f.siteType} onChange={set('siteType')}><option value="non_mall">Non-mall</option><option value="mall">Mall</option></select></label>
        <label className="vp-field" htmlFor="po-no">PO number<input id="po-no" className="vp-input" value={f.poNumber} onChange={set('poNumber')} /></label>
        <label className="vp-field" htmlFor="po-val">PO value (₹)<input id="po-val" className="vp-input" type="number" min="1" value={f.poValue} onChange={set('poValue')} /></label>
        <label className="vp-field" htmlFor="po-date">PO date<input id="po-date" className="vp-input" type="date" value={f.poDate} onChange={set('poDate')} /></label>
        <label className="vp-field" htmlFor="po-start">Planned start<input id="po-start" className="vp-input" type="date" value={f.startDate} onChange={set('startDate')} /></label>
      </div>
      <div><button type="submit" className="vp-btn primary" disabled={busy}>Issue PO</button></div>
    </form>
  );
}

function Detail({ projectId, onClose }) {
  const [state, setState] = React.useState({ status: 'loading' });
  React.useEffect(() => {
    let alive = true;
    getVendorProjectAdmin(projectId).then((data) => alive && setState({ status: 'ready', data }))
      .catch((err) => alive && setState({ status: 'error', message: errText(err, 'Could not load this site.') }));
    return () => { alive = false; };
  }, [projectId]);
  if (state.status === 'loading') return <div className="vp-card"><p className="vp-muted">Loading…</p></div>;
  if (state.status === 'error') return <div className="vp-card"><p className="vp-error">{state.message}</p></div>;
  const p = state.data;
  return (
    <div className="vp-card">
      <div className="vp-row vp-between"><div><span className="vp-mono">{p.caCode || p.poNumber}</span> <Pill status={p.scheduleStatus} />
        <h2 style={{ fontSize: 18, marginTop: 4 }}>{p.name}</h2><div className="vp-small vp-muted">{p.vendorName} · {p.city} · PO {p.poNumber} · {inr(p.poValue)}</div></div>
        <button type="button" className="vp-btn sm" onClick={onClose}>Close</button></div>
      <dl className="vp-kv">
        <dt>PO accepted</dt><dd>{p.acceptedAt ? fmtDate(p.acceptedAt, true) : 'Waiting for the vendor'}</dd>
        <dt>Start</dt><dd>{fmtDate(p.startDate, true)}</dd>
        <dt>Target handover</dt><dd>{fmtDate(p.targetDate, true)}</dd>
        <dt>Site supervisor</dt><dd>{p.supervisorName ? `${p.supervisorName} · ${p.supervisorPhone || ''}` : 'Not named'}</dd>
      </dl>
      <ProgressCurve curve={p.curve} duration={p.duration} today={p.status === 'active' ? p.day : 0} />
      <h3>Daily updates</h3>
      {(p.updates || []).length ? (
        <div className="vp-tbl"><table><thead><tr><th>Date</th><th>Progress</th><th>On site</th><th>Note</th></tr></thead><tbody>
          {p.updates.map((u) => (
            <tr key={u.reportDate}><td>{fmtDate(u.reportDate)}<div className="vp-small vp-muted">Day {u.dayNo} · {fmtDateTime(u.submittedAt)}{u.submittedLate ? ' · late' : ''}</div></td>
              <td className="vp-num"><b>{Math.round(u.actualPct)}%</b></td>
              <td>{u.manpower}{u.ppeOk ? '' : ' · PPE lapse'}{u.supervisorOnSite ? '' : ' · no supervisor'}</td>
              <td>{u.note}{u.hindranceText && <div className="vp-small" style={{ color: 'var(--vp-warn)' }}>Blocker: {u.hindranceText}</div>}</td></tr>
          ))}</tbody></table></div>
      ) : <p className="vp-muted">No daily updates yet.</p>}
    </div>
  );
}

export default function VendorFitoutPage() {
  const { role } = useSession();
  const canIssue = role === 'supervisor';
  const [projects, setProjects] = React.useState({ status: 'loading' });
  const [vendors, setVendors] = React.useState([]);
  const [open, setOpen] = React.useState(null);

  const load = React.useCallback(() => {
    listVendorProjects().then((data) => setProjects({ status: 'ready', data }))
      .catch((err) => setProjects({ status: 'error', message: errText(err, 'Could not load vendor sites.') }));
    if (canIssue) listVendors().then((d) => setVendors(d.vendors || [])).catch(() => setVendors([]));
  }, [canIssue]);
  React.useEffect(() => { load(); }, [load]);

  const rows = projects.data?.projects || [];
  return (
    <div className="vp-root vp-embedded"><div className="vp-stack" style={{ padding: '4px 0 40px' }}>
      <div><div className="vp-eyebrow">Project · vendor platform</div><h1 className="vp-h1">Vendor fit-out</h1>
        <p className="vp-muted vp-small" style={{ marginTop: 4 }}>Sites allocated to fit-out vendors, with progress from their daily updates.</p></div>
      {canIssue && <IssuePo vendors={vendors} onDone={load} />}
      {projects.status === 'loading' && <p className="vp-muted">Loading vendor sites…</p>}
      {projects.status === 'error' && <div className="vp-card"><p className="vp-error">{projects.message}</p><div><button type="button" className="vp-btn" onClick={load}>Try again</button></div></div>}
      {projects.status === 'ready' && (rows.length ? (
        <div className="vp-tbl"><table><thead><tr><th>Site</th><th>Vendor</th><th>Status</th><th>Day</th><th>Actual / plan</th><th>Variance</th><th>Last update</th><th>PO</th><th /></tr></thead><tbody>
          {rows.map((p) => (
            <tr key={p.id}><td><span className="vp-mono">{p.caCode || '—'}</span><br />{p.name}<div className="vp-small vp-muted">{p.city}</div></td>
              <td>{p.vendorName}</td><td><Pill status={p.scheduleStatus} /></td>
              <td className="vp-num">{p.day >= 1 ? `${p.day}/${p.duration}` : '—'}</td>
              <td className="vp-num">{Math.round(p.actualPct)}% / {Math.round(p.plannedPct)}%</td>
              <td>{slipText(p) || '—'}</td><td>{p.lastUpdate ? fmtDate(p.lastUpdate) : '—'}</td><td className="vp-num">{lakh(p.poValue)}</td>
              <td><button type="button" className="vp-btn sm" onClick={() => setOpen(p.id)}>Open</button></td></tr>
          ))}
        </tbody></table></div>
      ) : <div className="vp-card"><p className="vp-muted">No vendor sites yet.{canIssue ? ' Issue the first PO above.' : ''}</p></div>)}
      {open && <Detail key={open} projectId={open} onClose={() => setOpen(null)} />}
    </div></div>
  );
}
