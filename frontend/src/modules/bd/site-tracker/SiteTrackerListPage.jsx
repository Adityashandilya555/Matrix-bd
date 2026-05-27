import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { listSites } from '../../../services/api/siteService.js';
import { siteTrackerDetailRoute } from '../../../router/routes.js';

// Statuses surfaced in the site tracker. The backend list endpoint accepts a
// single status string, so fan out into three reads in parallel and merge.
const TRACKED_STATUSES = ['legal_review', 'legal_approved', 'pushed_to_payments'];

const FILTERS = [
  { key: 'all',                 label: 'All sites' },
  { key: 'legal_review',        label: 'Legal review' },
  { key: 'legal_approved',      label: 'Legal approved' },
  { key: 'pushed_to_payments',  label: 'Pushed to payments' },
];

const STAGE_LABELS = {
  legal_review:       'Legal review',
  legal_approved:     'Legal approved',
  pushed_to_payments: 'Pushed to payments',
};

function tone(value) {
  if (!value || value === 'pending') return { color: 'var(--zm-fg-3)', label: 'Pending' };
  if (value === 'positive' || value === 'complete' || value === 'signed' || value === 'registered') {
    return { color: 'var(--zm-success, #2D7A48)', label: value };
  }
  if (value === 'negative' || value === 'rejected') {
    return { color: 'var(--zm-danger, #B91C1C)',  label: value };
  }
  return { color: 'var(--zm-fg-2)', label: value };
}

function StatusChip({ value }) {
  const t = tone(value);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      height: 22, padding: '0 8px', borderRadius: 4,
      border: `1px solid ${t.color}`, color: t.color,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10.5,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      {t.label}
    </span>
  );
}

function FilterBar({ filter, setFilter, query, setQuery }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 10, padding: 14, alignItems: 'center',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, boxShadow: 'var(--zm-shadow-1)',
    }}>
      <div style={{ position: 'relative', minWidth: 240, flex: '1 1 240px' }}>
        <Icon name="search" size={13} style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--zm-fg-3)', pointerEvents: 'none',
        }}/>
        <input
          placeholder="Search by name, code or city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', height: 36,
            padding: '0 10px 0 32px',
            background: 'var(--zm-bg)', border: '1px solid var(--zm-line)',
            borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13,
            color: 'var(--zm-fg)', outline: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                height: 32, padding: '0 12px',
                borderRadius: 999,
                border: '1px solid ' + (on ? 'var(--zm-accent)' : 'var(--zm-line)'),
                background: on ? 'var(--zm-accent-soft, var(--zm-surface-2))' : 'var(--zm-surface)',
                color: on ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
                fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SiteTrackerListPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [filter, setFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', items: [], error: null });

    // The list endpoint accepts a single status string. Fan out the three
    // tracked statuses in parallel and merge — same shape sitter as
    // /bd/shortlist does on the backend.
    Promise.all(TRACKED_STATUSES.map((s) =>
      listSites({ status: s }).catch(() => []),
    ))
      .then((groups) => {
        if (cancelled) return;
        const seen = new Set();
        const merged = [];
        for (const group of groups) {
          for (const row of group || []) {
            if (!row || seen.has(row.id)) continue;
            seen.add(row.id);
            merged.push(row);
          }
        }
        setState({ status: 'ready', items: merged, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'error', items: [],
          error: err?.detail || err?.message || 'Failed to load sites',
        });
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.items.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!q) return true;
      const hay = [s.name, s.code, s.city].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [state.items, filter, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow="BD module"
        title={<>Site <em>tracker</em></>}
        lede="Sites in legal review, legal approved, or pushed to payments. Open one to see the full handover graph."
        right={<HeaderTag icon="activity" label={`${filtered.length} SITES`}/>}
      />

      <FilterBar
        filter={filter}
        setFilter={setFilter}
        query={query}
        setQuery={setQuery}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading…
        </div>
      )}
      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger, #B91C1C)' }}>{state.error}</div>
      )}
      {state.status === 'ready' && filtered.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="activity" size={20}/>
          <p style={{ margin: '12px 0 0' }}>No sites match these filters.</p>
        </div>
      )}

      {state.status === 'ready' && filtered.length > 0 && (
        <div style={{
          background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
          borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '110px minmax(220px,1.4fr) 140px 170px 130px 130px 130px',
            gap: 12, padding: '11px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Name</span>
            <span>City</span>
            <span>Stage</span>
            <span>Legal DD</span>
            <span>Agreement</span>
            <span>Licensing</span>
          </div>
          {filtered.map((row) => (
            <div
              key={row.id}
              onClick={() => navigate(siteTrackerDetailRoute(row.id))}
              style={{
                display: 'grid',
                gridTemplateColumns: '110px minmax(220px,1.4fr) 140px 170px 130px 130px 130px',
                gap: 12, padding: '14px 16px',
                borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>
                {row.code || '—'}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--zm-fg)' }}>
                  {row.name}
                </span>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>
                  {row.id}
                </span>
              </div>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>
                {row.city}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, color: 'var(--zm-fg-2)' }}>
                {STAGE_LABELS[row.status] || row.status}
              </span>
              <StatusChip value={row.legalDdStatus}/>
              <StatusChip value={row.agreementStatus}/>
              <StatusChip value={row.licensingStatus}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
