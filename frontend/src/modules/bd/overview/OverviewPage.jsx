import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../state/SessionContext.jsx';
import { useSites } from '../../../state/SitesContext.jsx';
import { usePageContext } from '../../../App.jsx';
import { can } from '../../../rbac/permissions.js';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Avatar from '../../shared/primitives/Avatar.jsx';
import StatusPill from '../../shared/primitives/StatusPill.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { STAGES } from '../../shared/primitives/constants.js';
import { ROUTES } from '../../../router/routes.js';

// MetricCard, MetricStrip, PipelineFilter — render bodies preserved from Pipeline.jsx

function CornerTicks() {
  return (
    <>
      {[
        { top: 0, left: 0, rot: 0 },
        { top: 0, right: 0, rot: 90 },
        { bottom: 0, right: 0, rot: 180 },
        { bottom: 0, left: 0, rot: -90 },
      ].map((p, i) => (
        <span key={i} style={{
          position: 'absolute', width: 8, height: 8, ...p,
          borderTop: '1px solid var(--zm-fg-3)', borderLeft: '1px solid var(--zm-fg-3)',
          opacity: 0.35,
          transform: `rotate(${p.rot}deg)`,
          margin: 6,
        }}/>
      ))}
    </>
  );
}

function MetricCard({ eyebrow, value, rule = 'var(--zm-copper)', delta, deltaTone = 'pos', sub, no }) {
  return (
    <div className="zm-glass" style={{
      borderRadius: 16, padding: '24px 26px 26px',
      display: 'flex', flexDirection: 'column', gap: 12,
      position: 'relative', overflow: 'hidden',
      transition: 'transform 200ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms cubic-bezier(0.22,1,0.36,1)',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--zm-shadow-3)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--zm-glass)'; }}
    >
      <span aria-hidden="true" style={{
        position: 'absolute', inset: '0 0 auto 0', height: 1,
        background: 'linear-gradient(90deg, transparent, ' + rule + ', transparent)', opacity: 0.6,
      }}/>
      <CornerTicks/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {no && (
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--zm-fg-4)', flex: '0 0 auto' }}>{no}</span>
        )}
        <span style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
          letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
        }}>{eyebrow}</span>
      </div>
      <span style={{
        fontFamily: 'var(--zm-font-serif)', fontWeight: 400, fontStyle: 'italic',
        fontSize: 68, letterSpacing: '-0.025em', color: 'var(--zm-fg)', lineHeight: 0.95,
        fontFeatureSettings: "'tnum' 1",
      }}>{value}</span>
      <span style={{ width: 36, height: 1, background: rule, opacity: 0.7 }}/>
      {delta && (
        <span style={{
          fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, letterSpacing: 0,
          color: deltaTone === 'pos' ? 'var(--zm-success)' : deltaTone === 'neg' ? 'var(--zm-danger)' : 'var(--zm-fg-3)',
        }}>{delta}</span>
      )}
      {sub && <span style={{ fontFamily: 'var(--zm-font-serif)', fontStyle: 'italic', fontSize: 13, color: 'var(--zm-fg-3)' }}>{sub}</span>}
    </div>
  );
}

function MetricStrip({ metrics }) {
  const m = metrics || { inMotion: { value: 0, sub: 'no data' }, drafts: { value: 0, sub: 'no data' }, shortlist: { value: 0, sub: 'no data' }, loi: { value: 0, sub: 'no data' } };
  return (
    <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      <MetricCard no="Ⅰ" eyebrow="Sites"              value={m.inMotion.value}  rule="var(--zm-accent)"  delta={m.inMotion.delta}  sub={m.inMotion.sub}/>
      <MetricCard no="Ⅱ" eyebrow="New drafts"         value={m.drafts.value}    rule="var(--zm-fg-3)"    delta={m.drafts.delta}    sub={m.drafts.sub}/>
      <MetricCard no="Ⅲ" eyebrow="Shortlist"          value={m.shortlist.value} rule="var(--zm-info)"    delta={m.shortlist.delta} sub={m.shortlist.sub}/>
      <MetricCard no="Ⅳ" eyebrow="LOI due / overdue"  value={m.loi.value}       rule="var(--zm-copper)"  delta={m.loi.delta} deltaTone={m.loi.deltaTone || 'neutral'} sub={m.loi.sub}/>
    </div>
  );
}

