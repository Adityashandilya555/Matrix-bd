import React from 'react';
import { usePageContext } from '../../App.jsx';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Avatar from '../shared/primitives/Avatar.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useLaunchSites } from '../../hooks/useLaunchSites.js';

// LaunchPage — BD-facing list of sites that completed the Project module and
// were handed to NSO for launch (tracker projectStatus === 'done'). Reached
// from the sidebar "Launch" tab and the Overview "Launch" KPI.

const PROJECT_LABELS = {
  done: 'Project complete',
};

const FINANCE_LABELS = {
  pending: 'Finance not started',
  awaiting_supervisor: 'Finance · awaiting supervisor',
  awaiting_admin: 'Finance · awaiting admin',
  approved: 'Finance approved',
};

function inRange(iso, from, to) {
  if (!iso) return true;
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export default function LaunchPage() {
  const { onOpenSite } = usePageContext();
  const { rows, loading, error, refresh } = useLaunchSites();
  const [q, setQ] = React.useState('');
  const [range, setRange] = React.useState({ from: '', to: '' });

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((site) => {
    if (needle) {
      const owner = site.createdBy?.name || site.createdBy || '';
      const hay = `${site.code || ''} ${site.name || ''} ${site.city || ''} ${owner}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return inRange(site.updatedAt, range.from, range.to);
  });

  const dateActive = !!(range.from || range.to);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="№ 10" eyebrow="BD module"
        title={<>Launch <em>sites</em></>}
        lede={`${rows.length} site${rows.length === 1 ? '' : 's'} handed to NSO`}
        right={<HeaderTag icon="flag" label={`${rows.length} IN LAUNCH`}/>}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', flex: '1 1 260px', maxWidth: 380, border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)' }}>
          <Icon name="search" size={14} style={{ color: 'var(--zm-fg-3)' }}/>
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search code, site, city…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}
          />
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>
          <Icon name="calendar" size={13}/> Last activity
        </span>
        <input type="date" value={range.from} onChange={(e) => setRange(r => ({ ...r, from: e.target.value }))} style={{ height: 36, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg)', outline: 'none' }}/>
        <span style={{ color: 'var(--zm-fg-4)' }}>→</span>
        <input type="date" value={range.to} onChange={(e) => setRange(r => ({ ...r, to: e.target.value }))} style={{ height: 36, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg)', outline: 'none' }}/>
        {dateActive && (
          <button onClick={() => setRange({ from: '', to: '' })} style={{ height: 36, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Clear</button>
        )}
        <span style={{ flex: 1 }}/>
        <button onClick={refresh} style={{ height: 36, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="refresh" size={13}/> Refresh
        </button>
      </div>

      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1.1fr 1.2fr 1.2fr', gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
          <span>Code</span><span>Site</span><span>City</span><span>Owner</span><span>Project</span><span>Finance</span>
        </div>

        {loading && (
          <div style={{ padding: 42, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
            Loading launch sites…
          </div>
        )}

        {!loading && error && (
          <div style={{ margin: 16, padding: 14, borderRadius: 10, border: '1px solid var(--zm-danger)', background: 'var(--zm-danger-soft)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && !error && filtered.map((site) => {
          const owner = site.createdBy?.name || site.createdBy || '—';
          return (
            <div key={site.id} data-site-id={site.id} className="zm-row" onClick={() => onOpenSite?.(site)} style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1.1fr 1.2fr 1.2fr', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer', position: 'relative', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{site.code}</span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{site.name}</span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{site.city}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Avatar name={owner} size={20}/>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{owner}</span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, color: 'var(--zm-success)' }}>
                <Icon name="check" size={12}/> {PROJECT_LABELS[site.projectStatus] || 'With NSO'}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: site.financeStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-fg-2)', fontWeight: 600 }}>
                {FINANCE_LABELS[site.financeStatus || 'pending'] || site.financeStatus}
              </span>
            </div>
          );
        })}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
            {rows.length === 0
              ? 'No sites in launch yet. Sites land here once the Project module marks them done and pushes them to NSO.'
              : 'No launch sites match the current search / date filter.'}
          </div>
        )}
      </div>
    </div>
  );
}
