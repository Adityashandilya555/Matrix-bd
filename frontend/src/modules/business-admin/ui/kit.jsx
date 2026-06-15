import React from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────────────
// Approval Center UI kit
//
// Semantic design tokens + presentational primitives for the business-admin
// portal. Colours mirror the rest of the Matrix app (dark #0B0C10 surface,
// green = approve, red = send-back, blue = review) so this surface stays
// cohesive with BD / Design / Project. Interaction states (hover / focus /
// motion) live in ../approval-center.css; everything here is layout + colour.
// ─────────────────────────────────────────────────────────────────────────────

// Tokens resolve to CSS custom properties defined per-theme in
// ../approval-center.css ([data-theme="dark"] / [data-theme="light"]). Same token
// names in both themes means components never hardcode a colour — light/dark is a
// pure data-theme swap on the portal root, with contrast tuned in both.
export const T = {
  bg:            'var(--ac-bg)',
  panel:         'var(--ac-panel)',        // big rounded sidebar / main panels
  surface:       'var(--ac-surface)',
  surfaceRaised: 'var(--ac-surface-raised)',
  surfaceInset:  'var(--ac-surface-inset)',
  cardShadow:    'var(--ac-card-shadow)',
  line:          'var(--ac-line)',
  lineStrong:    'var(--ac-line-strong)',
  chip:          'var(--ac-chip)',        // subtle neutral fill (icon chips, ghost buttons)

  text:      'var(--ac-text)',
  textMuted: 'var(--ac-text-muted)',
  textFaint: 'var(--ac-text-faint)',

  // Inverted surface — near-white on dark, near-black on light (solid buttons / active pills).
  invBg:   'var(--ac-inv-bg)',
  invText: 'var(--ac-inv-text)',
  invSoft: 'var(--ac-inv-soft)',          // subtle fill that reads on the inverted surface

  drawerBg: 'var(--ac-drawer-bg)',

  accent:     'var(--ac-accent)',
  accentText: 'var(--ac-accent-text)',
  accentSoft: 'var(--ac-accent-soft)',

  success:     'var(--ac-success)',
  successText: 'var(--ac-success-text)',
  successSoft: 'var(--ac-success-soft)',

  danger:     'var(--ac-danger)',
  dangerText: 'var(--ac-danger-text)',
  dangerSoft: 'var(--ac-danger-soft)',

  warn:     'var(--ac-warn)',
  warnText: 'var(--ac-warn-text)',
  warnSoft: 'var(--ac-warn-soft)',

  project:     'var(--ac-project)',       // purple — project / budget category
  projectText: 'var(--ac-project-text)',
  projectSoft: 'var(--ac-project-soft)',

  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',

  radius:     14,
  radiusSm:   10,
  radiusPill: 999,
};

// ── Theme: read / persist / toggle the data-theme on the portal root ──────────
export const THEME_KEY = 'ac-theme';

export function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch { return 'dark'; }
}

