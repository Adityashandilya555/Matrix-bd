// skipcq: JS-0833
import React from 'react';
import './dashboard.css';

// Building blocks for the role dashboards. Charts are plain SVG and CSS — the
// app has no chart library, and these are small enough not to need one.

const PATHS = {
  pin: <><path d="M12 21s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  inbox: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  rocket: <><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  funnel: <path d="M3 4h18l-7 8v6l-4 2v-8z" />,
  layers: <><path d="m12 2 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
  clock: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  licence: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
  rupee: <path d="M7 5h10M7 9h10M10 5c4 0 5 2 5 4s-2 4-5 4H7l7 7" />,
  chart: <><path d="M3 3v18h18" /><path d="M7 15v3M11 11v7M15 13v5M19 8v10" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  store: <><path d="M3 21h18M5 21V9l7-6 7 6v12" /><path d="M9 21v-6h6v6" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  grid: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
};

export function Ico({ name, size = 20, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] || PATHS.info}
    </svg>
  );
}

// Badge tones for the icon squares and pills. Readable on cream and on roast.
export const TONE = {
  orange: { bg: 'var(--zm-copper-soft)', fg: 'var(--zm-copper)' },
  blue: { bg: 'var(--zm-info-soft)', fg: 'var(--zm-info)' },
  purple: { bg: 'var(--zm-plum-soft)', fg: 'var(--zm-plum)' },
  green: { bg: 'var(--zm-success-soft)', fg: 'var(--zm-success)' },
  red: { bg: 'var(--zm-danger-soft)', fg: 'var(--zm-danger)' },
  neutral: { bg: 'var(--zm-surface-sunken)', fg: 'var(--zm-fg-2)' },
};

export function CardHead({ icon, tone = 'blue', title, sub, right }) {
  const t = TONE[tone] || TONE.blue;
  const head = (
    <div className="dash-head">
      <span className="dash-ico" style={{ background: t.bg, color: t.fg }}><Ico name={icon} /></span>
      <div className="dash-col">
        <h2 className="dash-title">{title}</h2>
        {sub && <p className="dash-sub">{sub}</p>}
      </div>
    </div>
  );
  if (!right) return head;
  return <div className="dash-head-row">{head}{right}</div>;
}

export function Card({ variant, flush, photo, photoOpacity, className = '', id, children }) {
  const cls = ['dash-card', variant ? `dash-card--${variant}` : '', flush ? 'dash-card--flush' : '', className].join(' ');
  return (
    <section className={cls} id={id}>
      {photo && <img className="dash-fade" src={photo} alt="" style={photoOpacity ? { opacity: photoOpacity } : undefined} />}
      {children}
    </section>
  );
}

export function Source({ children }) {
  return <p className="dash-src">{children}</p>;
}

export function Track({ pct, color, height = 10, style }) {
  return (
    <span className="dash-track" style={{ height, ...style }}>
      <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 8 }} />
    </span>
  );
}

