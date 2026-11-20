// skipcq: JS-0833
// One allocated site: Overview, Initiation (accept the PO, people, delivery
// plan, mobilisation checklist) and Daily update (today's report + the log).
// Plan phases, checklist items and the daily cutoff come from the workspace's
// vendor settings; the server computes every progress and status figure.
import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  acceptVendorPo, getVendorProject, listVendorUpdates, saveVendorInitiation, submitVendorUpdate,
} from '../../services/api/vendorPortalApi.js';
import ProgressCurve from './ProgressCurve.jsx';
import { StatusPill } from './VendorHome.jsx';
import { fmtDate, fmtDateTime, inr, slipText } from './format.js';

const TABS = [['overview', 'Overview'], ['init', 'Initiation'], ['update', 'Daily update']];
const errText = (err, fallback) => err?.detail || err?.message || fallback;

function Overview({ p }) {
  return (
    <>
      {p.scheduleStatus === 'late' && <div className="vp-note bad"><b>Late.</b> {slipText(p)}{p.daysPastTarget > 0 ? `, ${p.daysPastTarget} days past the target handover` : ''}.</div>}
      {p.scheduleStatus === 'risk' && <div className="vp-note warn"><b>At risk.</b> {slipText(p)}. Agree a catch-up plan with your project lead.</div>}
      <div className="vp-grid vp-g2">
        <div className="vp-card"><h3>Key dates</h3>
          <dl className="vp-kv">
            <dt>PO number</dt><dd className="vp-mono">{p.poNumber}</dd>
            <dt>PO value</dt><dd>{inr(p.poValue)}</dd>
            <dt>PO issued</dt><dd>{fmtDate(p.poDate, true)}</dd>
            <dt>Start</dt><dd>{fmtDate(p.startDate, true)}</dd>
            <dt>Standard duration</dt><dd>{p.duration} days ({p.siteType === 'mall' ? 'mall' : 'non-mall'})</dd>
            <dt><b>Target handover</b></dt><dd><b>{fmtDate(p.targetDate, true)}</b></dd>
            <dt>Forecast</dt><dd>{fmtDate(p.forecastDate, true)}</dd>
          </dl>
        </div>
        <div className="vp-card"><h3>Phases</h3>
          <div className="vp-tbl"><table><thead><tr><th>Phase</th><th>Days</th><th>Plan</th><th>Actual</th></tr></thead><tbody>
            {(p.phases || []).map((ph) => (
              <tr key={ph.phaseKey}><td>{ph.name}<div className="vp-small vp-muted">weight {ph.weight}%</div></td>
                <td className="vp-num">D{ph.startDay}–{ph.endDay}</td>
                <td className="vp-num">{Math.round(ph.plannedPct)}%</td>
                <td className="vp-num" style={{ color: ph.actualPct < ph.plannedPct ? 'var(--vp-warn)' : undefined }}><b>{Math.round(ph.actualPct)}%</b></td></tr>
            ))}
          </tbody></table></div>
        </div>
      </div>
      <div className="vp-card"><h3>Planned vs actual</h3><ProgressCurve curve={p.curve} duration={p.duration} today={p.status === 'active' ? p.day : 0} /></div>
    </>
  );
}

