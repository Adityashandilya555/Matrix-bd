import React from 'react';
import Icon from './Icon.jsx';

// MetricCard — large overview KPI card (extracted from the BD OverviewPage so
// module overviews share one implementation; the BD page keeps its local copy
// untouched). Optional onClick makes the card a drill-down trigger; `selected`
// outlines it with its rule color and swaps the chevron for an ×.

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

// Peach-skyline KPI fills. `tone` is optional — when omitted the card keeps its
// original glass look (zero regression for existing callers). When set, the card
// is filled with the brand pastel and text flips to a readable on-fill ink.
const TONE_FILL = {
  peach: 'var(--zm-brand-peach)',
  blue:  'var(--zm-brand-blue)',
  mint:  'var(--zm-brand-mint)',
  slate: 'var(--zm-brand-slate)',
};

export default function MetricCard({ eyebrow, value, rule = 'var(--zm-copper)', delta, deltaTone = 'pos', sub, no, onClick, selected = false, tone }) {
  const fill = TONE_FILL[tone];
  const toned = !!fill;
  // On a filled card every label/number uses the on-fill ink; the colored rule
  // is replaced by the same ink so it never clashes with the pastel.
  const onColor = tone === 'slate' ? 'var(--zm-brand-on-slate)' : 'var(--zm-brand-on-pastel)';
  const ruleColor = toned ? onColor : rule;
  const valueColor = toned ? onColor : 'var(--zm-fg)';
  const metaColor = toned ? onColor : 'var(--zm-fg-3)';
  const noColor = toned ? onColor : 'var(--zm-fg-4)';
  return (
    <div className="zm-glass"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
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
