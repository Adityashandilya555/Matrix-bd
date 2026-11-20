// skipcq: JS-0833
// Vendor home — KPIs, what needs doing today, and the sites allocated to this
// vendor company. Everything shown is computed by GET /vendor/home.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getVendorHome } from '../../services/api/vendorPortalApi.js';
import { VendorContext } from './context.js';
import { STATUS_LABEL, STATUS_TONE, fmtDate, lakh, slipText } from './format.js';

export function StatusPill({ status }) {
  return <span className={`vp-pill ${STATUS_TONE[status] || 'muted'}`}>{STATUS_LABEL[status] || status}</span>;
}

function Kpi({ value, label }) {
  return <div className="vp-card vp-kpi"><div className="v">{value}</div><div className="l">{label}</div></div>;
}

function SiteCard({ p, onOpen }) {
  const pct = Math.round(Number(p.actualPct) || 0);
  const plan = Math.round(Number(p.plannedPct) || 0);
  const started = Number(p.day) >= 1;
  return (
    <button type="button" className="vp-card vp-site" onClick={onOpen}>
      <div className="vp-row vp-between"><span className="vp-mono">{p.caCode || p.poNumber}</span><StatusPill status={p.scheduleStatus} /></div>
      <div><div className="name">{p.name}</div><div className="vp-small vp-muted">{p.city} · {p.brand || '—'} · {p.siteType === 'mall' ? 'Mall' : 'Non-mall'} ({p.duration} days)</div></div>
      <div>
        <div className="vp-row vp-between vp-small">
          <span>{p.status === 'handed_over' ? 'Complete' : started ? `Day ${p.day} of ${p.duration}` : 'Not started'}</span>
          <span className="vp-num"><b>{pct}%</b> <span className="vp-muted">/ plan {plan}%</span></span>
        </div>
        <div className="vp-bar" style={{ marginTop: 4 }}><i style={{ width: `${pct}%` }} />{started && <b style={{ left: `${plan}%` }} />}</div>
      </div>
      <div className="vp-meta3">
        <div><span className="vp-muted">PO value</span><b>{lakh(p.poValue)}</b></div>
        <div><span className="vp-muted">Handover</span><b>{fmtDate(p.targetDate)}</b></div>
        <div><span className="vp-muted">Variance</span><b>{slipText(p) || '—'}</b></div>
      </div>
    </button>
  );
}

export default function VendorHome() {
  const { vendor, brand } = React.useContext(VendorContext);
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading' });

  const load = React.useCallback(() => {
    getVendorHome()
      .then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', message: err?.detail || 'Could not load your sites.' }));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <p className="vp-muted">Loading your sites…</p>;
  if (state.status === 'error') {
    return <div className="vp-card"><p className="vp-error">{state.message}</p><div><button type="button" className="vp-btn" onClick={load}>Try again</button></div></div>;
  }
  const { kpis = {}, alerts = [], projects = [] } = state.data;
  const open = (id, tab) => navigate(`/vendor/sites/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`);

  return (
    <div className="vp-stack">
      <div>
        <div className="vp-eyebrow">{brand?.tenantName ? `Fit-out partner of ${brand.tenantName}` : 'Fit-out partner'}</div>
        <h1 className="vp-h1">{vendor?.name}</h1>
        {brand?.welcomeText && <p className="vp-muted" style={{ marginTop: 6, maxWidth: '65ch' }}>{brand.welcomeText}</p>}
      </div>
      <div className="vp-grid vp-g4">
        <Kpi value={kpis.activeSites ?? 0} label="Active sites" />
        <Kpi value={kpis.updatesDue ?? 0} label="Updates due today" />
        <Kpi value={kpis.posToAccept ?? 0} label="POs to accept" />
        <Kpi value={kpis.lateSites ?? 0} label="Sites running late" />
      </div>
      {alerts.length > 0 && (
        <div className="vp-stack" style={{ gap: 8 }}>
          {alerts.map((a) => (
            <div key={`${a.kind}-${a.projectId}`} className={`vp-note ${a.tone || ''}`}>
              <div className="vp-row vp-between"><span><b>{a.title}</b> {a.text}</span>
                <button type="button" className="vp-btn sm primary" onClick={() => open(a.projectId, a.tab)}>{a.action || 'Open'}</button></div>
            </div>
          ))}
        </div>
      )}
      <h2 style={{ margin: 0, fontSize: 18 }}>Allocated sites</h2>
      {projects.length
        ? <div className="vp-sites">{projects.map((p) => <SiteCard key={p.id} p={p} onOpen={() => open(p.id)} />)}</div>
        : <div className="vp-card"><p className="vp-muted">No sites are allocated to you yet. They appear here when {brand?.tenantName || 'your client'} issues a PO.</p></div>}
    </div>
  );
}
