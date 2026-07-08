import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../state/SessionContext.jsx';
import { useSites } from '../../../state/SitesContext.jsx';
import { usePageContext } from '../../../App.jsx';
import { can } from '../../../rbac/permissions.js';
import { filterByScope } from '../../../rbac/scope.js';
import { SiteStatus } from '../../../lib/stateMachine.js';
import { useLaunchSites } from '../../../hooks/useLaunchSites.js';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Avatar from '../../shared/primitives/Avatar.jsx';
import StatusPill from '../../shared/primitives/StatusPill.jsx';
import { keyActivate } from '../../../lib/a11y.js';
import Icon from '../../shared/primitives/Icon.jsx';
import { STAGES } from '../../shared/primitives/constants.js';
import { ROUTES } from '../../../router/routes.js';

// Overview = four drill-down KPIs:
//   Ⅰ Total sites — pipeline drafts + shortlist + sites in process (pre-push;
//     archived/rejected excluded). Click → expands in place with stage boxes,
//     search and a date filter.
//   Ⅱ Archived — archived + rejected sites. Click → expands in place with a
//     calendar filter + search over the archive list.
//   Ⅲ Payments — sites pushed from Sites in process (Legal ∥ Finance). Click →
//     /payment tab (pending / awaiting approval / approved filters live there).
//   Ⅳ Launch — Project-complete sites handed to NSO. Click → /launch tab.

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

// Peach-skyline KPI fills. `tone` optional — omit to keep the original glass
// look (zero regression); set peach|blue|mint|slate to fill the card.
const TONE_FILL = {
  peach: 'var(--zm-brand-peach)',
  blue:  'var(--zm-brand-blue)',
  mint:  'var(--zm-brand-mint)',
  slate: 'var(--zm-brand-slate)',
};

function MetricCard({ eyebrow, value, rule = 'var(--zm-copper)', delta, deltaTone = 'pos', sub, no, onClick, selected = false, tone }) {
  const fill = TONE_FILL[tone];
  const toned = !!fill;
  const onColor = tone === 'slate' ? 'var(--zm-brand-on-slate)' : 'var(--zm-brand-on-pastel)';
  const ruleColor = toned ? onColor : rule;
  const valueColor = toned ? onColor : 'var(--zm-fg)';
  const metaColor = toned ? onColor : 'var(--zm-fg-3)';
  const noColor = toned ? onColor : 'var(--zm-fg-4)';
  return (
    // KPI card is interactive only when an onClick is supplied; in that branch
    // it carries role="button" + tabIndex + onKeyDown, so keyboard parity is
    // fully provided. The rule can't see the conditional role.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="zm-glass"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? keyActivate(onClick) : undefined}
      style={{
        borderRadius: 16, padding: '24px 26px 26px',
        display: 'flex', flexDirection: 'column', gap: 12,
        position: 'relative', overflow: 'hidden',
        ...(toned ? { background: fill } : {}),
        cursor: onClick ? 'pointer' : 'default',
        outline: selected ? '2px solid ' + ruleColor : 'none',
        outlineOffset: -2,
        transition: 'transform 200ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms cubic-bezier(0.22,1,0.36,1)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--zm-shadow-3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--zm-glass)'; }}
    >
      <span aria-hidden="true" style={{
        position: 'absolute', inset: '0 0 auto 0', height: 1,
        background: 'linear-gradient(90deg, transparent, ' + ruleColor + ', transparent)', opacity: toned ? 0.35 : 0.6,
      }}/>
      {!toned && <CornerTicks/>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {no && (
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: noColor, flex: '0 0 auto', opacity: toned ? 0.7 : 1 }}>{no}</span>
        )}
        <span style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
          letterSpacing: '0.22em', textTransform: 'uppercase', color: metaColor,
          lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
          opacity: toned ? 0.8 : 1,
        }}>{eyebrow}</span>
        {onClick && (
          <span style={{ color: noColor, display: 'inline-flex', flex: '0 0 auto' }}>
            <Icon name={selected ? 'x' : 'chevron'} size={12}/>
          </span>
        )}
      </div>
      <span style={{
        fontFamily: 'var(--zm-font-display)', fontWeight: 800, fontStyle: 'normal',
        fontSize: 64, letterSpacing: '-0.035em', color: valueColor, lineHeight: 0.95,
        fontVariantNumeric: 'tabular-nums',
        fontFeatureSettings: "'tnum' 1",
      }}>{value}</span>
      <span style={{ width: 36, height: 1, background: ruleColor, opacity: 0.7 }}/>
      {delta && (
        <span style={{
          fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, letterSpacing: 0,
          color: toned ? onColor : (deltaTone === 'pos' ? 'var(--zm-success)' : deltaTone === 'neg' ? 'var(--zm-danger)' : 'var(--zm-fg-3)'),
          opacity: toned ? 0.85 : 1,
        }}>{delta}</span>
      )}
      {sub && <span style={{ fontFamily: 'var(--zm-font-body)', fontStyle: 'normal', fontSize: 12.5, color: metaColor, lineHeight: 1.35, opacity: toned ? 0.78 : 1 }}>{sub}</span>}
    </div>
  );
}

