// skipcq: JS-0833
import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import MetricCard from '../shared/primitives/MetricCard.jsx';
import SearchBox from '../shared/primitives/SearchBox.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import OverviewFilterBar from '../shared/primitives/OverviewFilterBar.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { getLegalQueue } from '../../services/api/legalApi.js';
import { listPendingChangeRequests } from '../../services/api/changeRequestApi.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { ROUTES } from '../../router/routes.js';
import { keyActivate } from '../../lib/a11y.js';

// Legal module overview — four drill-down KPIs over the legal queue +
// change-request backlog:
//   Ⅰ Sites in Legal  — everything in the legal queue. Click → expands in
//     place with DD-status pills + search + the queue table.
//   Ⅱ DD in review    — queue rows whose DD is pending / in review. Click →
//     same drill-down, preselecting the pending + in-review pills.
//   Ⅲ DD positive     — queue rows with a positive DD verdict. Click → same
//     drill-down, preselecting the positive pill.
//   Ⅳ Change requests — pending BD→Legal change requests. Click →
//     /legal/change-requests.
// Table rows deep-link to /legal?focus=<siteId> (useFocusSite scrolls +
// flashes the row in the queue tab).

const DD_STATUSES = ['pending', 'in_review', 'positive', 'negative'];

const STATUS_LABELS = {
  pending:   { label: 'Awaiting review', tone: 'var(--zm-fg-3)' },
  in_review: { label: 'In review',       tone: 'var(--zm-accent)' },
  positive:  { label: 'DD positive',     tone: 'var(--zm-success)' },
  negative:  { label: 'DD negative',     tone: 'var(--zm-danger)' },
};

const PILL_META = {
  pending:   { label: 'DD Pending', color: 'var(--zm-fg-3)' },
  in_review: { label: 'In review',  color: 'var(--zm-accent)' },
  positive:  { label: 'Positive',   color: 'var(--zm-success)' },
  negative:  { label: 'Negative',   color: 'var(--zm-danger)' },
};

const IN_REVIEW_STATUSES = ['pending', 'in_review'];

function StatusPill({ value }) {
  const meta = STATUS_LABELS[value] || { label: value || 'unknown', tone: 'var(--zm-fg-3)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${meta.tone}`, color: meta.tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }}>
      {meta.label}
    </span>
  );
}

