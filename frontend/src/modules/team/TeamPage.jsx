import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../../state/SessionContext.jsx';
import {
  getMyInviteCode,
  rotateMyInviteCode,
  listMyPendingExecutives,
  approveMyPendingExecutive,
  rejectMyPendingExecutive,
  listMyTeam,
} from '../../services/api/adapters/httpAdapter.js';

// TeamPage — supervisor surface for the per-supervisor invite-code flow.
//
// Sections (supervisor role):
//   1. My invite code for {module}            (mono code + rotate)
//   2. Pending executives waiting for approval (per-row Approve/Reject)
//   3. My active team                          (executives mapped to me)
//
// Executives see a read-only confirmation card. Business admins are redirected
// to the dedicated business-admin surface — this page is for the people who
// actually run a team.

const DEFAULT_MODULE = 'bd';

function normalizeRole(role) {
  if (role === 'exec') return 'executive';
  return role;
}

export default function TeamPage() {
  const { session, role: rawRole } = useSession();
  const role = normalizeRole(rawRole);
  const module = session?.module || DEFAULT_MODULE;

  if (role === 'business_admin') {
    return <Navigate to="/business-admin" replace/>;
  }

  if (role === 'executive') {
    return <ExecutiveView session={session}/>;
  }

  return <SupervisorView module={module}/>;
}

