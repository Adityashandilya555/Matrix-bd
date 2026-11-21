// skipcq: JS-0833
import React from 'react';
import './dashboard.css';

// Building blocks for the role dashboards. Charts are plain SVG and CSS — the
// app has no chart library, and these are small enough not to need one.

const PATHS = {
  pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
  play: <path d="M7 5l12 7-12 7V5Z" />,
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
      <span className="dash-ico" style={{ background: `linear-gradient(145deg, ${t.bg}, color-mix(in srgb, ${t.bg} 82%, ${t.fg}))`, color: t.fg }}><Ico name={icon} stroke={1.75} /></span>
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

// Data provenance (table and column names) is for developers, not the people
// using the dashboard, so it is never drawn. The payload still carries `source`
// for debugging; pass it here and it stays out of the UI.
export function Source() {
  return null;
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

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Numbers count up when they first appear and tween when they change (ease-out
// expo). Non-numbers and reduced motion render the final value at once.
export function useCountUp(value, ms = 900) {
  const target = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const [shown, setShown] = React.useState(target === null ? value : 0);
  const from = React.useRef(0);
  React.useEffect(() => {
    if (target === null || reducedMotion() || typeof window.requestAnimationFrame !== 'function') {
      setShown(value);
      from.current = target ?? 0;
      return undefined;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const eased = t === 1 ? 1 : 1 - 2 ** (-10 * t);
      setShown(Math.round(start + (target - start) * eased));
      if (t < 1) raf = window.requestAnimationFrame(step);
      else from.current = target;
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [target, value, ms]);
  return shown;
}

export function CountUp({ value, ms }) {
  return <>{useCountUp(value, ms)}</>;
}

const R = 54;
const C = 2 * Math.PI * R;
// Ring with rounded caps; segments grow in, and the hovered/focused part
// thickens while the rest fade, with its value and share shown in the centre.
export function Donut({ parts, size = 150, stroke = 14, center, sub, label, active = null }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const centreValue = useCountUp(active === null ? center : parts[active]?.value);
  let acc = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={label}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="color-mix(in srgb, var(--zm-fg) 6%, transparent)" strokeWidth={stroke} />
        {parts.map((p, i) => {
          const len = (p.value / total) * C;
          const round = len > stroke + 4;
          const dash = Math.max(0.01, round ? len - stroke - 2 : len - 2);
          const off = -(acc + (round ? stroke / 2 : 0));
          acc += len;
          if (p.value <= 0) return null;
          const dim = active !== null && active !== i;
          return (
            <circle key={p.label} className="dv-anim dv-seg" cx="70" cy="70" r={R} fill="none" stroke={p.color}
              strokeWidth={active === i ? stroke + 4 : stroke} strokeLinecap={round ? 'round' : 'butt'}
              strokeDasharray={`${dash} ${C}`} strokeDashoffset={off} transform="rotate(-90 70 70)"
              style={{ opacity: dim ? 0.35 : 1, animationDelay: `${i * 80}ms` }} />
          );
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span className="dash-num" style={{ fontSize: size > 120 ? 32 : 22 }}>{centreValue}</span>
        <span className="dash-sub">
          {active === null ? sub : `${parts[active].label} · ${Math.round((parts[active].value / total) * 100)}%`}
        </span>
      </div>
    </div>
  );
}

// Direct-label legend: a row per part with a micro-bar of its share. Rows are
// buttons so hovering or focusing one highlights its donut segment.
export function Legend({ parts, showPct, active = null, onActive }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
      {parts.map((p, i) => (
        <button key={p.label} type="button" className="dv-legend-row" aria-pressed={active === i}
          onMouseEnter={() => onActive?.(i)} onMouseLeave={() => onActive?.(null)}
          onFocus={() => onActive?.(i)} onBlur={() => onActive?.(null)}>
          <span className="dv-swatch" style={{ background: p.color }} />
          <span className="dv-legend-main">
            <span className="dash-lbl">{p.label}</span>
            <span className="dv-microbar"><span style={{ width: `${(p.value / total) * 100}%`, background: `color-mix(in srgb, ${p.color} 85%, var(--zm-surface))` }} /></span>
          </span>
          <span className="dash-num" style={{ fontSize: 15, textAlign: 'right' }}>{p.value}</span>
          <span className="dv-pct">{showPct ? `${Math.round((p.value / total) * 100)}%` : ''}</span>
        </button>
      ))}
    </div>
  );
}

// Monthly columns: gradient past bars, hatched planned bars after a dashed
// "Today" line, a faint dot instead of an empty bar, light gridlines, and
// values only where they matter (largest, latest and planned); the rest are
// in each column's tooltip.
export function Bars({ bars, height = 200, label }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const firstAhead = bars.findIndex((b) => b.ahead);
  const lastPast = firstAhead === -1 ? bars.length - 1 : firstAhead - 1;
  return (
    <div className="dv-bars" role="img" aria-label={label} style={{ height }}>
      <div className="dv-grid" aria-hidden="true"><span /><span /><span /></div>
      {bars.map((b, i) => {
        const showValue = b.value > 0 && (b.ahead || b.value === max || i === lastPast);
        const tip = `${b.title || b.label} · ${b.value === 0 ? (b.ahead ? 'none planned' : 'no openings') : `${b.value} ${b.ahead ? 'planned' : 'opened'}`}`;
        return (
          <div key={b.key} className={`dv-col${i === firstAhead ? ' dv-col--today' : ''}`} title={tip}>
            <span className="dv-val" style={{ color: b.ahead ? 'var(--zm-copper)' : 'var(--zm-fg-2)' }}>{showValue ? b.value : ''}</span>
            <div className="dv-bar-slot">
              {b.value > 0
                ? <div className={`dv-anim dv-bar${b.ahead ? ' dv-bar--ahead' : ''}`} style={{ height: `${(b.value / max) * 100}%`, animationDelay: `${i * 35}ms` }} />
                : <span className="dv-zero" />}
            </div>
            <span className="dv-month" style={{ color: b.ahead ? 'var(--zm-copper)' : 'var(--zm-fg-3)', fontWeight: b.ahead ? 700 : 500 }}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// A stage ramp in one warm hue, deepening step by step, from theme tokens.
const FUNNEL_SHADES = [34, 42, 50, 58, 66, 74, 82, 90, 96].map(
  (p) => `color-mix(in srgb, var(--zm-accent) ${p}%, var(--zm-surface-sunken))`,
);

// Clickable pipeline steps: lit gradient bars with the previous step's width
// as a dashed ghost (so the drop-off shows), the drop-off % in the gutter, and
// a detail panel for the selected step.
export function Funnel({ steps }) {
  const [sel, setSel] = React.useState(Math.min(4, steps.length - 1));
  const top = steps[0]?.value || 1;
  const st = steps[sel] || steps[0];
  const next = steps[sel + 1];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
      <div style={{ flex: '3 1 440px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }} role="group" aria-label="Pipeline steps">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].value : null;
          const drop = prev ? Math.round(((prev - s.value) / prev) * 100) : 0;
          const shade = FUNNEL_SHADES[Math.min(i, FUNNEL_SHADES.length - 1)];
          const fill = i === sel
            ? 'linear-gradient(90deg, var(--zm-accent), var(--zm-copper))'
            : `linear-gradient(90deg, ${shade}, color-mix(in srgb, ${shade} 78%, var(--zm-surface)))`;
          return (
            <button key={s.label} type="button" className="dash-step" aria-pressed={i === sel} onClick={() => setSel(i)}>
              <span className="dash-lbl" style={{ fontWeight: 600 }}>{s.label}</span>
              <span className="dv-funnel-track">
                {prev !== null && <span className="dv-ghost" style={{ width: `${(prev / top) * 100}%` }} />}
                <span className={`dv-anim dv-funnel-bar${i === sel ? ' is-sel' : ''}`}
                  style={{ width: `${(s.value / top) * 100}%`, background: fill, animationDelay: `${i * 45}ms` }} />
              </span>
              <span className="dash-num" style={{ fontSize: 16, textAlign: 'right' }}>{s.value}</span>
              <span className="dv-drop" style={{ color: drop > 30 ? 'var(--zm-copper)' : undefined }}>
                {drop > 0 ? `${drop > 30 ? '▼ ' : ''}−${drop}%` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <div className="dv-funnel-panel">
        <span className="dash-reel-dots" aria-hidden="true" style={{ position: 'relative' }}>
          {steps.map((s, i) => <span key={s.label} className={i === sel ? 'is-on' : ''} />)}
        </span>
        <span className="dash-eyebrow" style={{ color: '#E9C9A6', position: 'relative' }}>Step {sel + 1} of {steps.length}</span>
        <span key={st.label} className="dv-anim dv-fade" style={{ fontFamily: 'var(--zm-font-display)', fontWeight: 800, fontSize: 28, position: 'relative' }}>{st.label}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14, position: 'relative' }}>
          <Stat label="Sites reached" value={st.value} />
          <Stat label="Of all at step 1" value={Math.round((st.value / top) * 100)} suffix="%" />
          <Stat label="Carried to next" value={next && st.value ? Math.round((next.value / st.value) * 100) : null} suffix="%" hot />
          <Stat label="Median days here" value={st.days || null} suffix=" d" />
        </div>
        {st.note && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#E9DCCB', position: 'relative' }}>{st.note}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, suffix = '', hot }) {
  const n = useCountUp(value === null ? 0 : value, 400);
  return (
    <div className="dash-col">
      <span style={{ fontSize: 12, color: '#C9B49F' }}>{label}</span>
      <span className="dash-num" style={{ fontSize: 24, color: hot ? '#FFD3A8' : '#FFF6EC' }}>{value === null ? '—' : `${n}${suffix}`}</span>
    </div>
  );
}

// Duration rows as a lollipop: a thin stem, a filled run to the value and a
// dot; the slowest gets a copper dot with a halo and an inline note.
export function Lollipops({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.days));
  const sorted = [...rows].map((r) => r.days).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((r, i) => {
        const slow = r.days === max;
        const pct = (r.days / max) * 100;
        return (
          <div key={r.label} className="dash-col" style={{ gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span className="dash-lbl">{r.label}</span>
              <span className="dash-num" style={{ fontSize: 15, color: slow ? 'var(--zm-copper)' : undefined }}>{r.days}d</span>
            </div>
            <span className="dv-stem">
              <span className="dv-run" style={{ width: `${pct}%`, background: slow ? 'color-mix(in srgb, var(--zm-copper) 60%, transparent)' : undefined }} />
              <span className={`dv-anim dv-dot${slow ? ' is-slow' : ''}`} style={{ left: `${pct}%`, animationDelay: `${i * 50}ms` }} />
            </span>
            {slow && rows.length > 1 && (
              <span style={{ fontSize: 12, color: 'var(--zm-copper)', fontWeight: 600 }}>
                ↑ Slowest step{median > 0 && r.days / median >= 1.2 ? ` — ${(r.days / median).toFixed(1)}× the median` : ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// 7 × 12 days: empty days as faint outlines, four accent levels, today ringed,
// and a Less→More key.
export function Heatmap({ cells, cols = 12, today = null }) {
  const levels = [null, 35, 65, 100].map((p) => (p === null ? 'transparent' : `color-mix(in srgb, var(--zm-accent) ${p}%, var(--zm-surface-sunken))`));
  const shade = (lvl) => levels[Math.max(0, Math.min(3, lvl))];
  return (
    <div className="dash-col" style={{ gap: 10 }}>
      <div role="img" aria-label="Activity per day, last 12 weeks" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: 3 }}>
        {cells.map((lvl, i) => (
          <span key={i} className="dv-anim dv-cell" style={{
            aspectRatio: '1', borderRadius: 3, background: shade(lvl),
            boxShadow: lvl === 0 ? 'inset 0 0 0 1px color-mix(in srgb, var(--zm-fg) 9%, transparent)' : undefined,
            outline: i === today ? '1.5px solid var(--zm-fg)' : undefined, outlineOffset: 1,
            animationDelay: `${((i % cols) + Math.floor(i / cols)) * 12}ms`,
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--zm-fg-3)' }}>
        Less
        {[0, 1, 2, 3].map((l) => (
          <span key={l} style={{ width: 10, height: 10, borderRadius: 2, background: shade(l), boxShadow: l === 0 ? 'inset 0 0 0 1px color-mix(in srgb, var(--zm-fg) 9%, transparent)' : undefined }} />
        ))}
        More
      </div>
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
