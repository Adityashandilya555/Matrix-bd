import React from 'react';
import { signInWithWorkspaceCode } from '../../services/api/supabaseAuth.js';
import { PRODUCT_NAME } from '../../constants/brand.js';
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
    <div style={{ minHeight: '100vh', background: '#0B0C10', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <form onSubmit={submit} style={{ width: 420, background: '#13141B', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, padding: 28, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>{PRODUCT_NAME} · Business admin</div>
          <h1 style={{ margin: '6px 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: '#fff' }}>Workspace controls</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5 }}>Manage department codes and approve supervisors waiting in the queue.</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
          Email
          <input type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 13, outline: 'none' }}/>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
          Workspace code
          <input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ACME-7K2P" style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.05em' }}/>
        </label>
        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.22)', color: '#FCA5A5', fontSize: 12, border: '1px solid rgba(220,38,38,0.35)' }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ height: 38, borderRadius: 8, border: 'none', background: '#fff', color: '#0B0C10', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
