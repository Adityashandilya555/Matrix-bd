import React from 'react';
import Icon from './Icon.jsx';

// CitySelect — a contained, searchable dropdown for picking from a long option
// list (e.g. Indian cities). A native <select> with 100+ options renders an
// unconstrained OS popup that spills across the page; this keeps the menu
// anchored under the field with a fixed-height, internally-scrolling panel and
// a type-to-filter box. Backend `city` is free text, so the value is just the
// chosen string.
//
// Props: value, onChange(city), options[string], placeholder, id.
export default function CitySelect({ value, onChange, options, placeholder = 'Select city…', id }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    // Reset the filter on every close (outside-click / Escape / toggle /
    // selection) so the menu never reopens in a stale, filtered-empty state.
    if (!open) { setQuery(''); return undefined; }
    const onDocMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((c) => c.toLowerCase().includes(q)) : options;

  const choose = (c) => { onChange(c); setQuery(''); setOpen(false); };

  const fieldStyle = {
    height: 38, padding: '0 10px 0 12px', border: '1px solid var(--zm-line)',
    borderRadius: 6, background: 'var(--zm-bg)', fontFamily: 'var(--zm-font-body)',
    fontSize: 13.5, color: 'var(--zm-fg)', outline: 'none', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer',
    width: '100%',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button" id={id} onClick={() => setOpen((o) => !o)}
        style={fieldStyle} aria-haspopup="listbox" aria-expanded={open}
      >
        <span style={{
          color: value ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value || placeholder}
        </span>
        <Icon name="chevronDown" size={14} style={{ color: 'var(--zm-fg-3)', flex: '0 0 auto' }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
            background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
            borderRadius: 8, boxShadow: 'var(--zm-shadow-pop)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--zm-line)' }}>
            <Icon name="search" size={13} style={{ color: 'var(--zm-fg-3)', flex: '0 0 auto' }} />
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city…"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}
            />
          </div>

          {/* Fixed-height scroll area — this is what keeps the menu "in its box". */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: 12, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
                No cities match “{query}”.
              </div>
            )}
            {filtered.map((c) => {
              const active = c === value;
              return (
                <button
                  type="button" key={c} role="option" aria-selected={active}
                  onClick={() => choose(c)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
                    background: active ? 'var(--zm-surface-hover)' : 'transparent',
                    fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</span>
                  {active && <Icon name="check" size={14} style={{ color: 'var(--zm-accent)', flex: '0 0 auto' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
