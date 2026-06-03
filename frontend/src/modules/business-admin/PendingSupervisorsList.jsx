import React from 'react';
import { listPendingSupervisors, approveSupervisor, rejectSupervisor } from '../../services/api/adapters/httpAdapter.js';

// Recce is part of Design, not a standalone department.
const FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'bd',      label: 'BD' },
  { key: 'legal',   label: 'Legal' },
  { key: 'payment', label: 'Finance / CA' },
  { key: 'design',  label: 'Design' },
  { key: 'project', label: 'Project' },
];

export default function PendingSupervisorsList() {
  const [filter, setFilter] = React.useState('all');
  const [items, setItems] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busyUserId, setBusyUserId] = React.useState(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const moduleParam = filter === 'all' ? undefined : filter;
      const data = await listPendingSupervisors(moduleParam);
      setItems(data);
    } catch (err) {
      setError(err.message || 'Failed to load pending supervisors');
      setItems([]);
    }
  }, [filter]);

  React.useEffect(() => { setItems(null); load(); }, [load]);

  async function onApprove(user) {
    setBusyUserId(user.id);
    setError(null);
    try {
      await approveSupervisor(user.id, user.module);
      await load();
    } catch (err) {
      setError(err.message || 'Approve failed');
    } finally {
      setBusyUserId(null);
    }
  }

  async function onReject(user) {
    setBusyUserId(user.id);
    setError(null);
    try {
      await rejectSupervisor(user.id);
      await load();
    } catch (err) {
      setError(err.message || 'Reject failed');
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, marginBottom: 14 }}>
        {FILTERS.map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)} style={{ height: 28, padding: '0 14px', borderRadius: 999, border: 'none', background: filter === key ? '#fff' : 'transparent', color: filter === key ? '#0B0C10' : 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {error && <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.22)', color: '#FCA5A5', marginBottom: 14, fontSize: 13, border: '1px solid rgba(220,38,38,0.35)' }}>{error}</div>}

      {items === null && !error && <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Loading…</div>}

      {items && items.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 14, color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
          No pending supervisors{filter === 'all' ? '' : ` for ${filter}`}.
        </div>
      )}

      {items && items.length > 0 && (
        <div style={{ borderRadius: 12, overflow: 'hidden', background: '#13141B', border: '1px solid rgba(255,255,255,0.12)' }}>
          {items.map((u, i) => {
            const isBusy = busyUserId === u.id;
            return (
              <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.7fr 1fr 200px', gap: 12, padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)', alignItems: 'center', fontSize: 13 }}>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, color: '#fff' }}>{u.email}</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>{u.module}</span>
                <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</span>
                <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => onReject(u)} disabled={isBusy} style={{ height: 30, padding: '0 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: isBusy ? 'wait' : 'pointer' }}>Reject</button>
                  <button onClick={() => onApprove(u)} disabled={isBusy} style={{ height: 30, padding: '0 14px', borderRadius: 7, border: 'none', background: '#fff', color: '#0B0C10', fontSize: 12, fontWeight: 700, cursor: isBusy ? 'wait' : 'pointer' }}>{isBusy ? 'Working…' : 'Approve'}</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