// BigFilterBox — the large numbered boxes that appear under an expanded KPI.
// Clicking toggles the sub-filter; the active box is highlighted.
function BigFilterBox({ label, value, color = 'var(--zm-accent)', active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="zm-glass"
      style={{
        borderRadius: 16, padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: 10,
        position: 'relative', overflow: 'hidden',
        border: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        outline: active ? '2px solid ' + color : '1px solid var(--zm-line)',
        outlineOffset: -2,
        transition: 'transform 200ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms cubic-bezier(0.22,1,0.36,1)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--zm-shadow-3)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--zm-glass)'; }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: color }}/>
        <span style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: active ? color : 'var(--zm-fg-3)', lineHeight: 1,
        }}>{label}</span>
      </span>
      <span style={{
        fontFamily: 'var(--zm-font-display)', fontWeight: 800,
        fontSize: 42, letterSpacing: '-0.03em', color: 'var(--zm-fg)', lineHeight: 0.95,
        fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'tnum' 1",
      }}>{String(value).padStart(2, '0')}</span>
      <span style={{ width: 28, height: 1, background: active ? color : 'var(--zm-line-strong)', opacity: 0.8 }}/>
    </button>
  );
}

// PipelineFilter date helpers — also reused by the expanded KPI views.
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
        {cells.map((d, i) => { const cellKey = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : `null-${i}`; if (!d) return <span key={cellKey} style={{ height: 28 }}/>; const startSel = sameDay(d, fromD); const endSel = sameDay(d, toD); const within = inRange(d) && !startSel && !endSel; return (<button key={cellKey} onClick={() => pick(d)} className="zm-cal-day" data-state={startSel ? 'start' : endSel ? 'end' : within ? 'within' : 'idle'} style={{ height: 28, padding: 0, border: 'none', borderRadius: startSel ? '999px 0 0 999px' : endSel ? '0 999px 999px 0' : within ? 0 : 6, background: (startSel || endSel) ? 'var(--zm-accent)' : within ? 'var(--zm-accent-soft)' : 'transparent', color: (startSel || endSel) ? '#fff' : within ? 'var(--zm-accent)' : 'var(--zm-fg)', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 12, fontWeight: (startSel || endSel) ? 700 : 500, cursor: 'pointer' }}>{d.getDate()}</button>); })}
      </div>
    </div>
  );
}

