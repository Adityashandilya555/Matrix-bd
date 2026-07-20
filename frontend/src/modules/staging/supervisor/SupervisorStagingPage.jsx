import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSites } from '../../../state/SitesContext.jsx';
import { usePageContext } from '../../../App.jsx';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import StatusPill from '../../shared/primitives/StatusPill.jsx';
import { bdSiteStatusRoute } from '../../../router/routes.js';
import { useFocusSite } from '../../../hooks/useFocusSite.js';
import StateKpiTile from '../../shared/primitives/StateKpiTile.jsx';
import { STAGES } from '../../shared/primitives/constants.js';

// Render bodies preserved exactly from Staging.jsx — supervisor-only view.

const daysBetweenISO = (a, b) => { if (!a || !b) return null; const da = new Date(a + 'T00:00'); const db = new Date(b + 'T00:00'); return Math.round((db - da) / 86400000); };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m-1] + s[m]) / 2); };

function EyeIcon({ size = 14 }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>);
}

function KpiTile({ label, value, sub, tone = 'neutral' }) {
  const tones = { neutral: { color: 'var(--zm-fg)', rule: 'var(--zm-fg-3)' }, good: { color: 'var(--zm-success)', rule: 'var(--zm-success)' }, warn: { color: 'var(--zm-warning)', rule: 'var(--zm-warning)' }, bad: { color: 'var(--zm-danger)', rule: 'var(--zm-danger)' } }[tone] || { color: 'var(--zm-fg)', rule: 'var(--zm-fg-3)' };
  return (<div style={{ flex: 1, minWidth: 140, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10, borderTop: '2px solid ' + tones.rule }}><span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>{label}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 22, fontWeight: 600, color: tones.color, lineHeight: 1.1 }}>{value}</span>{sub && (<span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{sub}</span>)}</div>);
}

function StagingKpiStripSupervisor({ sites }) {
  const uploaded = sites.filter(s => s.loiUploaded);
  const draftToLoiDays = uploaded.map(s => daysBetweenISO(s.draftDate, s.loiUploadedAt)).filter(n => Number.isFinite(n));
  const medDraftToLoi = median(draftToLoiDays);
  const onTime = uploaded.filter(s => (s.daysToLOI ?? 0) <= s.expectedLoiDays).length;
  const late = uploaded.filter(s => (s.daysToLOI ?? 0) > s.expectedLoiDays).length;
  const hitRate = uploaded.length ? Math.round((onTime / uploaded.length) * 100) : null;
  if (sites.length === 0) return null;
  // "LOIs awaiting legal" / "Awaiting LOI" used to live here as static tiles;
  // they are now the clickable StateKpiTile filters rendered below the strip.
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <KpiTile label="Median · draft → LOI" value={medDraftToLoi == null ? '—' : `${medDraftToLoi}d`} sub={uploaded.length ? `${uploaded.length} LOI${uploaded.length === 1 ? '' : 's'} uploaded` : 'no LOIs yet'}/>
      <KpiTile label="LOI on-time rate" value={hitRate == null ? '—' : `${hitRate}%`} sub={uploaded.length ? `${onTime} on time · ${late} late` : 'pending uploads'} tone={hitRate == null ? 'neutral' : hitRate >= 80 ? 'good' : hitRate >= 50 ? 'warn' : 'bad'}/>
    </div>
  );
}

