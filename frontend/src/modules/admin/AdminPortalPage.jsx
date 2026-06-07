import React from 'react';

// Platform admin portal — the ONLY tenant-less page in the app. Lives outside
// the workspace auth flow because the people approving workspace requests are
// not part of any tenant yet (they are us, the platform operators).
//
// Auth model: a permanent email + password pair lives in backend env
// (PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD, defaults work out of the
// box). The gate POSTs them to /tenancy/admin/login which echoes back the
// X-Platform-Admin-Key value the SPA must send on every subsequent request.
// We stash that token in sessionStorage so a refresh doesn't kick the admin
// back to the gate, but it dies with the tab so we never persist it across
// browser restarts.

const SESSION_KEY = 'matrix.admin.platformKey';

function readKey() {
  try { return sessionStorage.getItem(SESSION_KEY) || ''; }
  catch { return ''; }
}

function writeKey(k) {
  try {
    if (k) sessionStorage.setItem(SESSION_KEY, k);
    else   sessionStorage.removeItem(SESSION_KEY);
  } catch {/* private browsing — keep the key in memory only */}
}

const apiBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL)
  || 'http://localhost:8000/api';

async function apiFetch(path, { key, method = 'GET', body } = {}) {
  const r = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Platform-Admin-Key': key || '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { detail: text }; }
  if (!r.ok) {
    const detail = parsed?.detail || `Request failed (${r.status})`;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = r.status;
    throw err;
  }
  return parsed;
}