export function persistTheme(theme) {
  try { window.localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

export const TABULAR = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' };

// ── Icons ────────────────────────────────────────────────────────────────────
// Single consistent stroke family (1.6px, round joins). No emoji as icons.

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  layers:  (p) => <Svg {...p}><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/></Svg>,
  shield:  (p) => <Svg {...p}><path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9.5 12 1.8 1.8 3.4-3.6"/></Svg>,
  users:   (p) => <Svg {...p}><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 8a3 3 0 0 1 0 6"/><path d="M17.5 19a5.5 5.5 0 0 0-2.5-4.6"/></Svg>,
  key:     (p) => <Svg {...p}><circle cx="8" cy="8" r="4"/><path d="m11 11 8 8"/><path d="m16 16 2-2"/><path d="m19 13 2 2"/></Svg>,
  check:   (p) => <Svg {...p}><path d="m5 12.5 4.2 4.2L19 7"/></Svg>,
  x:       (p) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18"/></Svg>,
  rotate:  (p) => <Svg {...p}><path d="M20 11A8 8 0 1 0 18 16.5"/><path d="M20 5v6h-6"/></Svg>,
  trash:   (p) => <Svg {...p}><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/></Svg>,
  refresh: (p) => <Svg {...p}><path d="M20 11A8 8 0 1 0 18 16.5"/><path d="M20 5v6h-6"/></Svg>,
  inbox:   (p) => <Svg {...p}><path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4L5 5Z"/></Svg>,
  alert:   (p) => <Svg {...p}><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17h.01"/></Svg>,
  external:(p) => <Svg {...p}><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></Svg>,
  chevron: (p) => <Svg {...p}><path d="m6 9 6 6 6-6"/></Svg>,
  signout: (p) => <Svg {...p}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16 6 12l4-4"/><path d="M6 12h11"/></Svg>,
  doc:     (p) => <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></Svg>,
  rupee:   (p) => <Svg {...p}><path d="M7 4h10M7 8h10M16 4c0 4-3 5-6 5h-1l7 7"/></Svg>,
  wallet:  (p) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h12v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z"/><path d="M17 12.5h.01"/></Svg>,
  wrench:  (p) => <Svg {...p}><path d="M14.5 5.5a3.5 3.5 0 0 0-4.6 4.4L4 15.8 6.2 18l5.9-5.9a3.5 3.5 0 0 0 4.4-4.6l-2.1 2.1-1.8-.4-.4-1.8 2.3-1.9Z"/></Svg>,
  clock:   (p) => <Svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></Svg>,
  search:  (p) => <Svg {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></Svg>,
  caret:   (p) => <Svg {...p}><path d="m9 6 6 6-6 6"/></Svg>,
  chevronsLeft:  (p) => <Svg {...p}><path d="m11 7-5 5 5 5M18 7l-5 5 5 5"/></Svg>,
  chevronsRight: (p) => <Svg {...p}><path d="m13 7 5 5-5 5M6 7l5 5-5 5"/></Svg>,
  pin:     (p) => <Svg {...p}><path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10Z"/><circle cx="12" cy="11" r="2.2"/></Svg>,
  scale:   (p) => <Svg {...p}><path d="M12 4v16M7 20h10"/><path d="M5 8h14l-3 5a3 3 0 0 1-8 0L5 8Z"/></Svg>,
  flag:    (p) => <Svg {...p}><path d="M5 21V4"/><path d="M5 4h11l-1.6 3.5L16 11H5"/></Svg>,
  sun:     (p) => <Svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></Svg>,
  moon:    (p) => <Svg {...p}><path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z"/></Svg>,
  panel:   (p) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/></Svg>,
  scaleLogo: ({ size = 22, ...p }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" {...p}>
      <path d="M4 5.5 L20 5.5 L12 12 L20 18.5 L4 18.5 L12 12 Z" />
    </svg>
  ),
};

export const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

export function Avatar({ name, email, size = 30 }) {
  const label = (name || email || '?').trim();
  const initials = label.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
  // deterministic hue from the label
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return (
    <span style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700,
      color: `hsl(${h} 65% 82%)`, background: `hsl(${h} 45% 24%)`, border: `1px solid hsl(${h} 40% 34%)`,
    }}>{initials}</span>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({ as: Tag = 'div', interactive = false, raised = false, style, className = '', ...rest }) {
  const cls = ['ac-card', interactive ? 'ac-interactive' : '', raised ? 'is-raised' : '', className].filter(Boolean).join(' ');
  return (
    <Tag
      className={cls}
      style={{
        border: `1px solid ${T.line}`,
        borderRadius: T.radius,
        background: raised ? T.surfaceRaised : T.surface,
        ...style,
      }}
      {...rest}
    />
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

const BTN_VARIANTS = {
  solid:   { background: T.invBg, color: T.invText, border: '1px solid transparent' },
  success: { background: T.success, color: '#fff', border: '1px solid transparent' },
  danger:  { background: T.danger,  color: '#fff', border: '1px solid transparent' },
  accent:  { background: T.accent,  color: '#fff', border: '1px solid transparent' },
  ghost:   { background: T.chip, color: T.text, border: `1px solid ${T.lineStrong}` },
  subtle:  { background: T.chip, color: T.text, border: '1px solid transparent' },
};
const BTN_SIZES = {
  sm: { height: 30, padding: '0 12px', fontSize: 12.5, borderRadius: 9 },
  md: { height: 36, padding: '0 16px', fontSize: 13,   borderRadius: 10 },
};

export function Button({ variant = 'subtle', size = 'sm', loading = false, icon, children, style, disabled, ...rest }) {
  const isDisabled = disabled || loading;
  return (
    <button
      className={`ac-btn v-${variant}`}
      disabled={isDisabled}
      // Disabled/in-flight buttons must LOOK non-clickable — otherwise an admin
      // who clicks (e.g. Financial Closure) sees no state change. The disabled
      // visual is appended last so it wins over variant/caller styles.
      style={{ fontWeight: 650, cursor: 'pointer', ...BTN_VARIANTS[variant], ...BTN_SIZES[size], ...style, ...(isDisabled ? { cursor: 'not-allowed', opacity: 0.55 } : {}) }}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, loading = false, size = 32, children, style, ...rest }) {
  return (
    <button
      className={`ac-iconbtn${loading ? ' is-spinning' : ''}`}
      aria-label={label}
      title={label}
      style={{
        width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 9, border: `1px solid ${T.lineStrong}`, background: T.chip,
        color: T.textMuted, cursor: 'pointer', ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function Spinner({ size = 14 }) {
  return (
    <svg className="ac-spin-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={{ animation: 'ac-spin .8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── Badge / count ──────────────────────────────────────────────────────────────

export function CountBadge({ count, tone = 'neutral' }) {
  const active = count > 0;
  const tones = {
    neutral: { bg: T.chip, fg: T.textMuted },
    warn:    { bg: T.warnSoft,    fg: T.warnText },
    accent:  { bg: T.accentSoft,  fg: T.accentText },
    success: { bg: T.successSoft, fg: T.successText },
  };
  const c = active ? (tones[tone] || tones.neutral) : tones.neutral;
  return (
    <span style={{
      minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700,
      background: c.bg, color: active ? c.fg : T.textFaint, ...TABULAR,
    }}>{count}</span>
  );
}

export function StatusPill({ status }) {
  const map = {
    approved:  { fg: T.successText, dot: T.success },
    pending:   { fg: T.warnText,    dot: T.warn },
    submitted: { fg: T.accentText,  dot: T.accent },
    rejected:  { fg: T.dangerText,  dot: T.danger },
  };
  const c = map[status] || { fg: T.textFaint, dot: T.textFaint };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase', color: c.fg }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: c.dot, flexShrink: 0 }} />
      {status || '—'}
    </span>
  );
}

// ── Stat tile (overview) ────────────────────────────────────────────────────────

export function StatTile({ icon: TileIcon, label, count, caption, tone = 'accent', loading = false, onClick }) {
  const active = count > 0;
  const tones = {
    accent:  { fg: T.accentText,  chip: T.accentSoft },
    warn:    { fg: T.warnText,    chip: T.warnSoft },
    success: { fg: T.successText, chip: T.successSoft },
    neutral: { fg: T.text,        chip: T.chip },
  };
  const c = tones[tone] || tones.accent;
  return (
    <Card
      as="button"
      interactive
      raised
      onClick={onClick}
      style={{
        textAlign: 'left', padding: 20, display: 'flex', flexDirection: 'column', gap: 16,
        cursor: 'pointer', minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', background: c.chip, color: c.fg }}>
          <TileIcon size={21} />
        </span>
        <Icon.caret size={16} style={{ color: T.textFaint }} />
      </div>
      <div>
        {loading
          ? <div className="ac-skel" style={{ width: 52, height: 40, borderRadius: 8 }} />
          : <div style={{ fontSize: 40, lineHeight: 1, fontWeight: 760, letterSpacing: '-0.03em',
              color: active ? c.fg : T.textFaint, ...TABULAR }}>{count}</div>}
        <div style={{ marginTop: 9, fontSize: 14, fontWeight: 650, color: T.text }}>{label}</div>
        <div style={{ marginTop: 3, fontSize: 12, color: T.textFaint }}>{loading ? '—' : caption}</div>
      </div>
    </Card>
  );
}

// ── Segmented nav (tabs) ─────────────────────────────────────────────────────────

export function SegmentedNav({ tabs, active, onChange }) {
  return (
    <div role="tablist" style={{
      display: 'inline-flex', gap: 4, padding: 4, borderRadius: T.radiusPill,
      background: T.chip, border: `1px solid ${T.line}`, maxWidth: '100%', overflowX: 'auto',
    }}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        const TabIcon = t.icon;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`ac-tab${isActive ? ' is-active' : ''}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 14px',
              borderRadius: T.radiusPill, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              fontSize: 13, fontWeight: 650,
              background: isActive ? T.invBg : 'transparent',
              color: isActive ? T.invText : T.textMuted,
            }}
          >
            {TabIcon && <TabIcon size={16} />}
            {t.label}
            {t.count != null && (
              <span style={{
                minWidth: 19, height: 19, padding: '0 6px', borderRadius: 999, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, ...TABULAR,
                background: isActive ? T.invSoft : (t.count > 0 ? T.warnSoft : T.chip),
                color: isActive ? T.invText : (t.count > 0 ? T.warnText : T.textFaint),
              }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

export function SectionHeader({ icon: HeadIcon, title, description, count, tone = 'warn', onRefresh, refreshing, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
      {HeadIcon && (
        <span style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', background: T.chip, color: T.textMuted }}>
          <HeadIcon size={19} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 680, letterSpacing: '-0.01em', color: T.text }}>{title}</h2>
          {count != null && <CountBadge count={count} tone={tone} />}
        </div>
        {description && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: T.textMuted, lineHeight: 1.5 }}>{description}</p>}
      </div>
      {right}
      {onRefresh && (
        <IconButton label="Refresh" loading={refreshing} onClick={onRefresh}>
          <Icon.refresh size={16} />
        </IconButton>
      )}
    </div>
  );
}

// ── States: loading / empty / error ─────────────────────────────────────────────

export function Skeleton({ w = '100%', h = 14, r = 8, style }) {
  return <div className="ac-skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function EmptyState({ icon: EmptyIcon = Icon.inbox, title, hint }) {
  return (
    <Card style={{ padding: '36px 24px', textAlign: 'center', borderStyle: 'dashed' }}>
      <span style={{ width: 46, height: 46, borderRadius: 12, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', background: T.chip, color: T.textMuted, marginBottom: 12 }}>
        <EmptyIcon size={22} />
      </span>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{title}</div>
      {hint && <div style={{ marginTop: 4, fontSize: 12.5, color: T.textFaint }}>{hint}</div>}
    </Card>
  );
}

export function ErrorState({ message, onRetry, retrying }) {
  return (
    <Card style={{ padding: 18, background: T.dangerSoft, borderColor: 'rgba(192,65,63,0.4)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ color: T.dangerText, flexShrink: 0, marginTop: 1 }}><Icon.alert size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.dangerText }}>Couldn’t load</div>
          <div style={{ marginTop: 3, fontSize: 12.5, color: T.textMuted, lineHeight: 1.5, wordBreak: 'break-word' }}>{message}</div>
        </div>
        {onRetry && (
          <Button variant="ghost" size="sm" loading={retrying} onClick={onRetry} icon={<Icon.refresh size={14} />}>
            Retry
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Drawer (right-slide panel) ───────────────────────────────────────────────

function getPortalTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.querySelector('.ac-root[data-theme]')?.getAttribute('data-theme') || 'dark';
}

export function Drawer({ open, onClose, title, subtitle, headerRight, children, footer }) {
  const [portalTheme, setPortalTheme] = React.useState(getPortalTheme);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const root = document.querySelector('.ac-root[data-theme]');
    setPortalTheme(getPortalTheme());
    if (!root) return undefined;
    const observer = new MutationObserver(() => setPortalTheme(getPortalTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [open]);

  if (!open) return null;
  const drawer = (
    <div className="ac-root ac-portal-root" data-theme={portalTheme}>
      <div className="ac-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="ac-drawer" role="dialog" aria-modal="true">
        <div className="ac-drawer-header" style={{ padding: '18px 22px', borderBottom: `1px solid ${T.line}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {subtitle && <div style={{ fontSize: 11.5, letterSpacing: '0.04em', color: T.textMuted, marginBottom: 3 }}>{subtitle}</div>}
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 720, letterSpacing: '-0.015em', color: T.text }}>{title}</h2>
          </div>
          {headerRight}
          <IconButton label="Close" onClick={onClose}><Icon.x size={16} /></IconButton>
        </div>
        <div className="ac-drawer-body" style={{ flex: 1, overflowY: 'auto', padding: 22 }}>{children}</div>
        {footer && <div className="ac-drawer-footer" style={{ padding: '14px 22px', borderTop: `1px solid ${T.line}`, background: T.chip }}>{footer}</div>}
      </div>
      </div>
    </div>
  );
  return createPortal(drawer, document.body);
}

// ── Disclosure (expand/collapse row) ─────────────────────────────────────────

export function Disclosure({ header, children, defaultOpen = false, count }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: T.radiusSm, overflow: 'hidden', background: T.surface }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="ac-tab"
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <Icon.caret className={`ac-caret${open ? ' is-open' : ''}`} size={15} style={{ color: T.textFaint, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>{header}</div>
        {count != null && <CountBadge count={count} />}
      </button>
      {open && <div className="ac-fade-in" style={{ padding: '4px 14px 14px 34px' }}>{children}</div>}
    </div>
  );
}

// ── Theme toggle ─────────────────────────────────────────────────────────────

export function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark';
  return (
    <IconButton label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={onToggle}>
      {isDark ? <Icon.sun size={16} /> : <Icon.moon size={16} />}
    </IconButton>
  );
}
