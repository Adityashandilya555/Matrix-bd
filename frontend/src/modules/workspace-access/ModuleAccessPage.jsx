// skipcq: JS-0833
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../state/SessionContext.jsx';
import { ROLE } from '../../rbac/roles.js';
import { WORKSPACE_MODULES, workspaceModuleRoute } from '../shared/workspaceModules.js';
import {
  listMyModuleAccess,
  requestModuleAccess,
} from '../../services/api/adapters/httpAdapter.js';

// Module access — the supervisor's own surface for cross-module workspace
// access (migration 20260930).
//
// One row per module. Your own module is marked and has no action; any other is
// either requestable, awaiting a business admin, or already granted and
// enterable. Entering makes this session act as that module's supervisor —
// the backend re-checks the grant on every request, so a revoke lands
// immediately rather than at token expiry.
//
// Rows come from WORKSPACE_MODULES, never a second hardcoded list: that file
// exists precisely so the switchers cannot drift from one another.

// No sub-label for `home`: the chip on that row already says "Your module", and
// saying it twice in one row reads as a rendering bug.
const LABELS = {
  home:    '',
  granted: 'Access granted',
  pending: 'Awaiting approval',
  none:    '',
};

export default function ModuleAccessPage() {
  const { session, switchAs, effectiveModule, borrowedModule } = useSession();
  const navigate = useNavigate();
  const [states, setStates] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const rows = await listMyModuleAccess();
      setStates(Object.fromEntries(rows.map((r) => [r.module, r])));
      setStatus('ready');
      setError(null);
    } catch (e) {
      setStatus('ready');
      setError(e?.detail || e?.message || 'Could not load your module access.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const request = async (moduleKey) => {
    setBusy(moduleKey); setError(null);
    try {
      await requestModuleAccess(moduleKey);
      await load();
    } catch (e) {
      setError(e?.detail || e?.message || 'Could not send that request.');
    } finally {
      setBusy(null);
    }
  };

  const enter = (moduleKey) => {
    // Soft navigate: this page lives under the same provider as SessionContext
    // and switchAs updates it synchronously, so unlike the business-admin panel
    // (a separate React root) there is nothing to reload for.
    switchAs(ROLE.SUPERVISOR, moduleKey);
    navigate(workspaceModuleRoute(moduleKey));
  };

  const exit = () => {
    switchAs(null, null);
    navigate(workspaceModuleRoute(session?.module));
  };

  return (
    <div style={{ padding: '22px 26px', maxWidth: 820 }}>
      <h1 style={{ margin: 0, font: '600 20px/1.3 var(--zm-font-body)', color: 'var(--zm-fg)' }}>
        Module access
      </h1>
      <p style={{ margin: '6px 0 18px', font: '13px/1.5 var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
        Ask a business admin for supervisor access to another module. Once approved you can enter it
        and work there as its supervisor; your own module stays yours.
      </p>

      {error && (
        <div role="alert" style={{
          marginBottom: 14, padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--zm-danger-border, #f3c2c2)',
          background: 'var(--zm-danger-bg, #fdf1f1)',
          font: '12.5px/1.45 var(--zm-font-body)', color: 'var(--zm-danger-fg, #9b1c1c)',
        }}>{error}</div>
      )}

      {status === 'loading' ? (
        <div style={{ font: '13px var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>Loading…</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {WORKSPACE_MODULES.map((m) => {
            const row = states[m.value] || { state: 'none' };
            const isHere = borrowedModule === m.value && effectiveModule === m.value;
            return (
              <li key={m.value} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '600 14px var(--zm-font-body)', color: 'var(--zm-fg)' }}>
                    {m.label}
                  </div>
                  <div style={{ font: '12px var(--zm-font-body)', color: 'var(--zm-fg-muted)' }}>
                    {isHere ? 'You are working here now' : LABELS[row.state]}
                    {row.state === 'none' && row.lastDecision === 'rejected' && 'A previous request was declined'}
                    {row.state === 'none' && row.lastDecision === 'revoked' && 'Access was withdrawn'}
                  </div>
                </div>
                {row.state === 'home' && (
                  <span style={{
                    font: '11.5px var(--zm-font-body)', color: 'var(--zm-fg-muted)',
                    border: '1px solid var(--zm-line)', borderRadius: 999, padding: '3px 10px',
                  }}>Your module</span>
                )}
                {row.state === 'pending' && (
                  <button type="button" disabled style={{
                    font: '12.5px var(--zm-font-body)', padding: '7px 13px', borderRadius: 8,
                    border: '1px solid var(--zm-line)', background: 'transparent',
                    color: 'var(--zm-fg-muted)', cursor: 'not-allowed',
                  }}>Pending approval</button>
                )}
                {row.state === 'granted' && (
                  isHere ? (
                    <button type="button" onClick={exit} style={btnStyle(false)}>Exit workspace</button>
                  ) : (
                    <button type="button" onClick={() => enter(m.value)} style={btnStyle(true)}>
                      Enter workspace
                    </button>
                  )
                )}
                {row.state === 'none' && (
                  <button
                    type="button"
                    onClick={() => request(m.value)}
                    disabled={busy === m.value}
                    style={btnStyle(false)}
                  >
                    {busy === m.value ? 'Requesting…' : 'Request access'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function btnStyle(primary) {
  return {
    font: '12.5px var(--zm-font-body)', padding: '7px 13px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${primary ? 'var(--zm-accent, #2a78d6)' : 'var(--zm-line)'}`,
    background: primary ? 'var(--zm-accent, #2a78d6)' : 'transparent',
    color: primary ? '#fff' : 'var(--zm-fg)',
  };
}
