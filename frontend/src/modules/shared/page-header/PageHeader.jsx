import React from 'react';
import Icon from '../primitives/Icon.jsx';

// Render bodies preserved exactly from PageHeader.jsx.

export function HeaderTag({ icon, label, tone = 'default' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px 0 9px', borderRadius: 4,
      border: '1px solid ' + (tone === 'accent' ? 'var(--zm-accent)' : 'var(--zm-line-strong)'),
      background: 'transparent',
      color: tone === 'accent' ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.16em', textTransform: 'uppercase',
      whiteSpace: 'nowrap', lineHeight: 1,
    }}>
      {icon && <Icon name={icon} size={11}/>}
      {label}
    </span>
  );
}

export default function PageHeader({ file, eyebrow, title, lede, right }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24,
      marginBottom: 22, paddingBottom: 18,
      borderBottom: '1px solid var(--zm-line)',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>

        <h1 className="zm-page-title" style={{
          margin: 0, color: 'var(--zm-fg)',
          fontFamily: 'var(--zm-font-display)', fontWeight: 800,
          fontSize: 44, lineHeight: 1.04, letterSpacing: '-0.03em',
          fontStyle: 'normal',
          textWrap: 'balance',
        }}>{title}</h1>

        {lede && (
          <p style={{
            margin: '8px 0 0', maxWidth: 720,
            fontFamily: 'var(--zm-font-body)', fontSize: 13.5, lineHeight: 1.55, color: 'var(--zm-fg-2)',
          }}>{lede}</p>
        )}
      </div>

      {right && <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', gap: 10 }}>{right}</div>}
    </header>
  );
}