// PipelineFilter — render body preserved from Pipeline.jsx
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PRESETS = [
  { id: 'today', label: 'Today', days: 0 },
  { id: 'week', label: 'Last 7 days', days: 7 },
  { id: 'month', label: 'Last 30 days', days: 30 },
  { id: 'thisMo', label: 'This month', kind: 'thisMonth' },
  { id: 'lastMo', label: 'Last month', kind: 'lastMonth' },
  { id: 'q', label: 'This quarter', kind: 'thisQuarter' },
  { id: 'ytd', label: 'YTD', kind: 'ytd' },
];
const fmtISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtNice = (iso) => iso ? new Date(iso + 'T00:00').toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function presetRange(p) {
  const now = new Date();
  if (p.days != null) { const end = now; const start = p.days === 0 ? now : addDays(now, -p.days); return { from: fmtISO(start), to: fmtISO(end) }; }
  if (p.kind === 'thisMonth') return { from: fmtISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmtISO(new Date(now.getFullYear(), now.getMonth()+1, 0)) };
  if (p.kind === 'lastMonth') return { from: fmtISO(new Date(now.getFullYear(), now.getMonth()-1, 1)), to: fmtISO(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p.kind === 'thisQuarter') { const q = Math.floor(now.getMonth()/3); return { from: fmtISO(new Date(now.getFullYear(), q*3, 1)), to: fmtISO(new Date(now.getFullYear(), q*3+3, 0)) }; }
  if (p.kind === 'ytd') return { from: fmtISO(new Date(now.getFullYear(), 0, 1)), to: fmtISO(now) };
  return { from: '', to: '' };
}

function RangeCalendar({ from, to, onChange }) {
  const [view, setView] = React.useState(() => { const seed = from ? new Date(from + 'T00:00') : new Date(); return { y: seed.getFullYear(), m: seed.getMonth() }; });
  React.useEffect(() => { if (!from) return; const d = new Date(from + 'T00:00'); setView(v => (v.y === d.getFullYear() && v.m === d.getMonth()) ? v : { y: d.getFullYear(), m: d.getMonth() }); }, [from]);
  const monthStart = new Date(view.y, view.m, 1); const monthEnd = new Date(view.y, view.m + 1, 0);
  const startDow = monthStart.getDay(); const daysInMonth = monthEnd.getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.y, view.m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const fromD = from ? new Date(from + 'T00:00') : null; const toD = to ? new Date(to + 'T00:00') : null;
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const inRange = (d) => fromD && toD && d > fromD && d < toD;
  const pick = (d) => { if (!d) return; const iso = fmtISO(d); if (!from || (from && to)) return onChange({ from: iso, to: '' }); if (iso === from) return onChange({ from: iso, to: iso }); if (iso < from) return onChange({ from: iso, to: from }); return onChange({ from, to: iso }); };
  const shift = (delta) => setView(v => { let y = v.y, m = v.m + delta; while (m < 0) { m += 12; y--; } while (m > 11) { m -= 12; y++; } return { y, m }; });
  return (
    <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 248 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => shift(-1)} className="zm-icon-btn" style={{ width: 24, height: 24, padding: 0, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
        <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--zm-fg)' }}>{MONTH_NAMES[view.m]} {view.y}</span>
        <button onClick={() => shift(1)} className="zm-icon-btn" style={{ width: 24, height: 24, padding: 0, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {['S','M','T','W','T','F','S'].map((d, i) => (<span key={i} style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-4)', textAlign: 'center', padding: '4px 0' }}>{d}</span>))}
        {cells.map((d, i) => { if (!d) return <span key={i} style={{ height: 28 }}/>; const startSel = sameDay(d, fromD); const endSel = sameDay(d, toD); const within = inRange(d) && !startSel && !endSel; return (<button key={i} onClick={() => pick(d)} className="zm-cal-day" data-state={startSel ? 'start' : endSel ? 'end' : within ? 'within' : 'idle'} style={{ height: 28, padding: 0, border: 'none', borderRadius: startSel ? '999px 0 0 999px' : endSel ? '0 999px 999px 0' : within ? 0 : 6, background: (startSel || endSel) ? 'var(--zm-accent)' : within ? 'var(--zm-accent-soft)' : 'transparent', color: (startSel || endSel) ? '#fff' : within ? 'var(--zm-accent)' : 'var(--zm-fg)', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 12, fontWeight: (startSel || endSel) ? 700 : 500, cursor: 'pointer' }}>{d.getDate()}</button>); })}
      </div>
    </div>
  );
}

function MoreFilters({ value, onChange, onClose }) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth()-i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}` }); }
  const setMonth = (k) => { if (value.month === k) return onChange({ ...value, month: '' }); onChange({ ...value, month: k, from: '', to: '', preset: '' }); };
  const setPreset = (p) => { const r = presetRange(p); onChange({ ...value, preset: p.id, month: '', ...r }); };
  const setRange = (r) => onChange({ ...value, ...r, preset: '', month: '' });
  const clear = () => onChange({ month: '', preset: '', from: '', to: '' });
  return (
    <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 30, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, boxShadow: 'var(--zm-shadow-pop)', width: 560, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, animation: 'zm-rise 200ms var(--zm-ease-emp)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div><h4 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 14, color: 'var(--zm-fg)' }}>More filters</h4><p style={{ margin: '2px 0 0', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>Narrow by visit-date month, preset window, or custom range.</p></div>
        <button onClick={clear} className="zm-link-btn" style={{ background: 'transparent', border: 'none', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>Clear all</button>
      </div>
      <section><span style={{ display: 'block', fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 8 }}>By month · visit date</span><div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>{months.map(m => { const on = value.month === m.key; return (<button key={m.key} onClick={() => setMonth(m.key)} className="zm-pill" style={{ height: 30, padding: '0 8px', borderRadius: 7, border: '1px solid ' + (on ? 'var(--zm-accent)' : 'var(--zm-line)'), background: on ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', color: on ? 'var(--zm-accent)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-mono)', fontSize: 11, fontWeight: on ? 700 : 600, cursor: 'pointer' }}>{m.label}</button>); })}</div></section>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16 }}>
        <section><span style={{ display: 'block', fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 8 }}>Preset window</span><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{PRESETS.map(p => { const on = value.preset === p.id; return (<button key={p.id} onClick={() => setPreset(p)} style={{ textAlign: 'left', height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid ' + (on ? 'var(--zm-accent)' : 'transparent'), background: on ? 'var(--zm-accent-soft)' : 'transparent', color: on ? 'var(--zm-accent)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: on ? 600 : 500, cursor: 'pointer' }}>{p.label}</button>); })}</div></section>
        <section><span style={{ display: 'block', fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 8 }}>Custom range</span><RangeCalendar from={value.from} to={value.to} onChange={setRange}/></section>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--zm-bg-2)' }}>
        <Icon name="calendar" size={13} style={{ color: 'var(--zm-fg-3)' }}/>
        <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-2)' }}>{value.month ? <>Month: <strong style={{ color: 'var(--zm-fg)' }}>{months.find(m => m.key === value.month)?.label}</strong></> : (value.from || value.to) ? <>Range: <strong style={{ color: 'var(--zm-fg)' }}>{fmtNice(value.from)}</strong> → <strong style={{ color: 'var(--zm-fg)' }}>{fmtNice(value.to)}</strong></> : <>No date filter applied · showing all sites</>}</span>
        <span style={{ flex: 1 }}/>
        <button onClick={onClose} style={{ height: 30, padding: '0 14px', borderRadius: 7, border: 'none', background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
      </div>
    </div>
  );
}

function FilterChip({ active, label, count, color, onClick }) {
  return (
    <button onClick={onClick} className="zm-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid ' + (active ? 'var(--zm-fg)' : 'var(--zm-line)'), background: active ? 'var(--zm-fg)' : 'var(--zm-surface)', color: active ? '#fff' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 120ms var(--zm-ease)' }}>
      {color && <span style={{ width: 6, height: 6, borderRadius: 999, background: color }}/>}
      {label}
      {count != null && (<span style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 500, fontSize: 11, color: active ? 'rgba(255,255,255,0.7)' : 'var(--zm-fg-3)' }}>{count}</span>)}
    </button>
  );
}

function PipelineFilter({ stage, onStage, counts, advanced, onAdvanced }) {
  const [open, setOpen] = React.useState(false);
  const adv = advanced || { month: '', preset: '', from: '', to: '' };
  const active = !!(adv.month || adv.preset || adv.from || adv.to);
  const popRef = React.useRef(null);
  React.useEffect(() => { if (!open) return; const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false); }; const onKey = (e) => { if (e.key === 'Escape') setOpen(false); }; const t = setTimeout(() => { document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey); }, 0); return () => { clearTimeout(t); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey); }; }, [open]);
  const summary = adv.month ? `Month · ${adv.month.slice(5)}/${adv.month.slice(2,4)}` : adv.preset ? PRESETS.find(p => p.id === adv.preset)?.label : (adv.from && adv.to) ? `${adv.from} → ${adv.to}` : adv.from ? `from ${adv.from}` : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
      <FilterChip label="All"       count={counts.all}       active={stage === 'all'}       onClick={() => onStage('all')}/>
      <FilterChip label="Draft"     count={counts.draft}     active={stage === 'draft'}     onClick={() => onStage('draft')}     color={STAGES.draft.color}/>
      <FilterChip label="Shortlist" count={counts.shortlist} active={stage === 'shortlist'} onClick={() => onStage('shortlist')} color={STAGES.shortlist.color}/>
      <FilterChip label="Staging"   count={counts.staging}   active={stage === 'staging'}   onClick={() => onStage('staging')}   color={STAGES.staging.color}/>
      <span style={{ flex: 1 }}/>
      {active && (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 999, background: 'var(--zm-accent-soft)', color: 'var(--zm-accent)', fontFamily: 'var(--zm-font-mono)', fontSize: 11, fontWeight: 600 }}><Icon name="calendar" size={11}/> {summary}<button onClick={() => onAdvanced({ month: '', preset: '', from: '', to: '' })} style={{ background: 'transparent', border: 'none', color: 'inherit', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', marginLeft: 4, opacity: 0.7 }}><Icon name="x" size={11}/></button></span>)}
      <div ref={popRef} style={{ position: 'relative' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid ' + (active || open ? 'var(--zm-accent)' : 'var(--zm-line)'), background: active || open ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', color: active || open ? 'var(--zm-accent)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1 }}><Icon name="filter" size={13}/> More filters{active && <span style={{ background: 'var(--zm-accent)', color: '#fff', width: 16, height: 16, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--zm-font-mono)', fontSize: 9.5, fontWeight: 700, marginLeft: 2 }}>•</span>}</button>
        {open && <MoreFilters value={adv} onChange={(v) => onAdvanced(v)} onClose={() => setOpen(false)}/>}
      </div>
    </div>
  );
}

// MotionTable — render body preserved from App.jsx
function MotionTable({ rows, onOpen }) {
  return (
    <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.7fr 1fr 1fr 0.7fr 1.1fr 1.2fr', gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
        <span>Code</span><span>Site</span><span>City</span><span>Owner</span><span>Days</span><span>Stage</span><span>Detail</span>
      </div>
      {rows.slice(0, 12).map(r => (
        <div key={r.id} onClick={() => onOpen(r)} className="zm-row" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.7fr 1fr 1fr 0.7fr 1.1fr 1.2fr', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', background: r.stage === 'overdue' ? 'rgba(217,119,6,0.06)' : 'transparent', cursor: 'pointer', position: 'relative' }}>
          {r.stage === 'overdue' && <span style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, background: 'var(--zm-warning)', borderRadius: 2 }}/>}
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{r.code}</span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{r.name}</span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{r.city}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avatar name={r.owner} size={20}/><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{r.owner}</span></span>
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: r.stage === 'overdue' ? 'var(--zm-warning)' : 'var(--zm-fg)' }}>{String(r.days).padStart(2,'0')}d</span>
          <span><StatusPill stage={r.stage}/></span>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>{r.meta}</span>
        </div>
      ))}
      {rows.length === 0 && (<div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>No sites in this stage right now.</div>)}
    </div>
  );
}

// OverviewPage: wires session + sites context into the overview render.
export default function OverviewPage({ onOpenSite: onOpenSiteProp }) {
  const navigate = useNavigate();
  const ctx = usePageContext();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  // onNavigate: maps legacy string view names to URL routes
  const onNavigate = (view) => {
    if (view === 'pipeline') navigate(ROUTES.PIPELINE);
    else if (view === 'shortlist') navigate(ROUTES.SHORTLIST);
    else if (view === 'staging') navigate(ROUTES.STAGING);
    else if (view === 'overview') navigate(ROUTES.OVERVIEW);
  };
  const { role, user } = useSession();
  const { drafts, shortlist, staging } = useSites();
  const [stage, setStage] = React.useState('all');
  const [advanced, setAdvanced] = React.useState({ month: '', preset: '', from: '', to: '' });

  const ME = user.name;
  // RBAC: isExec = cannot shortlist (exec cannot approve); used for scope/display logic in render body
  const isExec = !can(role, 'shortlist');
  const visibleDrafts    = isExec ? drafts.filter(d => d.createdBy === ME) : drafts;
  const visibleShortlist = isExec ? shortlist.filter(s => s.createdBy === ME) : shortlist;
  const visibleStaging   = isExec ? staging.filter(s => s.createdBy === ME) : staging.filter(s => s.loiUploaded === true);

  const loiDue     = visibleStaging.filter(s => !s.loiUploaded && s.daysSinceApproval <= s.expectedLoiDays).length;
  const loiOverdue = visibleStaging.filter(s => !s.loiUploaded && s.daysSinceApproval > s.expectedLoiDays).length;
  const inReview   = visibleShortlist.filter(s => s.inReview).length;
  const oldestDraft = visibleDrafts.reduce((m, d) => Math.max(m, d.days || 0), 0);
  const staleDrafts = role === 'supervisor' ? visibleDrafts.filter(d => d.days > 7).length : 0;
  const totalMotion = visibleDrafts.length + visibleShortlist.length + visibleStaging.length;
  const cityCount = new Set([...visibleDrafts.map(d => d.city), ...visibleShortlist.map(s => s.city), ...visibleStaging.map(s => s.city)]).size;

  const metrics = {
    inMotion: { value: String(totalMotion).padStart(2,'0'), delta: isExec ? `your sites · ${ME.split(' ')[0]}` : 'tenant-wide', sub: `across ${cityCount} cit${cityCount === 1 ? 'y' : 'ies'}` },
    drafts: { value: String(visibleDrafts.length).padStart(2,'0'), delta: oldestDraft > 0 ? `oldest · ${oldestDraft}d` : 'none open', deltaTone: staleDrafts > 0 ? 'neg' : 'pos', sub: role === 'supervisor' ? (staleDrafts > 0 ? `${staleDrafts} past 7-day SLA` : 'awaiting your decision') : 'awaiting supervisor' },
    shortlist: { value: String(visibleShortlist.length).padStart(2,'0'), delta: inReview > 0 ? `${inReview} in review` : 'all need details', sub: role === 'supervisor' ? 'ready to approve' : 'fill 17 fields' },
    loi: { value: String(loiOverdue + loiDue).padStart(2,'0'), delta: loiOverdue > 0 ? `▲ ${loiOverdue} overdue` : 'on track', deltaTone: loiOverdue > 0 ? 'neg' : 'pos', sub: `${loiDue} due · ${loiOverdue} past timeline` },
  };

  const allMotion = [
    ...visibleDrafts.map(d => ({ id: d.id, code: d.code, name: d.name, city: d.city, stage: 'draft', days: d.days, owner: d.createdBy, when: d.visitDate, meta: 'visit ' + d.visitDate })),
    ...visibleShortlist.map(s => ({ id: s.code, code: s.code, name: s.name, city: s.city, stage: s.inReview ? 'inReview' : 'shortlist', days: 3, owner: s.createdBy, when: s.visitDate, meta: s.inReview ? 'in review' : 'awaiting details' })),
    ...visibleStaging.map(s => { const overdue = s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded; return { id: s.id, code: s.code, name: s.name, city: s.city, stage: s.pushed ? 'completed' : s.loiUploaded ? 'uploaded' : (overdue ? 'overdue' : 'staging'), days: s.daysSinceApproval, owner: s.createdBy, when: s.draftDate || s.approvedDate, meta: `LOI ${s.daysSinceApproval}/${s.expectedLoiDays}d` }; }),
  ];

  const stageFiltered = stage === 'all' ? allMotion : allMotion.filter(r => {
    if (stage === 'staging') return ['staging','overdue','uploaded','completed'].includes(r.stage);
    if (stage === 'shortlist') return ['shortlist','inReview'].includes(r.stage);
    return r.stage === stage;
  });

  const filteredMotion = stageFiltered.filter(r => {
    if (!r.when) return true;
    if (advanced.month) return r.when.slice(0,7) === advanced.month;
    if (advanced.from || advanced.to) { if (advanced.from && r.when < advanced.from) return false; if (advanced.to && r.when > advanced.to) return false; }
    return true;
  });

  const counts = { pipeline: visibleDrafts.length, shortlist: visibleShortlist.length, staging: visibleStaging.length, archive: 0 };

  return (
    <>
      <PageHeader
        file="№ 01" eyebrow="Overview" title="Sites"
        lede={role === 'supervisor'
          ? `Synced 2 min ago — all sites in your tenant. ${totalMotion} files across draft, shortlist and staging.`
          : `Synced 2 min ago — your sites, ${ME}. ${totalMotion} files across draft, shortlist and staging.`}
        right={<>
          <HeaderTag icon="clock" label="LIVE · 2M LAG"/>
          <HeaderTag icon="shield" label={role === 'supervisor' ? 'TENANT SCOPE' : 'PERSONAL SCOPE'} tone="accent"/>
        </>}
      />
      <div style={{ marginBottom: 18 }}><MetricStrip metrics={metrics}/></div>
      <div style={{ marginBottom: 14 }}>
        <PipelineFilter
          stage={stage} onStage={setStage}
          counts={{ all: allMotion.length, draft: counts.pipeline, shortlist: counts.shortlist, staging: counts.staging }}
          advanced={advanced} onAdvanced={setAdvanced}
        />
      </div>
      <MotionTable rows={filteredMotion} onOpen={(r) => {
        if (onNavigate) {
          if (r.stage === 'draft') onNavigate('pipeline');
          else if (['shortlist','inReview'].includes(r.stage)) onNavigate('shortlist');
          else onNavigate('staging');
        }
      }}/>
    </>
  );
}
