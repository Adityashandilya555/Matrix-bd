import React from 'react';
import { useSession } from '../../../state/SessionContext.jsx';
import { useSites } from '../../../state/SitesContext.jsx';
import { usePageContext } from '../../../App.jsx';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import StatusPill from '../../shared/primitives/StatusPill.jsx';

// Render bodies preserved exactly from Staging.jsx — exec-only view.

const daysBetweenISO = (a, b) => { if (!a || !b) return null; const da = new Date(a + 'T00:00'); const db = new Date(b + 'T00:00'); return Math.round((db - da) / 86400000); };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m-1] + s[m]) / 2); };

function EyeIcon({ size = 14 }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>);
}

function KpiTile({ label, value, sub, tone = 'neutral' }) {
  const tones = { neutral: { color: 'var(--zm-fg)', rule: 'var(--zm-fg-3)' }, good: { color: 'var(--zm-success)', rule: 'var(--zm-success)' }, warn: { color: 'var(--zm-warning)', rule: 'var(--zm-warning)' }, bad: { color: 'var(--zm-danger)', rule: 'var(--zm-danger)' } }[tone] || { color: 'var(--zm-fg)', rule: 'var(--zm-fg-3)' };
  return (<div style={{ flex: 1, minWidth: 140, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10, borderTop: '2px solid ' + tones.rule }}><span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>{label}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 22, fontWeight: 600, color: tones.color, lineHeight: 1.1 }}>{value}</span>{sub && (<span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{sub}</span>)}</div>);
}

function StagingKpiStrip({ sites }) {
  const uploaded = sites.filter(s => s.loiUploaded);
  const draftToLoiDays = uploaded.map(s => daysBetweenISO(s.draftDate, s.loiUploadedAt)).filter(n => Number.isFinite(n));
  const medDraftToLoi = median(draftToLoiDays);
  const onTime = uploaded.filter(s => (s.daysToLOI ?? 0) <= s.expectedLoiDays).length;
  const late = uploaded.filter(s => (s.daysToLOI ?? 0) > s.expectedLoiDays).length;
  const open = sites.filter(s => !s.loiUploaded);
  const overdue = open.filter(s => s.daysSinceApproval > s.expectedLoiDays).length;
  const dueSoon = open.filter(s => { const r = s.expectedLoiDays - s.daysSinceApproval; return r >= 0 && r <= 3; }).length;
  const hitRate = uploaded.length ? Math.round((onTime / uploaded.length) * 100) : null;
  if (sites.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <KpiTile label="Median · draft → LOI" value={medDraftToLoi == null ? '—' : `${medDraftToLoi}d`} sub={uploaded.length ? `${uploaded.length} LOI${uploaded.length === 1 ? '' : 's'} uploaded` : 'no LOIs yet'}/>
      <KpiTile label="LOI on-time rate" value={hitRate == null ? '—' : `${hitRate}%`} sub={uploaded.length ? `${onTime} on time · ${late} late` : 'pending uploads'} tone={hitRate == null ? 'neutral' : hitRate >= 80 ? 'good' : hitRate >= 50 ? 'warn' : 'bad'}/>
      <KpiTile label="Due in ≤ 3 days" value={String(dueSoon).padStart(2,'0')} sub="upload before timer expires" tone={dueSoon > 0 ? 'warn' : 'neutral'}/>
      <KpiTile label="Past expected LOI" value={String(overdue).padStart(2,'0')} sub={overdue > 0 ? 'flagged for supervisor' : 'no overdue sites'} tone={overdue > 0 ? 'bad' : 'good'}/>
    </div>
  );
}