// Several values side by side in one bar (launched vs pipeline, yes/pending/no).
export function SplitTrack({ parts, height = 10 }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <span className="dash-track" style={{ height, display: 'flex' }}>
      {parts.map((p) => (
        <span key={p.label} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </span>
  );
}

export function ChipTabs({ label, items, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.key} type="button" className="dash-chip" aria-pressed={it.key === value}
          onClick={() => onChange(it.key)}>
          {it.label}
          {it.count !== undefined && <span className="c">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

const C = 2 * Math.PI * 54;
export function Donut({ parts, size = 150, stroke = 18, center, sub, track = 'var(--zm-surface-sunken)', label }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let acc = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={label}>
        <circle cx="70" cy="70" r="54" fill="none" stroke={track} strokeWidth={stroke} />
        {parts.map((p) => {
          const len = (p.value / total) * C;
          const el = (
            <circle key={p.label} cx="70" cy="70" r="54" fill="none" stroke={p.color} strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 3)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />
          );
          acc += len;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span className="dash-num" style={{ fontSize: size > 120 ? 32 : 22 }}>{center}</span>
        {sub && <span className="dash-sub">{sub}</span>}
      </div>
    </div>
  );
}

export function Legend({ parts, showPct }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11, flex: '1 1 200px' }}>
      {parts.map((p) => (
        <div key={p.label} style={{ display: 'grid', gridTemplateColumns: '12px minmax(0,1fr) 40px 44px', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: p.color }} />
          <span className="dash-lbl">{p.label}</span>
          <span className="dash-num" style={{ fontSize: 16, textAlign: 'right' }}>{p.value}</span>
          <span className="dash-sub" style={{ textAlign: 'right' }}>{showPct ? `${Math.round((p.value / total) * 100)}%` : ''}</span>
        </div>
      ))}
    </div>
  );
}

// Vertical bars; `ahead` bars are drawn in the planned colour.
export function Bars({ bars, color, aheadColor = '#F2B27A', height = 180, label }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div role="img" aria-label={label} style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height }}>
      {bars.map((b) => (
        <div key={b.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%', minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: b.ahead ? 'var(--zm-copper)' : 'var(--zm-fg-2)' }}>{b.value}</span>
          <div style={{ width: '100%', maxWidth: 38, borderRadius: '10px 10px 4px 4px', background: b.ahead ? aheadColor : color, height: `${Math.max(3, (b.value / max) * 100)}%` }} />
          <span style={{ fontSize: 11, color: b.ahead ? 'var(--zm-copper)' : 'var(--zm-fg-3)', fontWeight: b.ahead ? 700 : 500 }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

const FUNNEL_SHADES = ['#D9CFF7', '#C7B8F2', '#B4A1ED', '#A08AE7', '#8C73E0', '#795DD9', '#6648CC', '#5536BC', '#E07A2F'];

// Clickable pipeline steps with a detail panel for the selected one.
export function Funnel({ steps, photo }) {
  const [sel, setSel] = React.useState(Math.min(4, steps.length - 1));
  const top = steps[0]?.value || 1;
  const st = steps[sel] || steps[0];
  const next = steps[sel + 1];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
      <div style={{ flex: '3 1 440px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }} role="group" aria-label="Pipeline steps">
        {steps.map((s, i) => (
          <button key={s.label} type="button" className="dash-step" aria-pressed={i === sel} onClick={() => setSel(i)}>
            <span className="dash-lbl" style={{ fontWeight: 600 }}>{s.label}</span>
            <Track pct={(s.value / top) * 100} height={24} color={i === sel ? 'var(--zm-fg)' : FUNNEL_SHADES[Math.min(i, FUNNEL_SHADES.length - 1)]} />
            <span className="dash-num" style={{ fontSize: 16, textAlign: 'right' }}>{s.value}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: '2 1 260px', borderRadius: 20, background: '#24170F', color: '#FFF6EC', padding: 22, display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', overflow: 'hidden' }}>
        {photo && <img src={photo} alt="" style={{ position: 'absolute', right: -40, bottom: -30, width: '70%', opacity: 0.28, borderRadius: 20 }} />}
        <span className="dash-eyebrow" style={{ color: '#E9C9A6', position: 'relative' }}>Step {sel + 1} of {steps.length}</span>
        <span style={{ fontFamily: 'var(--zm-font-display)', fontWeight: 800, fontSize: 28, position: 'relative' }}>{st.label}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14, position: 'relative' }}>
          <Stat label="Sites reached" value={st.value} />
          <Stat label="Of all at step 1" value={`${Math.round((st.value / top) * 100)}%`} />
          <Stat label="Carried to next" value={next ? `${Math.round((next.value / st.value) * 100)}%` : '—'} hot />
          <Stat label="Median days here" value={st.days ? `${st.days} d` : '—'} />
        </div>
        {st.note && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#E9DCCB', position: 'relative' }}>{st.note}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, hot }) {
  return (
    <div className="dash-col">
      <span style={{ fontSize: 12, color: '#C9B49F' }}>{label}</span>
      <span className="dash-num" style={{ fontSize: 24, color: hot ? '#FFD3A8' : '#FFF6EC' }}>{value}</span>
    </div>
  );
}

export function Heatmap({ cells, cols = 12 }) {
  const shades = ['var(--zm-surface-sunken)', '#E9C9A6', '#C98E5A', '#8A4E22'];
  return (
    <div role="img" aria-label="Activity per day" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 4 }}>
      {cells.map((lvl, i) => (
        <span key={i} style={{ aspectRatio: '1', borderRadius: 4, background: shades[lvl] }} />
      ))}
    </div>
  );
}

// Real "how fresh is this" label, replacing the hard-coded "LIVE · 2M LAG".
export function FreshnessBadge({ updatedAt, onDark }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  const text = secs < 5 ? 'Updated just now' : secs < 60 ? `Updated ${secs}s ago` : `Updated ${Math.round(secs / 60)}m ago`;
  return (
    <span className="dash-pill" style={{ background: onDark ? 'rgba(255,246,236,.16)' : 'var(--zm-surface)', color: onDark ? '#FFF6EC' : 'var(--zm-fg-2)', border: onDark ? 0 : '1px solid var(--zm-line)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: '#6FD3A4' }} aria-hidden="true" />
      {text}
    </span>
  );
}
