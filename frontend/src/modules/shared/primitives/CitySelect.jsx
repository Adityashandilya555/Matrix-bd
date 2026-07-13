import React from 'react';
import Icon from './Icon.jsx';

// CitySelect — a contained dropdown for picking an Indian city.
//
// `options` may be either:
//   • an array of strings          → a single searchable list (legacy behaviour), or
//   • an array of { name, state }   → a two-pane picker: choose a state on the
//                                      left, then its cities appear on the right.
//                                      Each pane has its own type-to-filter box,
//                                      and you can also type a city name directly
//                                      to search across every state at once.
//
// In both shapes onChange receives only the chosen city name string, so the
// stored value (backend `city` is free text) and anything downstream are
// unaffected by which shape is passed.
//
// Props: value, onChange(cityName), options, placeholder, id.
export default function CitySelect({ value, onChange, options, placeholder = 'Select city…', id }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');           // city filter
  const [stateSearch, setStateSearch] = React.useState(''); // state filter
  const [activeState, setActiveState] = React.useState(null);
  const wrapRef = React.useRef(null);

  // Normalise to { name, state } records so the rest of the component has a
  // single shape to reason about. Strings become state-less records.
  const items = React.useMemo(
    () => (options || []).map((o) => (typeof o === 'string' ? { name: o, state: null } : o)),
    [options],
  );
  const hasStates = React.useMemo(() => items.some((i) => i.state), [items]);
  const states = React.useMemo(
    () => [...new Set(items.filter((i) => i.state).map((i) => i.state))]
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    [items],
  );

  const openMenu = () => {
    // Preselect the current value's state so reopening lands on it in context.
    const rec = items.find((i) => i.name === value);
    setActiveState(rec ? rec.state : null);
    setQuery('');
    setStateSearch('');
    setOpen(true);
  };

  React.useEffect(() => {
    // Reset all filters on every close so the menu never reopens stale.
    if (!open) { setQuery(''); setStateSearch(''); setActiveState(null); return undefined; }
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

  const choose = (name) => { onChange(name); setOpen(false); };

  const q = query.trim().toLowerCase();
  const sq = stateSearch.trim().toLowerCase();

  // Legacy (string) mode: one flat, city-searchable list.
  const matched = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;

  // Structured mode: left = states, right = cities of the active state (or a
  // global city search when the user just starts typing).
  const stateResults = sq ? states.filter((s) => s.toLowerCase().includes(sq)) : states;
  let cityResults; // null → show the "pick a state" hint
  if (q) {
    const base = activeState ? items.filter((i) => i.state === activeState) : items;
    cityResults = base.filter((i) => i.name.toLowerCase().includes(q));
  } else if (activeState) {
    cityResults = items.filter((i) => i.state === activeState);
  } else {
    cityResults = null;
  }
  const showCityStateTag = !activeState; // disambiguate global-search results

  // ---- shared styles ----
  const fieldStyle = {
    height: 38, padding: '0 10px 0 12px', border: '1px solid var(--zm-line)',
    borderRadius: 6, background: 'var(--zm-bg)', fontFamily: 'var(--zm-font-body)',
    fontSize: 13.5, color: 'var(--zm-fg)', outline: 'none', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer',
    width: '100%',
  };
  const optionStyle = (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
    background: active ? 'var(--zm-surface-hover)' : 'transparent',
    fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg)',
    cursor: 'pointer',
  });
  const searchRow = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
    borderBottom: '1px solid var(--zm-line)',
  };
  const searchInput = {
    flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
    fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)',
  };
  const noteStyle = { padding: 12, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' };
  const tagStyle = {
    flex: '0 0 auto', fontSize: 10.5, color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)',
    whiteSpace: 'nowrap', maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis',
  };

  const hoverIn = (active) => (e) => { if (!active) e.currentTarget.style.background = 'var(--zm-surface-hover)'; };
  const hoverOut = (active) => (e) => { if (!active) e.currentTarget.style.background = 'transparent'; };

  const CityButton = ({ item }) => {
    const active = item.name === value;
    return (
      <button
        type="button" role="option" aria-selected={active}
        onClick={() => choose(item.name)}
        onMouseEnter={hoverIn(active)} onMouseLeave={hoverOut(active)}
        style={optionStyle(active)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
        {showCityStateTag && item.state
          ? <span style={tagStyle}>{item.state}</span>
          : (active && <Icon name="check" size={14} style={{ color: 'var(--zm-accent)', flex: '0 0 auto' }} />)}
      </button>
    );
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button" id={id} onClick={() => (open ? setOpen(false) : openMenu())}
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

      {open && (hasStates ? (
        // ---- Two-pane picker (wider than the field; anchored to its right edge
        // so it never spills past the modal). ----
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: 'min(460px, 86vw)', zIndex: 200,
            background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
            borderRadius: 8, boxShadow: 'var(--zm-shadow-pop)', overflow: 'hidden',
            display: 'flex',
          }}
        >
          {/* Left: states */}
          <div style={{ flex: '0 0 168px', borderRight: '1px solid var(--zm-line)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={searchRow}>
              <Icon name="search" size={13} style={{ color: 'var(--zm-fg-3)', flex: '0 0 auto' }} />
              <input value={stateSearch} onChange={(e) => setStateSearch(e.target.value)} placeholder="Search state…" style={searchInput} />
            </div>
            <div role="listbox" aria-label="States" style={{ maxHeight: 252, overflowY: 'auto' }}>
              {stateResults.length === 0 ? (
                <div style={noteStyle}>No states match “{stateSearch}”.</div>
              ) : stateResults.map((s) => {
                const active = s === activeState;
                return (
                  <button
                    type="button" key={s} role="option" aria-selected={active}
                    onClick={() => { setActiveState(active ? null : s); setQuery(''); }}
                    onMouseEnter={hoverIn(active)} onMouseLeave={hoverOut(active)}
                    style={optionStyle(active)}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s}</span>
                    {active && <Icon name="check" size={14} style={{ color: 'var(--zm-accent)', flex: '0 0 auto' }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: cities of the active state (or global city search) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={searchRow}>
              <Icon name="search" size={13} style={{ color: 'var(--zm-fg-3)', flex: '0 0 auto' }} />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city…" style={searchInput} />
            </div>
            <div role="listbox" aria-label="Cities" style={{ maxHeight: 252, overflowY: 'auto' }}>
              {cityResults === null ? (
                <div style={noteStyle}>Select a state to list its cities — or start typing a city name.</div>
              ) : cityResults.length === 0 ? (
                <div style={noteStyle}>No cities match “{query}”.</div>
              ) : cityResults.map((c) => <CityButton key={`${c.state}:${c.name}`} item={c} />)}
            </div>
          </div>
        </div>
      ) : (
        // ---- Legacy single-pane list (string options) ----
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
            background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
            borderRadius: 8, boxShadow: 'var(--zm-shadow-pop)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={searchRow}>
            <Icon name="search" size={13} style={{ color: 'var(--zm-fg-3)', flex: '0 0 auto' }} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city…" style={searchInput} />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {matched.length === 0 ? (
              <div style={noteStyle}>No cities match “{query}”.</div>
            ) : matched.map((c) => <CityButton key={c.name} item={c} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