function StagingFilterBar({ filters, onFilters, sites }) {
  const cities = ['All', ...Array.from(new Set(sites.map(s => s.city)))];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 10, padding: 14, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ position: 'relative', minWidth: 0 }}><Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--zm-fg-3)', pointerEvents: 'none' }}/><input placeholder="Search site…" value={filters.q} onChange={(e) => onFilters({ ...filters, q: e.target.value })} style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', height: 36, padding: '0 10px 0 32px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}/></div>
      <select value={filters.city} onChange={(e) => onFilters({ ...filters, city: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}>{cities.map(c => <option key={c} value={c}>City · {c}</option>)}</select>
      <select value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}><option value="all">Status · all</option><option value="ontime">Status · on time</option><option value="overdue">Status · overdue</option><option value="uploaded">Status · uploaded</option></select>
      <select value={filters.month} onChange={(e) => onFilters({ ...filters, month: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}>{['All','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => <option key={m} value={m}>Approved · {m}</option>)}</select>
    </div>
  );
}

function applyStagingFilters(sites, f) {
  return sites.filter(s => {
    if (f.q) { const q = f.q.toLowerCase(); if (!s.name.toLowerCase().includes(q)) return false; }
    if (f.city !== 'All' && s.city !== f.city) return false;
    if (f.month !== 'All') { const m = new Date(s.approvedDate).toLocaleString('en', { month: 'short' }); if (m !== f.month) return false; }
    const overdue = s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded;
    if (f.status === 'overdue' && !overdue) return false;
    if (f.status === 'ontime' && (overdue || s.loiUploaded)) return false;
    if (f.status === 'uploaded' && !s.loiUploaded) return false;
    return true;
  });
}

function ExecRow({ site, onUpload, onOpen }) {
  const remaining = site.expectedLoiDays - site.daysSinceApproval;
  const overdue = remaining < 0;
  const uploaded = site.loiUploaded;
  const fileRef = React.useRef(null);
  const handleFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onUpload(site, f);
  };
  return (
    <div className="zm-row" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 1fr 1.4fr 170px', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--zm-line-faint)', background: overdue && !uploaded ? 'rgba(217,119,6,0.06)' : 'transparent', position: 'relative' }}>
      {overdue && !uploaded && (<span style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, background: 'var(--zm-warning)', borderRadius: 2 }}/>)}
      <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{site.code}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--zm-fg)' }}>{site.name}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>by {site.createdBy}</span></div>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{site.city}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg)' }}>{site.approvedDate}</span><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, color: 'var(--zm-fg-3)' }}>by {site.approvedBy}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{String(site.daysSinceApproval).padStart(2,'0')} / {site.expectedLoiDays} d</span><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 500, color: uploaded ? '#005F60' : overdue ? 'var(--zm-warning)' : 'var(--zm-fg-3)' }}>{uploaded ? 'LOI uploaded' : overdue ? `${Math.abs(remaining)}d overdue` : `${remaining}d remaining`}</span></div>
      <div>{uploaded ? <StatusPill stage="uploaded"/> : overdue ? <StatusPill stage="overdue"/> : <StatusPill stage="staging"/>}</div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={() => onOpen(site)} title="View" className="zm-icon-btn" style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><EyeIcon/></button>
        {uploaded ? (<button disabled style={{ height: 32, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={12}/> Uploaded</button>) : (<><input ref={fileRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFile}/><button onClick={() => fileRef.current?.click()} className="zm-btn-primary" style={{ height: 32, padding: '0 12px', border: 'none', borderRadius: 7, background: overdue ? 'var(--zm-warning)' : 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: 'var(--zm-shadow-1)' }}><Icon name="upload" size={12}/> Upload LOI</button></>)}
      </div>
    </div>
  );
}

export default function ExecStagingPage({ onOpenSite: onOpenSiteProp, showToast: showToastProp }) {
  const ctx = usePageContext();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  const showToast = showToastProp || ctx.showToast;
  const { user } = useSession();
  const { staging, uploadLOI } = useSites();
  const [filters, setFilters] = React.useState({ q: '', city: 'All', month: 'All', status: 'all' });

  const ME = user.name;
  const visibleStaging = staging.filter(s => s.createdBy === ME);
  const filtered = applyStagingFilters(visibleStaging, filters);
  const overdueCount = visibleStaging.filter(s => s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded).length;

  const onUpload = async (site, file) => {
    try {
      await uploadLOI(site, file);
      showToast?.(`LOI uploaded · ${file.name} · ${site.name}. Supervisor will review and push.`);
    } catch (err) {
      showToast?.(`LOI upload failed: ${err?.detail || err?.message || 'Unknown error'}`, 'danger');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader file="№ 04" eyebrow="Workflow · Sites in process" title={<>Sites <em>awaiting</em> LOI</>}
        lede={`${visibleStaging.length} of your own approved site${visibleStaging.length === 1 ? '' : 's'} — ${overdueCount} overdue against expected timeline.`}
        right={overdueCount > 0 ? <HeaderTag icon="alert" label={`${overdueCount} OVERDUE`} tone="accent"/> : <HeaderTag icon="check" label="ON TRACK"/>}
      />
      <StagingKpiStrip sites={visibleStaging}/>
      <StagingFilterBar filters={filters} onFilters={setFilters} sites={visibleStaging}/>
      <div className="zm-glass" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1080 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 1fr 1.4fr 170px', gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
              <span>Code</span><span>Site</span><span>City</span><span>Approved</span><span>LOI timeline</span><span>Status</span><span style={{ textAlign: 'right' }}>Action</span>
            </div>
            {filtered.map(s => <ExecRow key={s.id} site={s} onUpload={onUpload} onOpen={onOpenSite || (() => {})}/>)}
          </div>
          {filtered.length === 0 && (<div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>No sites match these filters.</div>)}
        </div>
      </div>
    </div>
  );
}