function Initiation({ p, onSaved }) {
  const accepted = Boolean(p.acceptedAt);
  const [start, setStart] = React.useState(p.startDate || '');
  const [f, setF] = React.useState({
    supervisorName: p.supervisorName || '', supervisorPhone: p.supervisorPhone || '',
    crewSize: p.crewSize || 10, deliveryPlan: p.deliveryPlan || '',
    checks: Object.fromEntries((p.checklist || []).map((c) => [c.itemId, Boolean(c.checked)])),
  });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const accept = async () => {
    if (!start) { setMsg({ tone: 'bad', text: 'Pick a start date.' }); return; }
    setBusy(true); setMsg(null);
    try { await acceptVendorPo(p.id, start); setMsg({ tone: 'ok', text: 'PO accepted. Daily updates open on the start date.' }); onSaved(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not accept the PO.') }); }
    finally { setBusy(false); }
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { await saveVendorInitiation(p.id, { ...f, crewSize: Number(f.crewSize) || 1 }); setMsg({ tone: 'ok', text: 'Initiation details saved.' }); onSaved(); }
    catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not save.') }); }
    finally { setBusy(false); }
  };
  const vendorItems = (p.checklist || []).filter((c) => c.kind === 'mobilisation_vendor');
  const brandItems = (p.checklist || []).filter((c) => c.kind === 'mobilisation_brand');

  return (
    <form className="vp-grid vp-g2" onSubmit={save}>
      <div className="vp-card"><h3>1 · PO acceptance</h3>
        {accepted
          ? <div className="vp-note ok">Accepted on {fmtDate(p.acceptedAt, true)}. Start date {fmtDate(p.startDate, true)}.</div>
          : (<>
              <p className="vp-small vp-muted">Accept the PO and confirm your start date by {fmtDate(p.acceptBy, true)}.</p>
              <label className="vp-field" htmlFor="vp-start">Confirmed start date
                <input id="vp-start" className="vp-input" type="date" value={start} min={p.poDate || undefined} onChange={(e) => setStart(e.target.value)} /></label>
              <div><button type="button" className="vp-btn primary" disabled={busy} onClick={accept}>Accept PO and confirm start date</button></div>
            </>)}
      </div>
      <div className="vp-card"><h3>2 · People on site</h3>
        <label className="vp-field" htmlFor="vp-sup">Named full-time supervisor<input id="vp-sup" className="vp-input" value={f.supervisorName} onChange={set('supervisorName')} placeholder="Full name" /></label>
        <label className="vp-field" htmlFor="vp-ph">Supervisor phone<input id="vp-ph" className="vp-input" type="tel" value={f.supervisorPhone} onChange={set('supervisorPhone')} /></label>
        <label className="vp-field" htmlFor="vp-crew">Planned crew size<input id="vp-crew" className="vp-input" type="number" min="1" value={f.crewSize} onChange={set('crewSize')} /></label>
      </div>
      <div className="vp-card"><h3>3 · Material delivery plan</h3>
        <label className="vp-field" htmlFor="vp-dp">Lots and delivery days<textarea id="vp-dp" className="vp-input" value={f.deliveryPlan} onChange={set('deliveryPlan')} placeholder="Lot 1 (D1): …" /></label>
      </div>
      <div className="vp-card"><h3>4 · Mobilisation checklist</h3>
        <div className="vp-eyebrow">Your checks</div>
        {vendorItems.map((c) => (
          <label key={c.itemId} className="vp-check"><input type="checkbox" checked={Boolean(f.checks[c.itemId])}
            onChange={(e) => setF((x) => ({ ...x, checks: { ...x.checks, [c.itemId]: e.target.checked } }))} /><span>{c.label}</span></label>
        ))}
        {brandItems.length > 0 && <div className="vp-eyebrow" style={{ marginTop: 6 }}>Client checks</div>}
        {brandItems.map((c) => (
          <label key={c.itemId} className="vp-check"><input type="checkbox" checked={Boolean(c.checked)} disabled readOnly /><span>{c.label}</span></label>
        ))}
      </div>
      <div className="vp-row">
        <button type="submit" className="vp-btn primary" disabled={busy}>Save initiation details</button>
        {msg && <span className={`vp-small ${msg.tone === 'bad' ? 'vp-error' : 'vp-muted'}`} role="status">{msg.text}</span>}
      </div>
    </form>
  );
}

function DailyUpdate({ p, onSaved }) {
  const today = p.today || null;
  const base = today?.progress || p.lastProgress || {};
  const [prog, setProg] = React.useState(() => Object.fromEntries((p.phases || []).map((ph) => [ph.phaseKey, Number(base[ph.phaseKey]) || 0])));
  const [f, setF] = React.useState({
    manpower: today?.manpower ?? p.crewSize ?? 10, material: today?.material || '', note: today?.note || '',
    supervisorOnSite: today ? Boolean(today.supervisorOnSite) : true, ppeOk: today ? Boolean(today.ppeOk) : true, hindranceText: '',
  });
  const [log, setLog] = React.useState({ status: 'loading' });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const loadLog = React.useCallback(() => {
    listVendorUpdates(p.id).then((data) => setLog({ status: 'ready', data }))
      .catch((err) => setLog({ status: 'error', message: errText(err, 'Could not load the update log.') }));
  }, [p.id]);
  React.useEffect(() => { loadLog(); }, [loadLog]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await submitVendorUpdate(p.id, { ...f, manpower: Number(f.manpower) || 0, progress: prog });
      setMsg({ tone: 'ok', text: 'Daily update submitted.' });
      setF((x) => ({ ...x, hindranceText: '' }));
      onSaved(); loadLog();
    } catch (err) { setMsg({ tone: 'bad', text: errText(err, 'Could not submit the update.') }); }
    finally { setBusy(false); }
  };
  const visible = (p.phases || []).filter((ph) => ph.startDay <= Math.min(p.day, p.duration) + 3 || (prog[ph.phaseKey] || 0) > 0);

  return (
    <>
      {p.updatesOpen ? (
        <form className="vp-card" onSubmit={submit}>
          <div className="vp-row vp-between"><h3>Today · Day {p.day}</h3>
            {today ? <span className="vp-pill ok">Submitted {fmtDateTime(today.submittedAt)}</span>
              : <span className={`vp-pill ${p.pastCutoff ? 'bad' : 'warn'}`}>{p.pastCutoff ? 'Overdue' : `Due by ${p.cutoffLocal}`}</span>}
          </div>
          <p className="vp-small vp-muted">Move each activity to its cumulative % complete as of today.</p>
          {visible.map((ph) => (
            <div key={ph.phaseKey} className="vp-phase">
              <label htmlFor={`vp-pr-${ph.phaseKey}`}><b>{ph.name}</b><div className="vp-small vp-muted">D{ph.startDay}–{ph.endDay} · plan today {Math.round(ph.plannedPct)}%</div>
                <input id={`vp-pr-${ph.phaseKey}`} type="range" min="0" max="100" step="5" value={prog[ph.phaseKey] || 0}
                  onChange={(e) => setProg((x) => ({ ...x, [ph.phaseKey]: Number(e.target.value) }))} /></label>
              <b className="vp-num" style={{ textAlign: 'right', fontSize: 18 }}>{prog[ph.phaseKey] || 0}%</b>
            </div>
          ))}
          <div className="vp-grid vp-g2">
            <label className="vp-field" htmlFor="vp-mp">Manpower on site (plan {p.crewSize || '—'})<input id="vp-mp" className="vp-input" type="number" min="0" value={f.manpower} onChange={(e) => setF((x) => ({ ...x, manpower: e.target.value }))} /></label>
            <label className="vp-field" htmlFor="vp-mat">Material received today<input id="vp-mat" className="vp-input" value={f.material} onChange={(e) => setF((x) => ({ ...x, material: e.target.value }))} placeholder="e.g. Tiles lot 2" /></label>
          </div>
          <label className="vp-field" htmlFor="vp-note">Work done today<input id="vp-note" className="vp-input" value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} placeholder="e.g. Flooring 60% of seating area" /></label>
          <label className="vp-check"><input type="checkbox" checked={f.supervisorOnSite} onChange={(e) => setF((x) => ({ ...x, supervisorOnSite: e.target.checked }))} /><span>Named supervisor on site full day</span></label>
          <label className="vp-check"><input type="checkbox" checked={f.ppeOk} onChange={(e) => setF((x) => ({ ...x, ppeOk: e.target.checked }))} /><span>PPE worn by everyone today</span></label>
          <label className="vp-field" htmlFor="vp-hin">Anything blocking work that needs the client's help<textarea id="vp-hin" className="vp-input" value={f.hindranceText} onChange={(e) => setF((x) => ({ ...x, hindranceText: e.target.value }))} placeholder="Leave blank if none" /></label>
          <div className="vp-row"><button type="submit" className="vp-btn primary" disabled={busy}>{today ? "Update today's report" : 'Submit daily update'}</button>
            {msg && <span className={`vp-small ${msg.tone === 'bad' ? 'vp-error' : 'vp-muted'}`} role="status">{msg.text}</span>}</div>
        </form>
      ) : (
        <div className="vp-note">{p.acceptedAt ? `Daily updates open on the start date (${fmtDate(p.startDate, true)}).` : 'Accept the PO on the Initiation tab first.'}</div>
      )}
      <div className="vp-card">
        <div className="vp-row vp-between"><h3>Update log</h3>
          {log.status === 'ready' && <span className="vp-small vp-muted">{log.data.submittedDays} of {log.data.expectedDays} days on record</span>}</div>
        {log.status === 'loading' && <p className="vp-muted">Loading…</p>}
        {log.status === 'error' && <p className="vp-error">{log.message}</p>}
        {log.status === 'ready' && (log.data.entries?.length ? (
          <div className="vp-log">{log.data.entries.map((u) => (u.missed
            ? <div key={u.reportDate} className="vp-logi miss"><div><b>{fmtDate(u.reportDate)}</b><div className="vp-small">Day {u.dayNo}</div></div><div><b>No update.</b> Counted as no progress.</div></div>
            : (
              <div key={u.reportDate} className="vp-logi"><div><b>{fmtDate(u.reportDate)}</b><div className="vp-small vp-muted">Day {u.dayNo}</div></div>
                <div><div className="vp-row vp-between"><span>{u.note}</span><span className="vp-num vp-small"><b>{Math.round(u.actualPct)}%</b> <span className="vp-muted">plan {Math.round(u.plannedPct)}%</span></span></div>
                  <div className="vp-small vp-muted">{u.manpower} on site{u.supervisorOnSite ? '' : ' · no supervisor'}{u.ppeOk ? '' : ' · PPE lapse'}{u.material ? ` · Material: ${u.material}` : ''} · submitted {fmtDateTime(u.submittedAt)}{u.submittedLate ? ' (after cutoff)' : ''}</div>
                  {u.hindranceText && <div className="vp-small" style={{ color: 'var(--vp-warn)' }}>Blocker: {u.hindranceText}</div>}</div></div>
            )))}
          </div>
        ) : <p className="vp-muted">No updates yet.</p>)}
      </div>
    </>
  );
}

