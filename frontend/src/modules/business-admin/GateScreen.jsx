import React from 'react';
import { signInWithWorkspaceCode } from '../../services/api/supabaseAuth.js';
import { PRODUCT_NAME } from '../../router/routes.js';
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
    <div style={{ minHeight: '100vh', background: 'var(--zm-bg)', color: 'var(--zm-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <form onSubmit={submit} style={{ width: 420, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, padding: 28, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: 'var(--zm-shadow-3, 0 20px 50px rgba(36,23,15,0.18))' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>{PRODUCT_NAME} · Business admin</div>
          <h1 style={{ margin: '6px 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-display)' }}>Workspace controls</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--zm-fg-2)', lineHeight: 1.5 }}>Manage department codes and approve supervisors waiting in the queue.</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--zm-fg-2)', fontWeight: 600 }}>
          Email
          <input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--zm-line-strong)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg)', fontSize: 13, outline: 'none' }}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--zm-fg-2)', fontWeight: 600 }}>
          Workspace code
          <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ACME-7K2P" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--zm-line-strong)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg)', fontSize: 13, outline: 'none', fontFamily: 'var(--zm-font-mono)', letterSpacing: '0.05em' }}/>
        </label>
        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--zm-danger-soft)', color: 'var(--zm-danger)', fontSize: 12, border: '1px solid var(--zm-danger)' }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ height: 38, borderRadius: 8, border: 'none', background: 'var(--zm-cta-bg)', color: 'var(--zm-cta-fg)', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