function SupervisorView({ module }) {
  const [invite, setInvite] = useState(null);
  const [pending, setPending] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rotating, setRotating] = useState(false);
  const [actingOn, setActingOn] = useState(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [code, pend, mine] = await Promise.all([
        getMyInviteCode(module).catch(() => null),
        listMyPendingExecutives(module).catch(() => []),
        listMyTeam(module).catch(() => []),
      ]);
      setInvite(code);
      setPending(pend);
      setTeam(mine);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => { refresh(); }, [refresh]);

  const rotate = async () => {
    setRotating(true);
    try {
      const next = await rotateMyInviteCode(module);
      setInvite(next);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setRotating(false);
    }
  };

  const copyCode = () => {
    if (!invite?.code) return;
    navigator.clipboard.writeText(invite.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const approve = async (userId) => {
    setActingOn(userId);
    try {
      await approveMyPendingExecutive(userId, module);
      // Refresh repopulates both the pending list and the active team in one
      // round-trip so the approved exec shows up under "My active team".
      await refresh();
    } catch (e) {
      setError(e?.message || String(e));
      setActingOn(null);
      return;
    }
    setActingOn(null);
  };

  const reject = async (userId) => {
    setActingOn(userId);
    try {
      await rejectMyPendingExecutive(userId);
      setPending(prev => prev.filter(u => u.id !== userId));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActingOn(null);
    }
  };

  return (
    <div style={page}>
      <header style={pageHeader}>
        <div>
          <h1 style={h1}>Team</h1>
          <p style={subtle}>
            Share your invite code so executives can /join your team, then approve them as they sign up.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="zm-btn" style={btnGhost(loading ? 'wait' : 'pointer')}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <ErrorBanner message={error}/>}

      <Section title={`My invite code for ${module}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <code style={codeChip}>{invite?.code || (loading ? '…' : '— no code yet —')}</code>
          {invite?.code && (
            <button type="button" onClick={copyCode} className="zm-btn" style={btnGhost('pointer')}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          )}
          <button type="button" onClick={rotate} disabled={rotating} className="zm-btn-primary" style={btnPrimary(rotating ? 'wait' : 'pointer')}>
            {rotating ? 'Rotating…' : invite?.code ? 'Rotate' : 'Generate'}
          </button>
          {invite?.rotatedAt && (
            <span style={metaText}>Last rotated {formatDate(invite.rotatedAt)}</span>
          )}
        </div>
      </Section>

      <Section
        title="Pending executives waiting for my approval"
        rightMeta={<span style={countPill}>{pending.length}</span>}
      >
        {pending.length === 0 ? (
          <Empty>
            {loading ? 'Loading…' : 'No pending executives. Share your invite code above.'}
          </Empty>
        ) : (
          <ul style={list}>
            {pending.map(u => (
              <li key={u.id} style={row}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{u.email}</span>
                  <span style={metaText}>Joined {formatDate(u.createdAt)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => approve(u.id)}
                    disabled={actingOn === u.id}
                    className="zm-btn-primary"
                    style={btnPrimary(actingOn === u.id ? 'wait' : 'pointer')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(u.id)}
                    disabled={actingOn === u.id}
                    className="zm-btn"
                    style={btnGhost(actingOn === u.id ? 'wait' : 'pointer')}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="My active team"
        rightMeta={<span style={countPill}>{team.length}</span>}
      >
        {team.length === 0 ? (
          <Empty>
            {loading ? 'Loading…' : 'No executives on your team yet.'}
          </Empty>
        ) : (
          <ul style={list}>
            {team.map(u => (
              <li key={u.id} style={row}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{u.name || u.email}</span>
                  <span style={metaText}>{u.email}{u.assignedCity ? ` · ${u.assignedCity}` : ''}</span>
                </div>
                <span style={badge}>executive</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ExecutiveView({ session }) {
  const supervisorName = session?.supervisorName || 'your supervisor';
  return (
    <div style={page}>
      <header style={pageHeader}>
        <div>
          <h1 style={h1}>Team</h1>
          <p style={subtle}>Your team membership at a glance.</p>
        </div>
      </header>
      <Section title="You are an executive">
        <p style={{ margin: 0, fontSize: 14, color: 'var(--zm-fg-2)' }}>
          You are an executive on <strong>{supervisorName}</strong>'s team.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, rightMeta, children }) {
  return (
    <section className="zm-glass" style={sectionBox}>
      <div style={sectionHead}>
        <h2 style={h2}>{title}</h2>
        {rightMeta}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return <div style={emptyBox}>{children}</div>;
}

function ErrorBanner({ message }) {
  return (
    <div style={errorBox}>
      Could not load team data: {message}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

// ── Styles ─────────────────────────────────────────────────────────────────

const page = { padding: '20px 24px', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 };
const pageHeader = { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' };
const h1 = { margin: 0, fontFamily: 'var(--zm-font-display, var(--zm-font-body))', fontSize: 24, fontWeight: 700, color: 'var(--zm-fg)' };
const h2 = { margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' };
const subtle = { margin: '4px 0 0', fontSize: 13, color: 'var(--zm-fg-3)' };
const metaText = { fontSize: 11, color: 'var(--zm-fg-3)' };
const sectionBox = { borderRadius: 14, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', overflow: 'hidden' };
const sectionHead = { padding: '14px 18px', borderBottom: '1px solid var(--zm-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const list = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)' };
const emptyBox = { padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)', fontSize: 13, border: '1px dashed var(--zm-line)', borderRadius: 10 };
const errorBox = { padding: 12, borderRadius: 10, border: '1px solid rgba(222, 117, 111, 0.4)', background: 'rgba(222, 117, 111, 0.08)', color: '#c25950', fontSize: 13 };
const codeChip = { fontFamily: 'var(--zm-font-mono, monospace)', fontSize: 18, fontWeight: 700, padding: '6px 12px', borderRadius: 8, background: 'var(--zm-accent-soft, rgba(70, 234, 209, 0.1))', color: 'var(--zm-accent, #0e7f78)', letterSpacing: '0.1em' };
const countPill = { padding: '2px 8px', borderRadius: 999, background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-mono, monospace)', fontSize: 11, color: 'var(--zm-fg-3)', fontWeight: 600 };
const badge = { padding: '2px 8px', borderRadius: 6, fontSize: 10, background: 'var(--zm-surface-2)', color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 };
const btnPrimary = (cursor) => ({ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--zm-accent, #0e7f78)', color: '#fff', fontSize: 12, fontWeight: 700, cursor });
const btnGhost   = (cursor) => ({ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontSize: 12, fontWeight: 600, cursor });