export default function VendorSite() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const [state, setState] = React.useState({ status: 'loading' });

  const load = React.useCallback(() => {
    getVendorProject(projectId).then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', notFound: err?.status === 404, message: errText(err, 'Could not load this site.') }));
  }, [projectId]);
  React.useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <p className="vp-muted">Loading site…</p>;
  if (state.status === 'error') {
    return (
      <div className="vp-card"><h2>{state.notFound ? 'Site not found' : 'Could not load this site'}</h2>
        <p className="vp-muted">{state.notFound ? 'It may not be allocated to your company.' : state.message}</p>
        <div><button type="button" className="vp-btn" onClick={() => navigate('/vendor')}>Back to my sites</button></div></div>
    );
  }
  const p = state.data;
  return (
    <div className="vp-stack">
      <button type="button" className="vp-btn sm" style={{ justifySelf: 'start' }} onClick={() => navigate('/vendor')}>← My sites</button>
      <div className="vp-row vp-between" style={{ alignItems: 'flex-end' }}>
        <div><div className="vp-row"><span className="vp-mono">{p.caCode || p.poNumber}</span><StatusPill status={p.scheduleStatus} /><span className="vp-small vp-muted">{slipText(p)}</span></div>
          <h1 className="vp-h1">{p.name}</h1><div className="vp-small vp-muted">{p.city} · {p.brand || '—'} · {p.siteType === 'mall' ? 'Mall' : 'Non-mall'} · {p.poNumber}</div></div>
        <div className="vp-row" style={{ gap: 22 }}>
          <div><div className="vp-eyebrow">Progress</div><div className="vp-num"><b style={{ fontSize: 18 }}>{Math.round(p.actualPct)}%</b> <span className="vp-muted">plan {Math.round(p.plannedPct)}%</span></div></div>
          <div><div className="vp-eyebrow">Day</div><div className="vp-num"><b style={{ fontSize: 18 }}>{p.day >= 1 ? p.day : '–'}</b> <span className="vp-muted">of {p.duration}</span></div></div>
          <div><div className="vp-eyebrow">Handover</div><div className="vp-num"><b style={{ fontSize: 18 }}>{fmtDate(p.targetDate)}</b></div></div>
        </div>
      </div>
      <div className="vp-tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'overview' ? {} : { tab: k })}>{l}</button>)}
      </div>
      {tab === 'overview' && <Overview p={p} />}
      {tab === 'init' && <Initiation key={`${p.id}-${p.acceptedAt}`} p={p} onSaved={load} />}
      {tab === 'update' && <DailyUpdate key={`${p.id}-${p.today?.submittedAt || ''}`} p={p} onSaved={load} />}
    </div>
  );
}
