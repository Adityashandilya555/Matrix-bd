import React from 'react';
import { signInWithWorkspaceCode } from '../../services/api/supabaseAuth.js';
import { getAuthToken, clearAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from './jwt.js';

export default function GateScreen({ onAuth }) {
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !code.trim()) {
      setError('Enter your email and workspace code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithWorkspaceCode(email.trim(), code.trim());
      const token = getAuthToken();
      if (decodeJwtPayload(token).role !== 'business_admin') {
        clearAuthToken();
        setError('This portal is for business admins only.');
        return;
      }
      onAuth(token);
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--zm-bg, #0B0C10)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={submit} className="zm-glass" style={{ width: 420, borderRadius: 14, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', opacity: 0.55 }}>Matrix · Business admin</div>
          <h1 style={{ margin: '6px 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Workspace controls</h1>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>Manage department codes and approve supervisors waiting in the queue.</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, opacity: 0.85 }}>
          Email
          <input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 13, outline: 'none' }}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, opacity: 0.85 }}>
          Workspace code
          <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ACME-7K2P" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.05em' }}/>
        </label>
        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.15)', color: '#FCA5A5', fontSize: 12 }}>{error}</div>}
        <button type="submit" disabled={busy} className="zm-btn zm-btn-primary" style={{ height: 38, borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
