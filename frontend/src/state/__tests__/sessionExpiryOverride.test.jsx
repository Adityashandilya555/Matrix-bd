// skipcq: JS-0833
// The session-expiry path must tear the override down, exactly as signOut does.
//
// #472 finding 6 fixed logout leaving the module override behind: it lives in
// sessionStorage, so the next sign-in IN THIS TAB carried it. `signInAgain` —
// the "Go to sign in" button on the expiry modal — is the sibling path, and it
// was missed. For an observer that means signing back in resolves `role` to the
// simulated supervisor, and RequireAuth waves them into a module shell instead
// of /observer.
//
// Driven through the real modal button rather than by calling the callback,
// because `signInAgain` is not on the context — the button is the only way a
// user reaches it, so it is the only honest way to test it.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const whoami = vi.fn();
let stored = null;
// The real store's listener set, so the provider genuinely subscribes rather
// than being handed a mock that always no-ops. Same rig as observerSession.
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(stored); };
const clearAuthToken = vi.fn();

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
  clearAuthToken: (...a) => clearAuthToken(...a),
  notifySessionExpired: vi.fn(),
}));

const { SessionProvider, useSession } = await import('../SessionContext.jsx');

let api = null;

function Probe() {
  api = useSession();
  return <dd data-testid="role">{String(api.role)}</dd>;
}

const claims = (over = {}) => ({
  email: 'asha@example.com', role: 'observer', real_role: 'observer',
  tenant_id: 't1', module: null, sub: 'u1', ...over,
});

const mount = async () => {
  render(
    <MemoryRouter initialEntries={['/bd/overview']}>
      <SessionProvider><Probe /></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(api?.authReady).toBe(true));
};

const expireTheSession = async () => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('scale:session-expired', { detail: { reason: 'expired' } }));
  });
};

beforeEach(() => {
  stored = null;
  api = null;
  listeners.clear();
  clearAuthToken.mockReset();
  // An observer that had entered Design read-only. whoami echoes the overridden
  // role back, because the GET carries the header.
  stored = { role: 'supervisor', module: 'design' };
  whoami.mockReset().mockResolvedValue(claims({ role: 'supervisor' }));
});

describe('signing in again after the session expires', () => {
  it('shows the modal for an in-app route', async () => {
    await mount();
    await expireTheSession();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('clears the stored module override', async () => {
    // The fix. Without it the override survives in sessionStorage and the next
    // sign-in in this tab silently re-enters the module.
    await mount();
    await expireTheSession();
    await act(async () => { screen.getByText('Go to sign in').click(); });
    expect(stored).toBe(null);
  });

  it('clears the override the provider is holding in state too', async () => {
    // Belt and braces: the store and the React mirror have to go together, or
    // the provider keeps reporting a simulated role that no request carries.
    await mount();
    await expireTheSession();
    await act(async () => { screen.getByText('Go to sign in').click(); });
    expect(api.adminOverride).toBe(null);
  });

  it('does not carry the module into the next sign-in in this tab', async () => {
    // The consequence that actually bites, end to end. signInAgain itself
    // resets to the signed-out default, so `role` right after the click says
    // nothing — what matters is what the NEXT session reads. A fresh provider
    // seeds adminOverride from the store, exactly as a page load does; if the
    // override survived, this observer would read as 'supervisor' and
    // RequireAuth would drop them into the module shell instead of /observer.
    await mount();
    await expireTheSession();
    await act(async () => { screen.getByText('Go to sign in').click(); });

    cleanup();
    whoami.mockResolvedValue(claims());   // signs back in as a plain observer
    await mount();

    expect(screen.getByTestId('role').textContent).toBe('observer');
  });

  it('still clears the auth token', async () => {
    // The behaviour that was already there must survive the change.
    await mount();
    await expireTheSession();
    await act(async () => { screen.getByText('Go to sign in').click(); });
    expect(clearAuthToken).toHaveBeenCalled();
  });
});
