import React from 'react';
import { T, Icon, Card, Button, Skeleton, EmptyState, ErrorState, TABULAR } from './ui/kit.jsx';

// Presentational. The shell owns fetching and passes:
//   data = { status, items, error }   — items: [{ id, email, module, createdAt }]
//   onApprove(user) -> Promise        — user.module is required by the API
//   onReject(user)  -> Promise
//
// Payment + Recce omitted — Recce is part of Design, Payment isn't dept-onboarded.
const FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'bd',      label: 'BD' },
  { key: 'legal',   label: 'Legal' },
  { key: 'design',  label: 'Design' },
  { key: 'project', label: 'Project' },
];

export default function PendingSupervisorsList({ data, onApprove, onReject, onRetry }) {
  const [filter, setFilter] = React.useState('all');
  const [busyUserId, setBusyUserId] = React.useState(null);
  const [error, setError] = React.useState(null);

  const items = data.items || [];
  const counts = React.useMemo(() => {
    const c = { all: items.length };
    for (const u of items) c[u.module] = (c[u.module] || 0) + 1;
    return c;
  }, [items]);

  const visible = filter === 'all' ? items : items.filter((u) => u.module === filter);

  async function act(fn, user) {
    setBusyUserId(user.id);
    setError(null);
    try { await fn(user); }
    catch (err) { setError(err?.detail || err?.message || 'Action failed'); }
    finally { setBusyUserId(null); }
  }

  if (data.status === 'error') return <ErrorState message={data.error} onRetry={onRetry} />;
  const loading = data.status === 'loading';

  return (
    <div>
      <div role="tablist" style={{ display: 'inline-flex', gap: 4, padding: 4, marginBottom: 16,
        background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.line}`, borderRadius: T.radiusPill, flexWrap: 'wrap' }}>
        {FILTERS.map(({ key, label }) => {
          const isActive = filter === key;
          const n = counts[key] || 0;
          return (
            <button key={key} role="tab" aria-selected={isActive} onClick={() => setFilter(key)}
              className={`ac-tab${isActive ? ' is-active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 13px',
                borderRadius: T.radiusPill, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 650,
                background: isActive ? '#F4F5F7' : 'transparent', color: isActive ? '#0B0C10' : T.textMuted }}>
              {label}
              <span style={{ minWidth: 17, height: 17, padding: '0 5px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...TABULAR,
                background: isActive ? 'rgba(11,12,16,0.12)' : 'rgba(255,255,255,0.08)',
                color: isActive ? '#0B0C10' : T.textFaint }}>{n}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: T.radiusSm, background: T.dangerSoft,
          color: T.dangerText, marginBottom: 14, fontSize: 12.5, border: '1px solid rgba(192,65,63,0.35)' }}>{error}</div>
      )}

      {loading && (
        <Card style={{ overflow: 'hidden' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px',
              borderTop: i === 0 ? 'none' : `1px solid ${T.line}` }}>
              <Skeleton w={200} h={13} /><span style={{ flex: 1 }} /><Skeleton w={72} h={28} r={8} /><Skeleton w={84} h={28} r={8} />
            </div>
          ))}
        </Card>
      )}

      {!loading && visible.length === 0 && (
        <EmptyState icon={Icon.users}
          title={filter === 'all' ? 'No supervisors awaiting approval' : `No pending ${filter.toUpperCase()} supervisors`}
          hint="New sign-ups using a valid department code will appear here for review." />
      )}

      {!loading && visible.length > 0 && (
        <Card raised className="ac-stagger" style={{ overflow: 'hidden' }}>
          {visible.map((u, i) => {
            const isBusy = busyUserId === u.id;
            return (
              <div key={u.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) auto minmax(0,1fr) auto',
                gap: 14, padding: '14px 18px', borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
                alignItems: 'center', opacity: isBusy ? 0.6 : 1 }}>
                <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.text, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: T.textMuted, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${T.line}`, justifySelf: 'start' }}>{u.module}</span>
                <span style={{ fontSize: 11.5, color: T.textFaint, fontFamily: T.mono, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</span>
                <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => act(onReject, u)}>Reject</Button>
                  <Button variant="solid" size="sm" loading={isBusy} icon={!isBusy && <Icon.check size={14} />}
                    onClick={() => act(onApprove, u)}>Approve</Button>
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
