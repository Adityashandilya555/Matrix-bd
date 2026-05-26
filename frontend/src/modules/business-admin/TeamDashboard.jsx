import React from 'react';
import { getAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from './jwt.js';
import DeptCodeManager from './DeptCodeManager.jsx';
import PendingSupervisorsList from './PendingSupervisorsList.jsx';

export default function TeamDashboard({ onLogout }) {
  const payload = decodeJwtPayload(getAuthToken());
  const company = payload.workspace_name || payload.tenant_name || payload.company || '';

  return (
    <div style={{ minHeight: '100vh', background: '#0B0C10', color: '#fff', padding: '32px 40px' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', opacity: 0.55 }}>Matrix · Business admin</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{company || 'Workspace'}</h1>
        </div>
        <span style={{ flex: 1 }}/>
        <button onClick={onLogout} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Sign out</button>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px', opacity: 0.85 }}>Department codes</h2>
        <DeptCodeManager/>
      </section>

      <section>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 14px', opacity: 0.85 }}>Pending supervisor approvals</h2>
        <PendingSupervisorsList/>
      </section>
    </div>
  );
}
