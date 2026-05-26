import React, { useCallback, useEffect, useState } from 'react';
import {
  getWorkspaceInfo,
  listPendingUsers,
  assignUserRole,
} from '../../services/api/adapters/httpAdapter.js';

// TeamPage — supervisor surface for managing their workspace.
//
// Shows:
//   1. The workspace code + seat usage (the code is what supervisors hand to
//      new employees so they can /join).
//   2. Pending users — anyone who joined via the workspace code but doesn't
//      yet have a role assigned. The supervisor picks a role + city, and the
//      backend (a) writes Supabase app_metadata so the user's next JWT works,
//      (b) activates the public.users row, and (c) returns an invite link.

const ROLE_OPTIONS = [
  { value: 'executive',      label: 'BD executive' },
];

export default function TeamPage() {
  const [info, setInfo]               = useState(null);
  const [pending, setPending]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [copyState, setCopyState]     = useState({ what: null, at: 0 });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, p] = await Promise.all([getWorkspaceInfo(), listPendingUsers()]);
      setInfo(i);
      setPending(p);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const copyToClipboard = (text, what) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopyState({ what, at: Date.now() });
      setTimeout(() => setCopyState((s) => (s.what === what ? { what: null, at: 0 } : s)), 1800);
    });
  };

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'var(--zm-font-display, var(--zm-font-body))', fontSize: 24, fontWeight: 700, color: 'var(--zm-fg)' }}>
            Team
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--zm-fg-3)' }}>
            Share your workspace code so people can join, then assign each joiner a role.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--zm-line)',
            background: 'var(--zm-surface)',
            color: 'var(--zm-fg)',
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div style={{
          padding: 12,
          borderRadius: 10,
          border: '1px solid rgba(222, 117, 111, 0.4)',
          background: 'rgba(222, 117, 111, 0.08)',
          color: '#c25950',
          fontSize: 13,
        }}>
          Could not load team data: {error}
        </div>
      )}

      {/* Workspace card */}
      <section style={{
        padding: 18,
        borderRadius: 14,
        border: '1px solid var(--zm-line)',
        background: 'var(--zm-surface)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
      }}>
        <Stat label="Workspace">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--zm-font-mono, monospace)', fontSize: 14, fontWeight: 600 }}>
              {info?.name || (loading ? '…' : '—')}
            </span>
            {info?.plan && (
              <span style={{ padding: '2px 6px', borderRadius: 6, fontSize: 10, background: 'var(--zm-surface-2)', color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {info.plan}
              </span>
            )}
          </div>
        </Stat>
        <Stat label="Workspace code">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{
              fontFamily: 'var(--zm-font-mono, monospace)',
              fontSize: 14,
              fontWeight: 700,
              padding: '4px 8px',
              borderRadius: 6,
              background: 'var(--zm-accent-soft, rgba(70, 234, 209, 0.1))',
              color: 'var(--zm-accent, #0e7f78)',
              letterSpacing: '0.08em',
            }}>
              {info?.workspaceCode || (loading ? '…' : '—')}
            </code>
            {info?.workspaceCode && (
              <button
                type="button"
                onClick={() => copyToClipboard(info.workspaceCode, 'code')}
                style={btnGhost(12)}
              >
                {copyState.what === 'code' ? 'Copied ✓' : 'Copy'}
              </button>
            )}
          </div>
        </Stat>
        <Stat label="Seats used">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <strong style={{ fontSize: 22 }}>{info?.usedSeats ?? '—'}</strong>
            <span style={{ color: 'var(--zm-fg-3)', fontSize: 13 }}>/ {info?.seatLimit ?? '—'}</span>
          </div>
        </Stat>
        <Stat label="Pending assignments">
          <strong style={{ fontSize: 22, color: (info?.pendingSeats || 0) > 0 ? 'var(--zm-warning, #B0712E)' : 'var(--zm-fg-3)' }}>
            {info?.pendingSeats ?? '—'}
          </strong>
        </Stat>
      </section>

      {/* Pending users table */}
      <section style={{
        borderRadius: 14,
        border: '1px solid var(--zm-line)',
        background: 'var(--zm-surface)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--zm-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--zm-fg)' }}>
            Pending users <span style={{ color: 'var(--zm-fg-3)', fontWeight: 500 }}>· {pending.length}</span>
          </h2>
        </div>
        {pending.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)', fontSize: 13 }}>
            {loading ? 'Loading…' : 'No pending users. Share your workspace code to invite people.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--zm-surface-2)', color: 'var(--zm-fg-3)', textAlign: 'left' }}>
                <Th>Email</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
                <Th style={{ textAlign: 'right' }}>Action</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--zm-line)' }}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{u.email}</div>
                    <div style={{ color: 'var(--zm-fg-3)', fontSize: 11 }}>{u.name}</div>
                  </Td>
                  <Td style={{ color: 'var(--zm-fg-3)' }}>{formatDate(u.createdAt)}</Td>
                  <Td>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(217, 119, 6, 0.12)', color: '#a86204', fontWeight: 600 }}>
                      awaiting role
                    </span>
                  </Td>
                  <Td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => setEditingUser(u)}
                      style={btnPrimary(12)}
                    >
                      Assign role
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editingUser && (
        <AssignRoleDrawer
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onAssigned={async () => {
            setEditingUser(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function AssignRoleDrawer({ user, onClose, onAssigned }) {
  const [role, setRole]   = useState(ROLE_OPTIONS[0].value);
  const [city, setCity]   = useState('Mumbai');
  const [name, setName]   = useState(user.name || user.email.split('@')[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await assignUserRole(user.id, { role, city, name });
      setResult(r);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', justifyContent: 'flex-end',
      background: 'rgba(7, 12, 14, 0.55)', backdropFilter: 'blur(4px)',
    }}
    onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 92vw)',
          height: '100%',
          background: 'var(--zm-surface)',
          borderLeft: '1px solid var(--zm-line)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
              Assign role
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{user.email}</div>
          </div>
          <button onClick={onClose} type="button" style={btnGhost(13)}>Close</button>
        </header>

        {result ? (
          <>
            <div style={{
              padding: 14,
              borderRadius: 10,
              border: '1px solid rgba(70, 234, 209, 0.32)',
              background: 'rgba(70, 234, 209, 0.08)',
              color: 'var(--zm-fg)',
              fontSize: 13,
            }}>
              {result.message}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--zm-fg-3)' }}>
              Tell {user.email} they can sign in from the landing page using their email and your workspace code.
            </p>
            <button onClick={onAssigned} type="button" style={btnPrimary(13)}>Done</button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={lbl}>Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={input}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p style={hint}>
                BD executives capture sites and own the day-to-day pipeline work.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={lbl}>City</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Mumbai"
                style={input}
              />
              <p style={hint}>Scopes the user's pipeline visibility.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={lbl}>Display name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={input}
              />
            </div>

            {error && (
              <div style={{
                padding: 10, borderRadius: 8,
                border: '1px solid rgba(222, 117, 111, 0.4)',
                background: 'rgba(222, 117, 111, 0.08)',
                color: '#c25950', fontSize: 12,
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !city.trim()}
                style={{ ...btnPrimary(13), flex: 1 }}
              >
                {submitting ? 'Assigning…' : 'Confirm role'}
              </button>
              <button type="button" onClick={onClose} style={btnGhost(13)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
function Th({ children, style }) {
  return <th style={{ padding: '10px 16px', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', ...style }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: '12px 16px', verticalAlign: 'middle', ...style }}>{children}</td>;
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

const lbl   = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' };
const hint  = { margin: 0, fontSize: 11, color: 'var(--zm-fg-3)' };
const input = { padding: '9px 11px', borderRadius: 9, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontSize: 13 };
const btnPrimary = (fs = 12) => ({
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--zm-accent, #0e7f78)',
  color: '#fff',
  fontSize: fs,
  fontWeight: 700,
  cursor: 'pointer',
});
const btnGhost = (fs = 12) => ({
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--zm-line)',
  background: 'transparent',
  color: 'var(--zm-fg)',
  fontSize: fs,
  fontWeight: 600,
  cursor: 'pointer',
});
