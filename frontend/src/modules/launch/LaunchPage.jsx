import React from 'react';
import { usePageContext } from '../../App.jsx';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Avatar from '../shared/primitives/Avatar.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useLaunchSites } from '../../hooks/useLaunchSites.js';
import { useSession } from '../../state/SessionContext.jsx';
import { filterByScope } from '../../rbac/scope.js';
import { getLaunchQueue } from '../../services/api/launchApprovalApi.js';
import LaunchReviewModal from './LaunchReviewModal.jsx';

// LaunchPage — BD-facing page for the post-NSO validation loop.
//
// Three tabs:
//   "NSO Sites"  — sites that finished Project and were handed to NSO/launch
//   "Review"     — (exec) sites you created that are at under_exec_review
//                  (supervisor) sites at under_supervisor_review
//   "Launched"   — sites that went live
//
// The admin drives the first/final touches from the business-admin portal; this
// page is where the creating executive and the supervisor record their verdicts.

const PROJECT_LABELS = { done: 'Project complete' };
const FINANCE_LABELS = {
  pending:            'Finance not started',
  awaiting_supervisor:'Finance · awaiting supervisor',
  awaiting_admin:     'Finance · awaiting admin',
  approved:           'Finance approved',
};

function inRange(iso, from, to) {
  if (!iso) return true;
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

// ── Review queue row ────────────────────────────────────────────────────────────
function ReviewRow({ item, onReview }) {
  const verdictPills = [];
  if (item.exec_verdict) verdictPills.push({ who: 'Exec', v: item.exec_verdict });
  if (item.supervisor_verdict) verdictPills.push({ who: 'Sup', v: item.supervisor_verdict });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.5fr 0.9fr 1.4fr auto', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'center' }}>
      <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{item.site_code || '—'}</span>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{item.site_name}</span>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{item.city}</span>
      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--zm-accent)', background: 'var(--zm-accent-soft)' }}>
          {item.status === 'under_supervisor_review' ? 'Supervisor stage' : 'Creator stage'}
        </span>
        {verdictPills.length === 0 && <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>Awaiting your review</span>}
        {verdictPills.map(({ who, v }) => {
          const color = v === 'approved' ? 'var(--zm-success)' : 'var(--zm-danger)';
          return (
            <span key={who} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
              {who} {v === 'approved' ? '✓' : '✕'}
            </span>
          );
        })}
      </span>
      <span>
        <button onClick={() => onReview(item)}
          style={{ height: 32, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-accent)', background: 'var(--zm-accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Review
        </button>
      </span>
    </div>
  );
}

export default function LaunchPage() {
  const { onOpenSite } = usePageContext();
  const { role, user } = useSession();
  const { rows: allRows, loading, error, refresh: refreshNso } = useLaunchSites();
  const [q, setQ] = React.useState('');
  const [range, setRange] = React.useState({ from: '', to: '' });
  const [tab, setTab] = React.useState('nso');

  const [approvalQueue, setApprovalQueue] = React.useState({ loading: true, items: [], error: null });
  const [review, setReview] = React.useState(null); // { siteId, role: 'exec' | 'supervisor' }

  const isExec = role === 'exec' || role === 'executive';
  const isSupervisor = role === 'supervisor';

  // Scope filter for exec view (NSO sites tab)
  const rows = isExec ? filterByScope(allRows, role, user) : allRows;
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

  const loadApprovals = React.useCallback(async () => {
    setApprovalQueue((s) => ({ ...s, loading: true }));
    try {
      const d = await getLaunchQueue();
      if (!cancelledRef.current) setApprovalQueue({ loading: false, items: d.items || [], error: null });
    } catch (e) {
      if (!cancelledRef.current) setApprovalQueue({ loading: false, items: [], error: e?.detail || e?.message || 'Failed to load' });
    }
  }, []);

  const cancelledRef = React.useRef(false);
  React.useEffect(() => {
    cancelledRef.current = false;
    loadApprovals();
    return () => { cancelledRef.current = true; };
  }, [loadApprovals]);

  // Stage 1 — sites I CREATED, awaiting my (creator) review. Role-agnostic: the
  // creator may be an executive OR a supervisor (supervisors can create via
  // delegation). Scoped reliably by submitted_by from the backend queue, not a
  // fragile join against the NSO list.
  const myId = String(user?.id || user?.userId || '');
  const creatorItems = approvalQueue.items.filter(
    (i) => i.status === 'under_exec_review' && String(i.submitted_by || '') === myId,
  );
  // Stage 2 — supervisor review (any supervisor in the tenant).
  const supervisorItems = isSupervisor
    ? approvalQueue.items.filter((i) => i.status === 'under_supervisor_review')
    : [];
  const reviewItems = [...creatorItems, ...supervisorItems];

  const launchedItems = approvalQueue.items.filter((i) => i.status === 'launched');

  const showReview = isExec || isSupervisor;
  const TABS = [
    { key: 'nso',       label: 'NSO Sites', count: rows.length },
    ...(showReview ? [{ key: 'review', label: 'Review', count: reviewItems.length }] : []),
    { key: 'launched',  label: 'Launched',  count: launchedItems.length },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="№ 10" eyebrow="BD module"
        title={<>Launch <em>sites</em></>}
        lede={`${rows.length} site${rows.length === 1 ? '' : 's'} handed to NSO`}
        right={<HeaderTag icon="flag" label={`${rows.length} IN LAUNCH`} />}
      />

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--zm-line)', paddingBottom: 0 }}>
        {TABS.map(({ key, label, count }) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '8px 16px', borderRadius: '8px 8px 0 0', border: '1px solid var(--zm-line)',
              borderBottom: tab === key ? '1px solid var(--zm-surface)' : '1px solid var(--zm-line)',
              background: tab === key ? 'var(--zm-surface)' : 'transparent',
              color: tab === key ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
              fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: tab === key ? 700 : 500,
              cursor: 'pointer', marginBottom: '-1px', position: 'relative' }}>
            {label}
            {count > 0 && (
              <span style={{ marginLeft: 6, background: key !== 'launched' ? 'var(--zm-accent)' : 'var(--zm-success)', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 10.5, fontWeight: 700 }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── NSO Sites tab ── */}
      {tab === 'nso' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', flex: '1 1 260px', maxWidth: 380, border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)' }}>
              <Icon name="search" size={14} style={{ color: 'var(--zm-fg-3)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, site, city…"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }} />
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>
              <Icon name="calendar" size={13} /> Last activity
            </span>
            <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              style={{ height: 36, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg)', outline: 'none' }} />
            <span style={{ color: 'var(--zm-fg-4)' }}>→</span>
            <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              style={{ height: 36, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg)', outline: 'none' }} />
            {dateActive && (
              <button onClick={() => setRange({ from: '', to: '' })}
                style={{ height: 36, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Clear</button>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={refreshNso}
              style={{ height: 36, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 8, background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="refresh" size={13} /> Refresh
            </button>
          </div>

          <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1.1fr 1.2fr 1.2fr', gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
              <span>Code</span><span>Site</span><span>City</span><span>Owner</span><span>Project</span><span>Finance</span>
            </div>
            {loading && <div style={{ padding: 42, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>Loading launch sites…</div>}
            {!loading && error && <div style={{ margin: 16, padding: 14, borderRadius: 10, border: '1px solid var(--zm-danger)', background: 'var(--zm-danger-soft)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>{error}</div>}
            {!loading && !error && filtered.map((site) => {
              const owner = site.createdBy?.name || site.createdBy || '—';
              return (
                <div key={site.id} data-site-id={site.id} className="zm-row" onClick={() => onOpenSite?.(site)}
                  style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1.1fr 1.2fr 1.2fr', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer', position: 'relative', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{site.code}</span>
                  <div>
                    <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{site.name}</span>
                    {site.isLaunched && (
                      <span style={{ marginLeft: 8, display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800, background: 'rgba(46,168,106,0.15)', color: 'var(--zm-success)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        🚀 Launched
                      </span>
                    )}
                  </div>
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{site.city}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={owner} size={20} />
                    <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{owner}</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, color: 'var(--zm-success)' }}>
                    <Icon name="check" size={12} /> {PROJECT_LABELS[site.projectStatus] || 'With NSO'}
                  </span>
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: site.financeStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-fg-2)', fontWeight: 600 }}>
                    {FINANCE_LABELS[site.financeStatus || 'pending'] || site.financeStatus}
                  </span>
                </div>
              );
            })}
            {!loading && !error && filtered.length === 0 && (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
                {rows.length === 0 ? 'No sites in launch yet.' : 'No sites match the current filter.'}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Review tab (exec / supervisor) ── */}
      {tab === 'review' && showReview && (
        <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)' }}>
            <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>
              Sites awaiting your review. <strong>Creator-stage</strong> rows (sites you created) are read-only — approve or reject the rent with a comment, and it flows to a supervisor. <strong>Supervisor-stage</strong> rows let you adjust the rent before approving / rejecting, and it flows to the admin's final confirm.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.5fr 0.9fr 1.4fr auto', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
            <span>Code</span><span>Site</span><span>City</span><span>Verdicts</span><span>Action</span>
          </div>

          {approvalQueue.loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>Loading…</div>}
          {approvalQueue.error && (
            <div style={{ margin: 16, padding: 14, borderRadius: 10, border: '1px solid var(--zm-danger)', background: 'var(--zm-danger-soft)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>{approvalQueue.error}</div>
          )}

          {!approvalQueue.loading && reviewItems.map((item) => (
            <ReviewRow key={item.site_id} item={item}
              onReview={(it) => setReview({ siteId: it.site_id, role: it.status === 'under_supervisor_review' ? 'supervisor' : 'exec' })} />
          ))}

          {!approvalQueue.loading && reviewItems.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
              Nothing awaiting your review.
            </div>
          )}
        </div>
      )}

      {/* ── Launched tab ── */}
      {tab === 'launched' && (
        <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.5fr 0.9fr 1fr', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
            <span>Code</span><span>Site</span><span>City</span><span>Launched On</span>
          </div>
          {approvalQueue.loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)', fontSize: 13 }}>Loading…</div>}
          {!approvalQueue.loading && launchedItems.map((item) => (
            <div key={item.site_id} style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.5fr 0.9fr 1fr', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{item.site_code || '—'}</span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {item.site_name}
                <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800, background: 'rgba(46,168,106,0.15)', color: 'var(--zm-success)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>🚀 Launched</span>
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{item.city}</span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                {item.launched_at ? new Date(item.launched_at).toLocaleDateString('en-IN') : '—'}
              </span>
            </div>
          ))}
          {!approvalQueue.loading && launchedItems.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
              No sites have been launched yet.
            </div>
          )}
        </div>
      )}

      {review && (
        <LaunchReviewModal
          siteId={review.siteId}
          role={review.role}
          onClose={() => setReview(null)}
          onDone={() => { loadApprovals(); refreshNso(); }}
        />
      )}
    </div>
  );
}