// QueueTable — Code | Site | City | DD status (row styling mirrors the
// LegalQueuePage listing; rows deep-link into the queue tab).
function QueueTable({ rows, onOpen, limit, style }) {
  const displayRows = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}>
      <div style={{
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--zm-surface-2)',
        borderBottom: '1px solid var(--zm-line)',
        fontFamily: 'var(--zm-font-body)',
        fontWeight: 800,
        fontSize: 10.5,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--zm-fg-3)',
      }}>
        <span>Code</span>
        <span>Site</span>
        <span>City</span>
        <span>Days in stage</span>
        <span>DD status</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {displayRows.map((row) => (
          <div
            key={row.siteId}
            className="zm-row"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(row)}
            onKeyDown={keyActivate(() => onOpen(row))}
            style={{
              display: 'grid',
              gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px',
              gap: 12,
              padding: '14px 16px',
              borderBottom: '1px solid var(--zm-line-faint)',
              cursor: 'pointer',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
              {row.siteCode}
            </span>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>
              {row.siteName}
            </span>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>{row.city}</span>
            <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg)' }}>{row.daysInStage ?? '—'}</span>
            <div>
              <StatusPill status={row.legalDdStatus} />
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
            No Legal sites match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}

export default function LegalOverviewPage() {
  const navigate = useNavigate();
  const [queue, setQueue] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  const [crs, setCrs] = React.useState({ status: 'loading', total: 0, error: null });

  // view: which KPI is expanded in place (Ⅳ navigates away).
  const [view, setView] = React.useState(null); // null | 'queue' | 'in_review' | 'positive'
  // Active DD-status pills inside the drill-down (empty set = all).
  const [subFilters, setSubFilters] = React.useState(() => new Set());
  const [search, setSearch] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState('all');

  const load = React.useCallback(() => {
    let cancelled = false;
    getLegalQueue()
      .then((data) => { if (!cancelled) setQueue({ status: 'ready', items: data.items, total: data.total, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        // Failed background refresh keeps the loaded KPIs/list + shows a banner.
        setQueue((s) => ({
          ...s,
          status: s.items.length ? 'ready' : 'error',
          error: err?.detail || err?.message || 'Failed to load legal queue',
        }));
      });
    listPendingChangeRequests()
      .then((data) => { if (!cancelled) setCrs({ status: 'ready', total: data.total, error: null }); })
      .catch((err) => {
        if (cancelled) return;
        setCrs((s) => ({
          ...s,
          status: s.status === 'ready' ? 'ready' : 'error',
          error: err?.detail || err?.message || 'Failed to load change requests',
        }));
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load);

  const counts = React.useMemo(() => {
    const byStatus = { pending: 0, in_review: 0, positive: 0, negative: 0 };
    for (const row of queue.items) {
      if (byStatus[row.legalDdStatus] != null) byStatus[row.legalDdStatus] += 1;
    }
    return byStatus;
  }, [queue.items]);

  // Headline count uses the server COUNT(*) (queue.total), not the loaded page
  // size. Per-stage breakdowns below stay over the loaded items.
  const totalInQueue = queue.total;
  const ddInReview = counts.pending + counts.in_review;
  const pad = (n) => String(n).padStart(2, '0');

  const selectKpi = (key, preset) => {
    if (view === key) {
      setView(null);
      return;
    }
    setView(key);
    setSubFilters(new Set(preset || []));
    setSearch('');
  };

  const toggleSubFilter = (status) => {
    setSubFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const needle = search.trim().toLowerCase();
  const filteredRows = queue.items
    .filter((row) => {
      if (view) {
        return subFilters.size === 0 ? true : subFilters.has(row.legalDdStatus);
      }
      return activeFilter === 'all' ? true : row.legalDdStatus === activeFilter;
    })
    .filter((row) => !needle || [row.siteCode, row.siteName, row.city].join(' ').toLowerCase().includes(needle));

  const openRow = (row) => {
    navigate(`${ROUTES.LEGAL}?focus=${encodeURIComponent(row.siteId)}`);
  };

  const loading = queue.status === 'loading';
  const cardMeta = {
    queue: {
      no: 'Ⅰ', eyebrow: 'Sites in Legal', rule: 'var(--zm-accent)', tone: 'peach',
      value: loading ? '··' : pad(totalInQueue),
      delta: 'In legal review', deltaTone: 'neutral',
      sub: 'Everything in the legal queue',
      onClick: () => selectKpi('queue'),
    },
    in_review: {
      no: 'Ⅱ', eyebrow: 'DD in review', rule: 'var(--zm-info)', tone: 'blue',
      value: loading ? '··' : pad(ddInReview),
      delta: 'Pending + in review', deltaTone: 'neutral',
      sub: `${counts.pending} awaiting · ${counts.in_review} in review`,
      onClick: () => selectKpi('in_review', IN_REVIEW_STATUSES),
    },
    positive: {
      no: 'Ⅲ', eyebrow: 'DD positive', rule: 'var(--zm-success)', tone: 'mint',
      value: loading ? '··' : pad(counts.positive),
      delta: 'Verdict cleared', deltaTone: 'pos',
      sub: 'Ready for agreement / licensing',
      onClick: () => selectKpi('positive', ['positive']),
    },
  };

  const lede = loading
    ? 'Loading module KPIs…'
    : `${totalInQueue} site${totalInQueue === 1 ? '' : 's'} in legal · ${crs.total} change request${crs.total === 1 ? '' : 's'} pending`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0 }}>
        <PageHeader
          file="No. 05" eyebrow="Legal module" title="Overview"
          lede={lede}
          right={<HeaderTag icon="legalShield" label="LEGAL_REVIEW"/>}
        />
      </div>

      {queue.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{queue.error}</div>
      )}

      {queue.status === 'ready' && !view && (
        <>
          <div style={{ flexShrink: 0 }}>
            <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
              <MetricCard {...cardMeta.queue}/>
              <MetricCard {...cardMeta.in_review}/>
              <MetricCard {...cardMeta.positive}/>
              <MetricCard
                tone="slate"
                no="Ⅳ" eyebrow="Change requests" rule="var(--zm-copper)"
                value={crs.status === 'loading' ? '··' : pad(crs.total)}
                delta={crs.status === 'error' ? 'Unavailable' : 'Awaiting decision'}
                deltaTone="neutral"
                sub="BD → Legal status changes"
                onClick={() => navigate(ROUTES.LEGAL_CHANGE_REQUESTS)}
              />
            </div>
            <OverviewFilterBar
              filters={DD_STATUSES.map(status => ({
                key: status,
                label: PILL_META[status].label,
                count: counts[status],
                color: PILL_META[status].color
              }))}
              active={activeFilter}
              onFilter={setActiveFilter}
              search={search}
              onSearch={setSearch}
              totalCount={totalInQueue}
            />
          </div>
          <QueueTable rows={filteredRows} limit={12} onOpen={openRow} style={{ flex: 1, minHeight: 0 }}/>
        </>
      )}

      {queue.status === 'ready' && view && (
        <>
          <div style={{ flexShrink: 0 }}>
            <div>
              <button
                type="button"
                onClick={() => setView(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 18 }}
              >
                <Icon name="arrow" size={12} style={{ transform: 'rotate(180deg)' }}/> All metrics
              </button>
            </div>

            <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
              <MetricCard {...cardMeta[view]} selected/>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
              <SearchBox value={search} onChange={setSearch}/>
              {DD_STATUSES.map((status) => (
                <SubFilterPill
                  key={status}
                  label={PILL_META[status].label}
                  count={counts[status]}
                  color={PILL_META[status].color}
                  active={subFilters.has(status)}
                  onClick={() => toggleSubFilter(status)}
                />
              ))}
            </div>
          </div>

          <QueueTable rows={filteredRows} onOpen={openRow} style={{ flex: 1, minHeight: 0 }}/>
        </>
      )}
    </div>
  );
}
