import React from 'react';
import { T, Icon, TABULAR } from './kit.jsx';
import { PRODUCT_NAME } from '../../../router/routes.js';

// Expandable left rail for the business-admin portal. Collapsed = icon rail with
// tooltips + a pending dot; expanded = icons + labels + count badges. Brand mark
// at the top, theme/sign-out/collapse at the bottom. A floating rounded panel.

const W_EXPANDED = 238;
const W_COLLAPSED = 76;

const rowBase = (expanded) => ({
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', height: 44,
  padding: expanded ? '0 12px' : 0, justifyContent: expanded ? 'flex-start' : 'center',
  borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
  fontSize: 13.5, fontFamily: 'inherit', background: 'transparent', color: T.textMuted,
});

export default function Sidebar({
  items, active, onChange, expanded, onToggleExpanded,
  theme, onToggleTheme, onLogout, brand = PRODUCT_NAME, sub = 'Business admin',
}) {
  return (
    <aside className="ac-sidebar" style={{
      width: expanded ? W_EXPANDED : W_COLLAPSED, flexShrink: 0, height: '100%', boxSizing: 'border-box',
      background: T.panel, border: `1px solid ${T.line}`, borderRadius: 22, boxShadow: T.cardShadow,
      display: 'flex', flexDirection: 'column', padding: '18px 14px', overflow: 'hidden',
    }}>
      {/* Brand + collapse toggle (always visible, top) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px 16px', minWidth: 0 }}>
        <Icon.scaleLogo size={36} style={{ borderRadius: 11, flexShrink: 0, display: 'block' }} />
        {expanded && (
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: 'var(--zm-font-display)',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: T.text,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{brand}</div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textFaint, marginTop: 4 }}>{sub}</div>
          </div>
        )}
        {expanded && (
          <button className="ac-iconbtn" onClick={onToggleExpanded} aria-label="Collapse sidebar" title="Collapse"
            style={{ width: 30, height: 30, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 9, border: `1px solid ${T.line}`, background: T.chip, color: T.textMuted, cursor: 'pointer' }}>
            <Icon.chevronsLeft size={16} />
          </button>
        )}
      </div>

      {/* Expand toggle (shown only when collapsed) */}
      {!expanded && (
        <button className="ac-iconbtn" onClick={onToggleExpanded} aria-label="Expand sidebar" title="Expand"
          style={{ width: '100%', height: 38, marginBottom: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, border: `1px solid ${T.line}`, background: T.chip, color: T.textMuted, cursor: 'pointer' }}>
          <Icon.chevronsRight size={18} />
        </button>
      )}

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {items.map((it) => {
          const isActive = active === it.key;
          const ItIcon = it.icon;
          const hasCount = it.count != null && it.count > 0;
          return (
            <button
              key={it.key}
              className={`ac-navitem${isActive ? ' is-active' : ''}`}
              onClick={() => onChange(it.key)}
              title={expanded ? undefined : it.label}
              aria-current={isActive ? 'page' : undefined}
              style={{
                ...rowBase(expanded),
                background: isActive ? T.accentSoft : 'transparent',
                color: isActive ? T.accentText : T.textMuted,
                fontWeight: isActive ? 660 : 560,
              }}
            >
              <span style={{ display: 'inline-flex', flexShrink: 0 }}><ItIcon size={20} /></span>
              {expanded && (
                <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
              )}
              {hasCount && expanded && (
                <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  background: T.warnSoft, color: T.warnText, ...TABULAR }}>{it.count}</span>
              )}
              {hasCount && !expanded && (
                <span style={{ position: 'absolute', top: 9, right: 13, width: 8, height: 8, borderRadius: 999,
                  background: T.warn, border: `2px solid ${T.panel}` }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: `1px solid ${T.line}`, paddingTop: 10, marginTop: 10 }}>
        <button className="ac-navitem" onClick={onToggleTheme}
          title={expanded ? undefined : (theme === 'dark' ? 'Light mode' : 'Dark mode')}
          style={{ ...rowBase(expanded), height: 42 }}>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>{theme === 'dark' ? <Icon.sun size={19} /> : <Icon.moon size={19} />}</span>
          {expanded && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        <button className="ac-navitem" onClick={onLogout} title={expanded ? undefined : 'Sign out'}
          style={{ ...rowBase(expanded), height: 42 }}>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}><Icon.signout size={19} /></span>
          {expanded && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
