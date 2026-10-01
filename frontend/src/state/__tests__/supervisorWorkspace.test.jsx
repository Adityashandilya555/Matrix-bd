// skipcq: JS-0833
// What the session reports for a supervisor working inside a module they
// borrowed under an approved grant (migration 20260930).
//
// Driven through the real provider, like observerSession.test.jsx: these are
// the expressions RequireModule, the sidebar and every module query read, and
// re-deriving them in the test would prove nothing.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const whoami = vi.fn();
let stored = null;
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(stored); };

vi.mock('../../services/api/authService.js', () => ({
  DEFAULT_SESSION: { name: 'Riya', email: 'riya@example.com', role: 'supervisor' },
  me: (...a) => whoami(...a),
  logout: vi.fn(),
}));
vi.mock('../../services/api/supabaseAuth.js', () => ({ signOut: vi.fn() }));
vi.mock('../../services/api/adminOverride.js', () => ({
  getStoredOverride: () => stored,
  activateOverride: (o) => { stored = o; notify(); },
  deactivateOverride: () => { stored = null; notify(); },
  subscribeOverride: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
}));
vi.mock('../../hooks/useInactivityLogout.js', () => ({ useInactivityLogout: () => {} }));
vi.mock('../../services/api/authToken.js', () => ({
  SESSION_EXPIRED_EVENT: 'scale:session-expired',
  subscribeAuthToken: () => () => {},
  getAuthToken: () => 'a.token.here',
  clearAuthToken: vi.fn(),
  notifySessionExpired: vi.fn(),
}));

const { SessionProvider, useSession } = await import('../SessionContext.jsx');

let api = null;

function Probe() {
  api = useSession();
  return (
    <dl>
      <dd data-testid="role">{String(api.role)}</dd>
      <dd data-testid="realRole">{String(api.realRole)}</dd>
      <dd data-testid="module">{String(api.effectiveModule)}</dd>
      <dd data-testid="home">{String(api.session.module)}</dd>
      <dd data-testid="borrowed">{String(api.borrowedModule)}</dd>
      <dd data-testid="revoked">{String(api.workspaceAccessRevoked)}</dd>
    </dl>
  );
}

const claims = (over = {}) => ({
  email: 'asha@example.com', role: 'supervisor', real_role: 'supervisor',
  tenant_id: 't1', module: 'bd', home_module: 'bd', sub: 'u1', ...over,
});

const mount = async () => {
  render(<MemoryRouter><SessionProvider><Probe /></SessionProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('realRole').textContent).not.toBe('undefined'));
};

const val = (key) => screen.getByTestId(key).textContent;

beforeEach(() => {
  stored = null;
  api = null;
  listeners.clear();
  whoami.mockReset().mockResolvedValue(claims());
});

describe('a supervisor inside a borrowed workspace', () => {
  it('reports the borrowed module as the effective one', async () => {
    stored = { role: 'supervisor', module: 'legal' };
    await mount();
    expect(val('module')).toBe('legal');
    expect(val('borrowed')).toBe('legal');
  });

  it('keeps the home module as the session module, not the echoed one', async () => {
    // whoami is a GET, so it carries the override header and echoes the
    // SIMULATED module back. home_module is the JWT's own.
    stored = { role: 'supervisor', module: 'legal' };
    whoami.mockResolvedValue(claims({ module: 'legal', home_module: 'bd' }));
    await mount();
    expect(val('home')).toBe('bd');
    expect(val('module')).toBe('legal');
  });

  it('stays a supervisor there even for a dual-role supervisor', async () => {
    // deps.py ignores X-Override-Role inside a borrowed module, so reporting
    // anything else here would be a lie about what the server did.
    stored = { role: 'executive', module: 'legal' };
    whoami.mockResolvedValue(claims({ has_executive_access: true }));
    await mount();
    expect(val('role')).toBe('supervisor');
  });

  it('lets a plain supervisor enter and then exit', async () => {
    await mount();
    act(() => { api.switchAs('supervisor', 'legal'); });
    expect(stored).toEqual({ role: 'supervisor', module: 'legal' });
    act(() => { api.switchAs(null, null); });
    expect(stored).toBeNull();
  });

  it('refuses to store any role other than supervisor for another module', async () => {
    await mount();
    act(() => { api.switchAs('executive', 'legal'); });
    expect(stored).toBeNull();
  });

  it('leaves the dual-role switch inside the home module alone', async () => {
    whoami.mockResolvedValue(claims({ has_executive_access: true }));
    await mount();
    act(() => { api.switchAs('executive', 'bd'); });
    expect(stored).toEqual({ role: 'executive', module: 'bd' });
    expect(val('borrowed')).toBe('null');
  });
});

describe('when the grant is withdrawn', () => {
  it('drops the override and says so, rather than signing the user out', async () => {
    // The server exempts whoami from the 403 for exactly this handshake:
    // SessionContext treats a 403 there as an auth rejection and would clear
    // the token on first load.
    stored = { role: 'supervisor', module: 'legal' };
    whoami.mockResolvedValue(claims({ workspace_access_refused: 'legal' }));
    await mount();
    await waitFor(() => expect(val('revoked')).toBe('legal'));
    expect(stored).toBeNull();
    expect(val('module')).toBe('bd');
  });

  it('does not carry the notice into a session that never lost anything', async () => {
    // The provider does not remount on sign-out, so a notice left standing
    // would greet whoever signs in next in this tab.
    await mount();
    expect(val('revoked')).toBe('null');
  });
});
