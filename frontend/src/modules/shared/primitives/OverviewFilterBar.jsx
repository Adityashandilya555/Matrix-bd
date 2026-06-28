// skipcq: JS-0833
import React from 'react';
import SearchBox from './SearchBox.jsx';

function FilterChip({ active, label, count, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="zm-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 30,
        padding: '0 12px',
        borderRadius: 999,
        border: '1px solid ' + (active ? 'var(--zm-fg)' : 'var(--zm-line)'),
        background: active ? 'var(--zm-fg)' : 'var(--zm-surface)',
        color: active ? 'var(--zm-fg-inv)' : 'var(--zm-fg-2)',
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 120ms var(--zm-ease)',
      }}
    >
      {color && <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />}
      {label}
      {count != null && (
        <span
          style={{
            fontFamily: 'var(--zm-font-mono)',
            fontWeight: 500,
            fontSize: 11,
            color: active ? 'var(--zm-fg-inv)' : 'var(--zm-fg-3)',
            opacity: active ? 0.7 : 1,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function OverviewFilterBar({ filters, active, onFilter, search, onSearch, totalCount }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative', marginBottom: 14 }}>
      <SearchBox value={search} onChange={onSearch} />
      <FilterChip
        label="All"
        count={totalCount}
        active={active === 'all'}
        onClick={() => onFilter('all')}
      />
      {filters.map((f) => (
        <FilterChip
          key={f.key}
          label={f.label}
          count={f.count}
          color={f.color}
          active={active === f.key}
          onClick={() => onFilter(f.key)}
        />
      ))}
    </div>
  );
}