function StagingFilterBar({ filters, onFilters, sites }) {
  const cities = ['All', ...Array.from(new Set(sites.map(s => s.city)))];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 10, padding: 14, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ position: 'relative', minWidth: 0 }}><Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--zm-fg-3)', pointerEvents: 'none' }}/><input placeholder="Search site…" value={filters.q} onChange={(e) => onFilters({ ...filters, q: e.target.value })} style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', height: 36, padding: '0 10px 0 32px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}/></div>
      <select value={filters.city} onChange={(e) => onFilters({ ...filters, city: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}>{cities.map(c => <option key={c} value={c}>City · {c}</option>)}</select>
      <select value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}><option value="all">Status · all</option><option value="overdue">Status · overdue or late</option><option value="ontime">Status · on time</option></select>
      <select value={filters.month} onChange={(e) => onFilters({ ...filters, month: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}>{['All','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => <option key={m} value={m}>Approved · {m}</option>)}</select>
    </div>
  );
}

function TimelineTracker({ site }) {
  const target = site.expectedLoiDays; const actual = site.daysToLOI ?? site.daysSinceApproval;
  const late = actual > target; const pct = Math.max(0, Math.min(100, (actual / Math.max(target, actual)) * 100));
  const uploaded = site.loiUploaded;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, whiteSpace: 'nowrap' }}><span style={{ color: 'var(--zm-fg-3)' }}>{site.draftDate || site.approvedDate}</span><span style={{ color: late ? 'var(--zm-danger)' : '#005F60', fontWeight: 600 }}>{actual}d / {target}d</span><span style={{ color: 'var(--zm-fg-3)' }}>{site.loiUploadedAt || '—'}</span></div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--zm-surface-sunken)', position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: late ? 'var(--zm-danger)' : '#005F60', borderRadius: 999, transition: 'width 360ms var(--zm-ease-emp)' }}/><span style={{ position: 'absolute', left: `${Math.min(100, (target/Math.max(target,actual))*100)}%`, top: -3, bottom: -3, width: 2, background: 'var(--zm-fg-3)', opacity: 0.4 }}/></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--zm-font-body)', fontSize: 10.5, fontWeight: 600, color: uploaded ? (late ? 'var(--zm-danger)' : 'var(--zm-success)') : (late ? 'var(--zm-warning)' : 'var(--zm-fg-3)'), whiteSpace: 'nowrap' }}>
        {uploaded
          ? (late ? <><Icon name="alert" size={10}/> Uploaded {actual - target}d late</> : <><Icon name="check" size={10}/> Uploaded {target - actual}d early</>)
          : (late ? <><Icon name="alert" size={10}/> LOI overdue by {actual - target}d</> : <><Icon name="clock" size={10}/> Awaiting LOI upload</>)}
      </div>
    </div>
  );
}

