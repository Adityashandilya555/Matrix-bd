// What the session reports for an observer, with and without a module override.
//
// This is the piece that decides whether an observer is in the workspace shell
// at all — RequireAuth reads `role` — so it is tested through the real provider
// rather than by re-deriving the expressions.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const whoami = vi.fn();
let stored = null;

vi.mock('../../services/api/authService.js', () => ({
  DEFAULT_SESSION: { name: 'Riya', email: 'riya@example.com', role: 'supervisor' },
  me: (...a) => whoami(...a),
  logout: vi.fn(),
}));
vi.mock('../../services/api/supabaseAuth.js', () => ({ signOut: vi.fn() }));
vi.mock('../../services/api/adminOverride.js', () => ({
  getStoredOverride: () => stored,
  activateOverride: (o) => { stored = o; },
  deactivateOverride: () => { stored = null; },
}));
vi.mock('../../hooks/useInactivityLogout.js', () => ({ useInactivityLogout: () => {} }));
vi.mock('../../services/api/authToken.js', () => ({
  SESSION_EXPIRED_EVENT: 'scale:session-expired',
  subscribeAuthToken: () => () => {},
  getAuthToken: () => 'a.token.here',
  clearAuthToken: vi.fn(),
  notifySessionExpired: vi.fn(),
}));

const { SessionProvider, useSession, OBSERVER_VIEW_ROLES } = await import('../SessionContext.jsx');

let api = null;

function Probe() {
  api = useSession();
  return (
    <dl>
      <dd data-testid="role">{String(api.role)}</dd>
      <dd data-testid="realRole">{String(api.realRole)}</dd>
      <dd data-testid="readOnly">{String(api.isReadOnly)}</dd>
      <dd data-testid="module">{String(api.effectiveModule)}</dd>
    </dl>
  );
}

const claims = (over = {}) => ({
  email: 'asha@example.com', role: 'observer', real_role: 'observer',
  tenant_id: 't1', module: null, sub: 'u1', ...over,
});

const mount = async () => {
  render(<MemoryRouter><SessionProvider><Probe /></SessionProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('realRole').textContent).not.toBe('undefined'));
};

const val = (key) => screen.getByTestId(key).textContent;

beforeEach(() => {
  stored = null;
  api = null;
  whoami.mockReset().mockResolvedValue(claims());
});

describe('an observer with no override', () => {
  it('reads as an observer, so RequireAuth bounces it to its own portal', async () => {
    await mount();
    expect(val('role')).toBe('observer');
  });

  it('is read-only', async () => {
    await mount();
    expect(val('readOnly')).toBe('true');
  });
});

describe('an observer viewing a module', () => {
  beforeEach(() => {
    stored = { role: 'supervisor', module: 'design' };
    // whoami echoes the overridden role back, because the request carries the
    // header — which is exactly why realRole has to come from a separate claim.
    whoami.mockResolvedValue(claims({ role: 'supervisor' }));
  });

  it('reads as that module’s supervisor, so the shell lets it in', async () => {
    await mount();
    expect(val('role')).toBe('supervisor');
    expect(val('module')).toBe('design');
  });

  it('is STILL read-only — the whole point of the pairing', async () => {
    await mount();
    expect(val('readOnly')).toBe('true');
  });

  it('still reports observer as its real role', async () => {
    // This used to be `session.role`, i.e. the simulated role — realRole
    // reported the simulation, the one thing it exists to see past.
    await mount();
    expect(val('realRole')).toBe('observer');
  });

  it('drops straight back to observer when the override is cleared', async () => {
    // The one assertion that cannot pass by accident. whoami echoes the
    // SIMULATED role back (it is a GET, so it carries the override header), so
    // a derivation that falls back to session.role would leave `role` stuck at
    // 'supervisor' here — and RequireAuth would hold an observer inside a shell
    // it had just left.
    await mount();
    expect(val('role')).toBe('supervisor');
    act(() => { api.switchAs(null, null); });
    expect(val('role')).toBe('observer');
  });
});

describe('the observer view-role allowlist', () => {
  it('offers exactly supervisor and executive', async () => {
    expect(OBSERVER_VIEW_ROLES).toEqual(['supervisor', 'executive']);
  });

  it('refuses to store business_admin, which the backend would ignore anyway', async () => {
    // Storing it would leave the portal thinking it is in a module while every
    // request still arrives as a plain observer.
    await mount();
    act(() => { api.switchAs('business_admin', 'design'); });
    expect(stored).toBeNull();
    expect(val('role')).toBe('observer');
  });

  it('stores a supervisor view', async () => {
    await mount();
    act(() => { api.switchAs('supervisor', 'legal'); });
    expect(stored).toEqual({ role: 'supervisor', module: 'legal' });
  });

  it('clears on switchAs(null)', async () => {
    stored = { role: 'supervisor', module: 'design' };
    await mount();
    act(() => { api.switchAs(null, null); });
    expect(stored).toBeNull();
  });
});

describe('nothing else moved', () => {
  it('a plain supervisor is not read-only and cannot override', async () => {
    whoami.mockResolvedValue(claims({ role: 'supervisor', real_role: 'supervisor', module: 'bd' }));
    await mount();
    expect(val('readOnly')).toBe('false');
    act(() => { api.switchAs('executive', 'design'); });
    expect(stored).toBeNull();
  });

  it('a business admin is not read-only and keeps an unrestricted override', async () => {
    whoami.mockResolvedValue(claims({ role: 'business_admin', real_role: 'business_admin' }));
    await mount();
    expect(val('readOnly')).toBe('false');
    act(() => { api.switchAs('executive', 'nso'); });
    expect(stored).toEqual({ role: 'executive', module: 'nso' });
  });
});