function MoreFilters({ value, onChange, onClose, dateLabel = 'visit date' }) {
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
        <div><h4 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 14, color: 'var(--zm-fg)' }}>Date filter</h4><p style={{ margin: '2px 0 0', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>Narrow by {dateLabel} month, preset window, or custom range.</p></div>
        <button onClick={clear} className="zm-link-btn" style={{ background: 'transparent', border: 'none', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}>Clear all</button>
      </div>
      <section><span style={{ display: 'block', fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 8 }}>By month · {dateLabel}</span><div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>{months.map(m => { const on = value.month === m.key; return (<button key={m.key} onClick={() => setMonth(m.key)} className="zm-pill" style={{ height: 30, padding: '0 8px', borderRadius: 7, border: '1px solid ' + (on ? 'var(--zm-accent)' : 'var(--zm-line)'), background: on ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', color: on ? 'var(--zm-accent)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-mono)', fontSize: 11, fontWeight: on ? 700 : 600, cursor: 'pointer' }}>{m.label}</button>); })}</div></section>
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

// DateFilterButton — calendar trigger + active-summary chip + the MoreFilters
// popover. Shared by the default chip row and the expanded KPI views.
function DateFilterButton({ value, onChange, label = 'Date filter', dateLabel = 'visit date' }) {
  const [open, setOpen] = React.useState(false);
  const adv = value || { month: '', preset: '', from: '', to: '' };
  const active = !!(adv.month || adv.preset || adv.from || adv.to);
  const popRef = React.useRef(null);
  React.useEffect(() => { if (!open) return; const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false); }; const onKey = (e) => { if (e.key === 'Escape') setOpen(false); }; const t = setTimeout(() => { document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey); }, 0); return () => { clearTimeout(t); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey); }; }, [open]);
  const summary = adv.month ? `Month · ${adv.month.slice(5)}/${adv.month.slice(2,4)}` : adv.preset ? PRESETS.find(p => p.id === adv.preset)?.label : (adv.from && adv.to) ? `${adv.from} → ${adv.to}` : adv.from ? `from ${adv.from}` : '';
  return (
    <>
      {active && (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 999, background: 'var(--zm-accent-soft)', color: 'var(--zm-accent)', fontFamily: 'var(--zm-font-mono)', fontSize: 11, fontWeight: 600 }}><Icon name="calendar" size={11}/> {summary}<button onClick={() => onChange({ month: '', preset: '', from: '', to: '' })} style={{ background: 'transparent', border: 'none', color: 'inherit', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', marginLeft: 4, opacity: 0.7 }}><Icon name="x" size={11}/></button></span>)}
      <div ref={popRef} style={{ position: 'relative' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid ' + (active || open ? 'var(--zm-accent)' : 'var(--zm-line)'), background: active || open ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', color: active || open ? 'var(--zm-accent)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1 }}><Icon name="calendar" size={13}/> {label}{active && <span style={{ background: 'var(--zm-accent)', color: '#fff', width: 16, height: 16, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--zm-font-mono)', fontSize: 9.5, fontWeight: 700, marginLeft: 2 }}>•</span>}</button>
        {open && <MoreFilters value={adv} onChange={(v) => onChange(v)} onClose={() => setOpen(false)} dateLabel={dateLabel}/>}
      </div>
    </>
  );
}

function SearchBox({ value, onChange, placeholder = 'Search code, site, city…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', flex: '1 1 240px', maxWidth: 360, border: '1px solid var(--zm-line)', borderRadius: 999, background: 'var(--zm-surface)' }}>
      <Icon name="search" size={14} style={{ color: 'var(--zm-fg-3)' }}/>
      <input
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}
      />
      {value && (
        <button onClick={() => onChange('')} style={{ background: 'transparent', border: 'none', color: 'var(--zm-fg-3)', padding: 0, cursor: 'pointer', display: 'inline-flex' }}><Icon name="x" size={12}/></button>
      )}
    </div>
  );
}

function FilterChip({ active, label, count, color, onClick }) {
  return (
    <button onClick={onClick} className="zm-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid ' + (active ? 'var(--zm-fg)' : 'var(--zm-line)'), background: active ? 'var(--zm-fg)' : 'var(--zm-surface)', color: active ? 'var(--zm-fg-inv)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 120ms var(--zm-ease)' }}>
      {color && <span style={{ width: 6, height: 6, borderRadius: 999, background: color }}/>}
      {label}
      {count != null && (<span style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 500, fontSize: 11, color: active ? 'var(--zm-fg-inv)' : 'var(--zm-fg-3)', opacity: active ? 0.7 : 1 }}>{count}</span>)}
    </button>
  );
}

function PipelineFilter({ stage, onStage, counts, advanced, onAdvanced }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
      <FilterChip label="All"       count={counts.all}       active={stage === 'all'}       onClick={() => onStage('all')}/>
      <FilterChip label="Draft"     count={counts.draft}     active={stage === 'draft'}     onClick={() => onStage('draft')}     color={STAGES.draft.color}/>
      <FilterChip label="Shortlist" count={counts.shortlist} active={stage === 'shortlist'} onClick={() => onStage('shortlist')} color={STAGES.shortlist.color}/>
      <FilterChip label="Sites in process" count={counts.staging} active={stage === 'staging'} onClick={() => onStage('staging')} color={STAGES.staging.color}/>
      <span style={{ flex: 1 }}/>
      <DateFilterButton value={advanced} onChange={onAdvanced} label="More filters"/>
    </div>
  );
}

// MotionTable — render body preserved from App.jsx
function MotionTable({ rows, onOpen, limit = 12 }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '0.9fr 1.7fr 1fr 1fr 0.7fr 1.1fr 1.2fr', gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
        <span>Code</span><span>Site</span><span>City</span><span>Owner</span><span>Days</span><span>Stage</span><span>Detail</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.slice(0, limit).map(r => (
          <div key={r.id} role="button" tabIndex={0} onClick={() => onOpen(r)} onKeyDown={keyActivate(() => onOpen(r))} className="zm-row" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.7fr 1fr 1fr 0.7fr 1.1fr 1.2fr', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', background: r.stage === 'overdue' ? 'rgba(217,119,6,0.06)' : 'transparent', cursor: 'pointer', position: 'relative' }}>
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
    </div>
  );
}

// ArchiveTable — compact archive listing for the expanded Archived KPI.
function ArchiveTable({ rows, onOpen }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1.1fr 0.9fr 1.5fr', gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
        <span>Code</span><span>Site</span><span>City</span><span>Created by</span><span>Archived on</span><span>Reason / note</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.map(a => {
          const hasReasons = (a.reasons || []).length > 0;
          return (
            <div key={a.id} role="button" tabIndex={0} onClick={() => onOpen?.(a)} onKeyDown={keyActivate(() => onOpen?.(a))} className="zm-row" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1.1fr 0.9fr 1.5fr', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer', position: 'relative', alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)', paddingTop: 2 }}>{a.code}</span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{a.name}</span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{a.city}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={a.createdBy} size={20}/><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{a.createdBy}</span></span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg)', paddingTop: 2 }}>{a.archivedAt || '—'}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {hasReasons && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {a.reasons.map(r => (<span key={r} style={{ padding: '2px 8px', borderRadius: 999, background: '#F1F3F6', color: '#374151', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap' }}>{r}</span>))}
                  </div>
                )}
                {a.note && (<span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)', lineHeight: 1.45 }}>{a.note}</span>)}
                {!hasReasons && !a.note && (<span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>—</span>)}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (<div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>No archived sites match the current filter.</div>)}
      </div>
    </div>
  );
}

const REJECTED_STATUSES = [SiteStatus.REJECTED, SiteStatus.LEGAL_REJECTED];
const PUSHED_STATUSES = [SiteStatus.LEGAL_REVIEW, SiteStatus.LEGAL_APPROVED, SiteStatus.PUSHED_TO_PAYMENTS];

function matchesSearch(needle, ...fields) {
  if (!needle) return true;
  return fields.join(' ').toLowerCase().includes(needle);
}

function matchesAdvanced(when, adv) {
  if (!when) return true;
  if (adv.month) return when.slice(0, 7) === adv.month;
  if (adv.from && when < adv.from) return false;
  if (adv.to && when > adv.to) return false;
  return true;
}

// OverviewPage: wires session + sites context into the overview render.
export default function OverviewPage({ onOpenSite: onOpenSiteProp }) {
  const navigate = useNavigate();
  const ctx = usePageContext();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  const { role, user } = useSession();
  const { drafts, shortlist, staging, archive, sites } = useSites();
  const launch = useLaunchSites();

  // view: which KPI is expanded in place (payments / launch navigate away).
  const [view, setView] = React.useState(null); // null | 'sites' | 'archived'
  const [stage, setStage] = React.useState('all');
  // Sub-state filter inside the expanded Total sites view. Shortlist:
  // 'awaiting' (needs the 17-field form) | 'pending' (in supervisor review).
  // Sites in process: 'awaiting_loi' (no upload yet) | 'awaiting_approval'
  // (LOI uploaded, waiting on the supervisor push).
  const [subFilter, setSubFilter] = React.useState('all');
  const [advanced, setAdvanced] = React.useState({ month: '', preset: '', from: '', to: '' });
  const [search, setSearch] = React.useState('');
  // Archived view has its own filters (calendar on archived-on date + search).
  const [archStatus, setArchStatus] = React.useState('all'); // all | archived | rejected
  const [archAdvanced, setArchAdvanced] = React.useState({ month: '', preset: '', from: '', to: '' });
  const [archSearch, setArchSearch] = React.useState('');

  const ME = user.name;
  // RBAC: isExec = cannot shortlist (exec cannot approve); used for scope/display logic in render body
  const isExec = !can(role, 'shortlist');
  const visibleDrafts    = React.useMemo(() => isExec ? filterByScope(drafts, role, user) : drafts, [isExec, drafts, role, user]);
  const visibleShortlist = React.useMemo(() => isExec ? filterByScope(shortlist, role, user) : shortlist, [isExec, shortlist, role, user]);
  const visibleStaging   = React.useMemo(() => isExec ? filterByScope(staging, role, user) : staging, [isExec, staging, role, user]);
  // "Sites in process" for KPI math = pre-push only. Pushed sites belong to
  // the Payments KPI (Legal ∥ Finance run in parallel after the push).
  const activeStaging = React.useMemo(() => visibleStaging.filter(s => !s.pushed), [visibleStaging]);

  // Executives count only their own pushed/launch sites — mirrors the
  // payments tab scoping (backend scopes real exec JWTs; this covers mock
  // mode and the supervisor "View as" switcher).
  const visibleLaunch = React.useMemo(() => isExec ? filterByScope(launch.rows || [], role, user) : (launch.rows || []), [isExec, launch.rows, role, user]);
  const launchIds = React.useMemo(() => new Set(visibleLaunch.map(r => r.id)), [visibleLaunch]);
  const pushedSites = React.useMemo(() => sites.filter(s => PUSHED_STATUSES.includes(s.status)), [sites]);
  const paymentSites = React.useMemo(() => (isExec ? filterByScope(pushedSites, role, user) : pushedSites).filter(s => !launchIds.has(s.id)), [isExec, pushedSites, role, user, launchIds]);

  const totalSites = React.useMemo(() => visibleDrafts.length + visibleShortlist.length + activeStaging.length, [visibleDrafts, visibleShortlist, activeStaging]);
  const cityCount = React.useMemo(() => new Set([...visibleDrafts.map(d => d.city), ...visibleShortlist.map(s => s.city), ...activeStaging.map(s => s.city)]).size, [visibleDrafts, visibleShortlist, activeStaging]);
  const archivedOnly = archive.filter(a => a.status === SiteStatus.ARCHIVED).length;
  const rejectedOnly = archive.length - archivedOnly;

  const metrics = React.useMemo(() => ({
    total: {
      value: String(totalSites).padStart(2, '0'),
      delta: isExec ? `Your sites · ${ME.split(' ')[0]}` : 'Tenant-wide',
      sub: `Across ${cityCount} cit${cityCount === 1 ? 'y' : 'ies'}`,
    },
    archived: {
      value: String(archive.length).padStart(2, '0'),
      delta: 'Out of pipeline',
      deltaTone: 'neutral',
      sub: `${archivedOnly} archived · ${rejectedOnly} rejected`,
    },
    payments: {
      value: String(paymentSites.length).padStart(2, '0'),
      delta: 'Legal ∥ Finance',
      deltaTone: 'neutral',
      sub: 'Pushed from Sites in process',
    },
    launch: {
      value: launch.loading ? '··' : String(visibleLaunch.length).padStart(2, '0'),
      delta: launch.loading ? 'Loading…' : 'Project complete',
      deltaTone: launch.loading ? 'neutral' : 'pos',
      sub: 'Handed to NSO',
    },
  }), [totalSites, isExec, ME, cityCount, archive, archivedOnly, rejectedOnly, paymentSites, launch.loading, visibleLaunch]);

  // Rows for the "all files in motion" table (default view) — includes pushed
  // sites so nothing disappears from the default listing.
  const allMotion = React.useMemo(() => [
    ...visibleDrafts.map(d => ({ id: d.id, code: d.code, name: d.name, city: d.city, stage: 'draft', days: d.days, owner: d.createdBy, when: d.visitDate, meta: 'Visit ' + d.visitDate })),
    ...visibleShortlist.map(s => ({ id: s.code, code: s.code, name: s.name, city: s.city, stage: s.inReview ? 'inReview' : 'shortlist', days: 3, owner: s.createdBy, when: s.visitDate, meta: s.inReview ? 'In review' : 'Awaiting details' })),
    ...visibleStaging.map(s => { const overdue = s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded; return { id: s.id, code: s.code, name: s.name, city: s.city, stage: s.pushed ? 'completed' : s.loiUploaded ? 'uploaded' : (overdue ? 'overdue' : 'staging'), days: s.daysSinceApproval, owner: s.createdBy, when: s.draftDate || s.approvedDate, meta: `LOI ${s.daysSinceApproval}/${s.expectedLoiDays}d` }; }),
  ], [visibleDrafts, visibleShortlist, visibleStaging]);

  const filteredMotion = React.useMemo(() => {
    const base = view === 'sites' ? allMotion.filter(r => r.stage !== 'completed') : allMotion;
    const stageFiltered = stage === 'all' ? base : base.filter(r => {
      if (stage === 'staging') return ['staging','overdue','uploaded','completed'].includes(r.stage);
      if (stage === 'shortlist') return ['shortlist','inReview'].includes(r.stage);
      return r.stage === stage;
    });
    const subFiltered = (view === 'sites' && subFilter !== 'all')
      ? stageFiltered.filter(r => {
          if (stage === 'shortlist') return r.stage === (subFilter === 'pending' ? 'inReview' : 'shortlist');
          if (stage === 'staging') return subFilter === 'awaiting_loi' ? ['staging', 'overdue'].includes(r.stage) : r.stage === 'uploaded';
          return true;
        })
      : stageFiltered;
    const n = search.trim().toLowerCase();
    return subFiltered
      .filter(r => matchesAdvanced(r.when, advanced))
      .filter(r => matchesSearch(n, r.code || '', r.name || '', r.city || '', r.owner || ''));
  }, [view, stage, subFilter, advanced, search, allMotion]);

  // Archived rows + filters.
  const filteredArchive = React.useMemo(() => {
    const archNeedle = archSearch.trim().toLowerCase();
    return archive
      .filter(a => archStatus === 'all' ? true : archStatus === 'archived' ? a.status === SiteStatus.ARCHIVED : REJECTED_STATUSES.includes(a.status))
      .filter(a => matchesAdvanced(a.archivedAt, archAdvanced))
      .filter(a => matchesSearch(archNeedle, a.code || '', a.name || '', a.city || '', a.createdBy || ''));
  }, [archive, archStatus, archAdvanced, archSearch]);

  // Row click → owning tab, focused on that exact site (?focus= handled by
  // useFocusSite in the target page).
  const openRowInTab = (r) => {
    const focus = encodeURIComponent(r.id || r.code);
    if (r.stage === 'draft') navigate(`${ROUTES.PIPELINE}?focus=${focus}`);
    else if (['shortlist', 'inReview'].includes(r.stage)) navigate(`${ROUTES.SHORTLIST}?focus=${focus}`);
    else navigate(`${ROUTES.STAGING}?focus=${focus}`);
  };

  const selectKpi = (key) => {
    if (key === 'payments') { navigate(ROUTES.PAYMENT); return; }
    if (key === 'launch') { navigate(ROUTES.LAUNCH); return; }
    setView(v => (v === key ? null : key));
    setStage('all');
    setSubFilter('all');
    setSearch('');
  };

  const ledeFor = () => {
    if (view === 'sites') return `${totalSites} active site${totalSites === 1 ? '' : 's'} · pipeline → process`;
    if (view === 'archived') return `${archive.length} site${archive.length === 1 ? '' : 's'} out of pipeline`;
    return `${allMotion.length} file${allMotion.length === 1 ? '' : 's'} in motion`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0 }}>
        <PageHeader
          file="№ 01" eyebrow="Overview" title="Sites"
          lede={ledeFor()}
          right={<>
            <HeaderTag icon="clock" label="LIVE · 2M LAG"/>
            <HeaderTag icon="shield" label={role === 'supervisor' ? 'TENANT SCOPE' : 'PERSONAL SCOPE'} tone="accent"/>
          </>}
        />

        {view && (
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setView(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name="arrow" size={12} style={{ transform: 'rotate(180deg)' }}/> All metrics
            </button>
          </div>
        )}

        {/* KPI strip — all four when collapsed; selected KPI + its big filter
            boxes when expanded (the other KPIs disappear). */}
        {!view && (
          <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
            <MetricCard tone="peach" no="Ⅰ" eyebrow="Total sites" value={metrics.total.value}    rule="var(--zm-accent)" delta={metrics.total.delta}    sub={metrics.total.sub}    onClick={() => selectKpi('sites')}/>
            <MetricCard tone="blue" no="Ⅱ" eyebrow="Archive / Rejected" value={metrics.archived.value} rule="var(--zm-fg-3)" delta={metrics.archived.delta} deltaTone="neutral" sub={metrics.archived.sub} onClick={() => selectKpi('archived')}/>
            <MetricCard tone="mint" no="Ⅲ" eyebrow="Payments"    value={metrics.payments.value} rule="var(--zm-info)"   delta={metrics.payments.delta} deltaTone="neutral" sub={metrics.payments.sub} onClick={() => selectKpi('payments')}/>
            <MetricCard tone="slate" no="Ⅳ" eyebrow="Launch"      value={metrics.launch.value}   rule="var(--zm-copper)" delta={metrics.launch.delta}   deltaTone={metrics.launch.deltaTone} sub={metrics.launch.sub} onClick={() => selectKpi('launch')}/>
          </div>
        )}
      </div>

      {view === 'sites' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flexShrink: 0 }}>
            <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
              <MetricCard tone="peach" no="Ⅰ" eyebrow="Total sites" value={metrics.total.value} rule="var(--zm-accent)" delta={metrics.total.delta} sub={metrics.total.sub} selected onClick={() => selectKpi('sites')}/>
              <BigFilterBox label="Pipeline"         value={visibleDrafts.length}    color={STAGES.draft.color}     active={stage === 'draft'}     onClick={() => { setSubFilter('all'); setStage(s => s === 'draft' ? 'all' : 'draft'); }}/>
              <BigFilterBox label="Shortlist"        value={visibleShortlist.length} color={STAGES.shortlist.color} active={stage === 'shortlist'} onClick={() => { setSubFilter('all'); setStage(s => s === 'shortlist' ? 'all' : 'shortlist'); }}/>
              <BigFilterBox label="Sites in process" value={activeStaging.length}    color={STAGES.staging.color}   active={stage === 'staging'}   onClick={() => { setSubFilter('all'); setStage(s => s === 'staging' ? 'all' : 'staging'); }}/>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <SearchBox value={search} onChange={setSearch}/>
              {stage === 'shortlist' && (
                <>
                  <FilterChip label="Awaiting details" count={visibleShortlist.filter(s => !s.inReview).length} color={STAGES.staging.color}  active={subFilter === 'awaiting'} onClick={() => setSubFilter(s => s === 'awaiting' ? 'all' : 'awaiting')}/>
                  <FilterChip label="Pending approval" count={visibleShortlist.filter(s => s.inReview).length}  color={STAGES.inReview.color} active={subFilter === 'pending'}  onClick={() => setSubFilter(s => s === 'pending' ? 'all' : 'pending')}/>
                </>
              )}
              {stage === 'staging' && (
                <>
                  <FilterChip label="Awaiting LOI"      count={activeStaging.filter(s => !s.loiUploaded).length} color={STAGES.staging.color}  active={subFilter === 'awaiting_loi'}      onClick={() => setSubFilter(s => s === 'awaiting_loi' ? 'all' : 'awaiting_loi')}/>
                  <FilterChip label="Awaiting approval" count={activeStaging.filter(s => s.loiUploaded).length}  color={STAGES.uploaded.color} active={subFilter === 'awaiting_approval'} onClick={() => setSubFilter(s => s === 'awaiting_approval' ? 'all' : 'awaiting_approval')}/>
                </>
              )}
              <span style={{ flex: 1 }}/>
              <DateFilterButton value={advanced} onChange={setAdvanced}/>
            </div>
          </div>
          <MotionTable rows={filteredMotion} limit={Infinity} onOpen={openRowInTab}/>
        </div>
      )}

      {view === 'archived' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flexShrink: 0 }}>
            <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
              <MetricCard tone="blue" no="Ⅱ" eyebrow="Archive / Rejected" value={metrics.archived.value} rule="var(--zm-fg-3)" delta={metrics.archived.delta} deltaTone="neutral" sub={metrics.archived.sub} selected onClick={() => selectKpi('archived')}/>
              <BigFilterBox label="Archived" value={archivedOnly} color={STAGES.archived.color} active={archStatus === 'archived'} onClick={() => setArchStatus(s => s === 'archived' ? 'all' : 'archived')}/>
              <BigFilterBox label="Rejected" value={rejectedOnly} color={STAGES.rejected.color} active={archStatus === 'rejected'} onClick={() => setArchStatus(s => s === 'rejected' ? 'all' : 'rejected')}/>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <SearchBox value={archSearch} onChange={setArchSearch}/>
              <span style={{ flex: 1 }}/>
              <DateFilterButton value={archAdvanced} onChange={setArchAdvanced} dateLabel="archived date"/>
            </div>
          </div>
          <ArchiveTable rows={filteredArchive} onOpen={(a) => onOpenSite?.(a)}/>
        </div>
      )}

      {!view && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flexShrink: 0, marginBottom: 14 }}>
            <PipelineFilter
              stage={stage} onStage={setStage}
              counts={{ all: allMotion.length, draft: visibleDrafts.length, shortlist: visibleShortlist.length, staging: visibleStaging.length }}
              advanced={advanced} onAdvanced={setAdvanced}
            />
          </div>
          <MotionTable rows={filteredMotion} onOpen={openRowInTab}/>
        </div>
      )}
    </div>
  );
}