function SupervisorRow({ site, onPush, onViewLOI, onOpen, onViewStatus }) {
  const pushed = site.pushed;
  const uploaded = site.loiUploaded;
  return (
    <div className="zm-row" data-site-id={site.id} style={{ display: 'grid', gridTemplateColumns: '70px minmax(130px, 0.9fr) 70px 124px minmax(170px, 1.3fr) 170px', alignItems: 'center', gap: 10, padding: '14px 12px', borderBottom: '1px solid var(--zm-line-faint)', background: pushed ? 'rgba(4,120,87,0.04)' : 'transparent', opacity: pushed ? 0.85 : 1 }}>
      <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{site.caCode || site.code}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--zm-fg)' }}>{site.name}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>by {site.createdBy}</span></div>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{site.city}</span>
      <div><StatusPill stage={pushed ? site.stage : uploaded ? 'uploaded' : 'staging'}/></div>
      <div style={{ minWidth: 0, overflow: 'hidden' }}><TimelineTracker site={site}/></div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', minWidth: 0 }}>
        <button onClick={() => onOpen(site)} title="View site" className="zm-icon-btn" style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--zm-line)', borderRadius: 7, background: 'transparent', color: 'var(--zm-fg)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 32px' }}><EyeIcon size={14}/></button>
        <button onClick={() => uploaded && onViewLOI(site)} disabled={!uploaded} title={uploaded ? 'View LOI' : 'LOI not uploaded yet'} className="zm-icon-btn" style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--zm-line)', borderRadius: 7, background: 'transparent', color: uploaded ? 'var(--zm-fg)' : 'var(--zm-fg-3)', cursor: uploaded ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 32px', opacity: uploaded ? 1 : 0.55 }}><Icon name="file" size={14}/></button>
        {pushed
          ? (<button onClick={() => onViewStatus(site)} className="zm-btn-primary" style={{ flex: '1 1 auto', minWidth: 100, height: 32, padding: '0 12px', border: 'none', borderRadius: 7, background: 'var(--zm-fg)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1 }}>View <Icon name="arrow" size={12}/></button>)
          : uploaded
            ? (<button onClick={() => onPush(site)} className="zm-btn-primary" style={{ flex: '1 1 auto', minWidth: 100, height: 32, padding: '0 12px', border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1, boxShadow: 'var(--zm-shadow-1)' }}>Push <Icon name="arrow" size={12}/></button>)
            : (<button disabled className="zm-btn" style={{ flex: '1 1 auto', minWidth: 100, height: 32, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface-2)', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1 }}>Awaiting LOI</button>)
        }
      </div>
    </div>
  );
}

function applyStagingFilters(sites, f) {
  return sites.filter(s => {
    if (f.q) { const q = f.q.toLowerCase(); if (!s.name.toLowerCase().includes(q)) return false; }
    if (f.city !== 'All' && s.city !== f.city) return false;
    if (f.month !== 'All') { const m = new Date(s.approvedDate).toLocaleString('en', { month: 'short' }); if (m !== f.month) return false; }
    const late = (s.daysToLOI ?? 0) > s.expectedLoiDays;
    if (f.status === 'overdue' && !late) return false;
    if (f.status === 'ontime' && late) return false;
    return true;
  });
}

export default function SupervisorStagingPage({ onOpenSite: onOpenSiteProp, showToast: showToastProp }) {
  const ctx = usePageContext();
  const navigate = useNavigate();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  const showToast = showToastProp || ctx.showToast;
  const { staging, pushSite } = useSites();
  useFocusSite(); // scroll/flash a row reached via /staging?focus=<id>
  const [filters, setFilters] = React.useState({ q: '', city: 'All', month: 'All', status: 'all' });

  // Supervisors need to see newly approved rows before LOI upload so the
  // handoff does not appear to disappear between approval and Legal push.
  const visibleStaging = staging;
  // Sub-state indicators: Awaiting LOI = no upload yet; Awaiting approval =
  // LOI uploaded, waiting on this supervisor's push to Legal/Payments.
  const [subState, setSubState] = React.useState('all'); // all | awaiting_loi | awaiting_approval
  const awaitingLoi = visibleStaging.filter(s => !s.loiUploaded && !s.pushed);
  const awaitingApproval = visibleStaging.filter(s => s.loiUploaded && !s.pushed);
  const filtered = applyStagingFilters(visibleStaging, filters).filter(s =>
    subState === 'awaiting_loi' ? (!s.loiUploaded && !s.pushed) :
    subState === 'awaiting_approval' ? (s.loiUploaded && !s.pushed) : true,
  );

  const onPush = async (site) => {
    try {
      await pushSite(site);
      showToast?.(`Sent · ${site.name} moved to Legal review.`);
    } catch (err) {
      showToast?.(`Send failed: ${err?.detail || err?.message || 'Unknown error'}`, 'danger');
    }
  };
  const onViewLOI = (site) => { showToast?.(`Opening LOI · ${site.name} (mock).`); };
  const onViewStatus = (site) => { navigate(bdSiteStatusRoute(site.id)); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <PageHeader file="№ 04" eyebrow="Workflow · Sites in process" title={<>Sites <em>awaiting</em> handoff</>}
          lede={`${visibleStaging.length} approved site${visibleStaging.length === 1 ? '' : 's'}`}
          right={<HeaderTag icon="check" label="ON TRACK"/>}
        />
        <StagingKpiStripSupervisor sites={visibleStaging}/>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StateKpiTile label="Awaiting LOI" value={awaitingLoi.length} color={STAGES.staging.color} sub="no LOI uploaded yet" active={subState === 'awaiting_loi'} onClick={() => setSubState(s => s === 'awaiting_loi' ? 'all' : 'awaiting_loi')}/>
          <StateKpiTile label="Awaiting approval" value={awaitingApproval.length} color={STAGES.uploaded.color} sub="LOI uploaded · push to Legal" active={subState === 'awaiting_approval'} onClick={() => setSubState(s => s === 'awaiting_approval' ? 'all' : 'awaiting_approval')}/>
        </div>
        <StagingFilterBar filters={filters} onFilters={setFilters} sites={visibleStaging}/>
      </div>
      <div className="zm-glass" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div>
            <div style={{ position: 'sticky', top: 0, zIndex: 10, display: 'grid', gridTemplateColumns: '70px minmax(130px, 0.9fr) 70px 124px minmax(170px, 1.3fr) 170px', gap: 10, padding: '11px 12px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
              <span>Code</span><span>Site</span><span>City</span><span>Status</span><span>Draft → LOI timeline</span>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}><span aria-hidden="true" style={{ width: 32, flex: '0 0 32px' }}/><span aria-hidden="true" style={{ width: 32, flex: '0 0 32px' }}/><span style={{ flex: '1 1 auto', minWidth: 100, textAlign: 'center' }}>Action</span></div>
            </div>
            {filtered.map(s => <SupervisorRow key={s.id} site={s} onPush={onPush} onViewLOI={onViewLOI} onOpen={onOpenSite || (() => {})} onViewStatus={onViewStatus}/>)}
          </div>
          {filtered.length === 0 && (<div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>No sites are in process yet.</div>)}
        </div>
      </div>
    </div>
  );
}