function GateScreen({ onUnlock }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Enter your admin email and password.'); return; }
    setBusy(true); setError(null);
    try {
      // The login endpoint validates the credentials and hands back the
      // X-Platform-Admin-Key the SPA must use on every subsequent call.
      const res = await fetch(`${apiBase}/tenancy/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const text = await res.text();
      let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { detail: text }; }
      if (!res.ok) {
        const detail = parsed?.detail || `Login failed (${res.status})`;
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      }
      const token = parsed?.token;
      if (!token) throw new Error('Login response missing token.');
      writeKey(token);
      onUnlock(token);
    } catch (err) {
      setError(err.message || 'Auth failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0B0C10', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <form onSubmit={submit} style={{ width: 420, background: '#13141B', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, padding: 28, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>Scale · Platform admin</div>
          <h1 style={{ margin: '6px 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: '#fff' }}>Approval queue</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5 }}>This portal lets you approve workspace requests and provision tenants. It is not part of any workspace — sign in with the platform admin credentials.</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
          Email
          <input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@scale.bluetokai.com" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 13, outline: 'none' }}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 13, outline: 'none' }}/>
        </label>
        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.22)', color: '#FCA5A5', fontSize: 12, border: '1px solid rgba(220,38,38,0.35)' }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ height: 38, borderRadius: 8, border: 'none', background: '#fff', color: '#0B0C10', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function ApproveDialog({ request, busy, onCancel, onConfirm }) {
  // Supervisors see every site in the workspace — they're not city-scoped at
  // the permission layer. The "primary city" field below is purely metadata
  // for outbound emails / Slack templates, and is fully optional.
  const [city, setCity] = React.useState('');
  const [adminName, setAdminName] = React.useState(request?.admin_email?.split('@')[0] || '');
  if (!request) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 480, background: '#13141B', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 24, color: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.55 }}>Approve · {request.company}</div>
          <h2 style={{ margin: '4px 0 2px', fontSize: 19, fontWeight: 700 }}>Provision workspace</h2>
          <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7, lineHeight: 1.5 }}>Creates the tenant, the supervisor user, and the workspace code. The supervisor sees every site across all cities. An email is queued in the outbox to {request.admin_email}.</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, opacity: 0.85 }}>
          Primary city (optional)
          <input autoFocus value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Mumbai — used only as label metadata" style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 13, outline: 'none' }}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, opacity: 0.85 }}>
          Admin display name (optional)
          <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Defaults to the email prefix" style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 13, outline: 'none' }}/>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onCancel} disabled={busy} style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>Cancel</button>
          <button onClick={() => onConfirm({ city: city.trim() || null, admin_name: adminName.trim() || null })} disabled={busy} style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none', background: '#fff', color: '#0B0C10', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Provisioning…' : 'Approve & provision'}</button>
        </div>
      </div>
    </div>
  );
}

function CredentialsDialog({ result, onClose }) {
  if (!result) return null;
  const copy = (s) => { try { navigator.clipboard?.writeText(s); } catch {/* noop */} };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 520, background: '#13141B', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: 24, color: '#fff', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#86EFAC' }}>Provisioned ✓</div>
          <h2 style={{ margin: '4px 0 2px', fontSize: 19, fontWeight: 700 }}>Share these with the supervisor</h2>
          <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7, lineHeight: 1.5 }}>An email has also been queued in the outbox. This is the only time the workspace code is shown here.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 70px', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>Tenant ID</span>
          <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', fontSize: 12, overflowWrap: 'anywhere' }}>{result.tenant_id}</code>
          <button onClick={() => copy(result.tenant_id)} style={{ height: 28, borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#fff', fontSize: 11.5, cursor: 'pointer' }}>Copy</button>

          <span style={{ opacity: 0.6, fontSize: 12 }}>Workspace code</span>
          <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '6px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.08)', fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>{result.workspace_code}</code>
          <button onClick={() => copy(result.workspace_code)} style={{ height: 28, borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#fff', fontSize: 11.5, cursor: 'pointer' }}>Copy</button>

          <span style={{ opacity: 0.6, fontSize: 12 }}>Seat limit</span>
          <span style={{ fontSize: 13 }}>{result.seat_limit}</span>
          <span/>
        </div>
        <p style={{ margin: 0, padding: '10px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.10)', color: '#86EFAC', fontSize: 12, lineHeight: 1.5 }}>{result.message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none', background: '#fff', color: '#0B0C10', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

function statusPill(s) {
  const palette = {
    pending:  { bg: 'rgba(217,119,6,0.18)',  fg: '#FCD34D' },
    approved: { bg: 'rgba(34,197,94,0.18)',  fg: '#86EFAC' },
    rejected: { bg: 'rgba(220,38,38,0.18)',  fg: '#FCA5A5' },
  }[s] || { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.7)' };
  return (
    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', ...palette, background: palette.bg, color: palette.fg }}>{s}</span>
  );
}

function PortalScreen({ keyValue, onLogout }) {
  const [statusFilter, setStatusFilter] = React.useState('pending');
  const [items, setItems] = React.useState(null); // null = loading
  const [error, setError] = React.useState(null);
  const [approving, setApproving] = React.useState(null);
  const [approveBusy, setApproveBusy] = React.useState(false);
  const [credResult, setCredResult] = React.useState(null);
  const [rejectingId, setRejectingId] = React.useState(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch(`/tenancy/requests?status_filter=${encodeURIComponent(statusFilter)}&limit=200`, { key: keyValue });
      setItems(data?.items || []);
    } catch (err) {
      setError(err.message || 'Failed to load');
      if (err.status === 401) {
        writeKey('');
        onLogout();
      }
    }
  }, [keyValue, statusFilter, onLogout]);

  React.useEffect(() => { setItems(null); load(); }, [load]);

  async function onApprove({ city, admin_name }) {
    if (!approving) return;
    setApproveBusy(true);
    try {
      const result = await apiFetch(`/tenancy/requests/${approving.id}/approve`, {
        key: keyValue, method: 'POST', body: { city, admin_name },
      });
      setApproving(null);
      setCredResult(result);
      load();
    } catch (err) {
      setError(err.message || 'Approve failed');
    } finally {
      setApproveBusy(false);
    }
  }

  async function onReject(r) {
    if (typeof window !== 'undefined'
      && !window.confirm(`Reject the workspace request from "${r.company}"? No tenant is provisioned and this can't be undone.`)) {
      return;
    }
    setRejectingId(r.id);
    setError(null);
    try {
      await apiFetch(`/tenancy/requests/${r.id}/reject`, { key: keyValue, method: 'POST' });
      load();
    } catch (err) {
      setError(err.message || 'Reject failed');
    } finally {
      setRejectingId(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', maxHeight: '100vh', overflowY: 'auto', background: '#0B0C10', color: '#fff', padding: '32px 40px' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.78)' }}>Scale · Platform admin</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>Workspace approval queue</h1>
        </div>
        <span style={{ flex: 1 }}/>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999 }}>
          {['pending', 'approved', 'all'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ height: 30, padding: '0 14px', borderRadius: 999, border: 'none', background: statusFilter === s ? '#fff' : 'transparent', color: statusFilter === s ? '#0B0C10' : 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700, textTransform: 'capitalize', cursor: 'pointer' }}>{s}</button>
          ))}
        </div>
        <button onClick={load} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Refresh</button>
        <button onClick={() => { writeKey(''); onLogout(); }} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Sign out</button>
      </header>

      {error && <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.18)', color: '#FCA5A5', marginBottom: 20, fontSize: 13 }}>{error}</div>}

      {items === null && !error && <div style={{ opacity: 0.6, fontSize: 13 }}>Loading…</div>}

      {items && items.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 14, color: 'rgba(255,255,255,0.55)' }}>
          No {statusFilter === 'all' ? '' : statusFilter} requests right now.
        </div>
      )}

      {items && items.length > 0 && (
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 0.9fr 0.6fr 110px 1fr 180px', gap: 10, padding: '12px 18px', background: 'rgba(255,255,255,0.04)', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>
            <span>Company</span><span>Admin email</span><span>Team size</span><span>Seats</span><span>Status</span><span>Created</span><span style={{ textAlign: 'right' }}>Action</span>
          </div>
          {items.map((r, i) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 0.9fr 0.6fr 110px 1fr 180px', gap: 10, padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)', alignItems: 'center', fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{r.company}</span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>{r.admin_email}</span>
              <span style={{ opacity: 0.75, fontSize: 12 }}>{r.team_size || '—'}</span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{r.seat_limit}</span>
              <span>{statusPill(r.status)}</span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</span>
              <span style={{ textAlign: 'right' }}>
                {r.status === 'pending'
                  ? <span style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => onReject(r)} disabled={rejectingId === r.id}
                        style={{ height: 30, padding: '0 12px', borderRadius: 7, border: '1px solid rgba(252,165,165,0.4)', background: 'transparent', color: '#FCA5A5', fontSize: 12, fontWeight: 700, cursor: rejectingId === r.id ? 'wait' : 'pointer', opacity: rejectingId === r.id ? 0.6 : 1 }}>
                        {rejectingId === r.id ? '…' : 'Reject'}
                      </button>
                      <button onClick={() => setApproving(r)}
                        style={{ height: 30, padding: '0 14px', borderRadius: 7, border: 'none', background: '#fff', color: '#0B0C10', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Approve</button>
                    </span>
                  : <span style={{ opacity: 0.45, fontSize: 11.5 }}>{r.decided_at ? new Date(r.decided_at).toLocaleDateString() : ''}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {approving && <ApproveDialog request={approving} busy={approveBusy} onCancel={() => setApproving(null)} onConfirm={onApprove}/>}
      {credResult && <CredentialsDialog result={credResult} onClose={() => setCredResult(null)}/>}
    </div>
  );
}

export default function AdminPortalPage() {
  const [keyValue, setKeyValue] = React.useState(() => readKey());
  if (!keyValue) return <GateScreen onUnlock={setKeyValue}/>;
  return <PortalScreen keyValue={keyValue} onLogout={() => setKeyValue('')}/>;
}
