// PR #255 — regression test for SitesContext's auth gate.
//
// The store wraps the WHOLE app (including the public landing page), so it must
// NOT issue GET /api/sites until the session has hydrated (`authReady`) and a
// token exists. Firing a tokenless /sites request produced 401s that popped the
// "session paused" modal right after login. Once authReady flips true (with a
// token) it should fetch the list exactly once on mount.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// Force HTTP mode (the gate is a no-op in mock mode).
vi.stubEnv('VITE_USE_MOCK', 'false');

// Controllable session — tests flip `authReady`.
let sessionValue = { user: { name: 'A' }, session: { userId: 'u1' }, role: 'supervisor', authReady: false };
vi.mock('../SessionContext.jsx', () => ({
  useSession: () => sessionValue,
}));

// A token is always present so the only thing gating the fetch is `authReady`.
vi.mock('../../services/api/authToken.js', () => ({
  getAuthToken: () => 'tok-present',
}));

const listSitesMock = vi.fn(() => Promise.resolve([]));
vi.mock('../../services/api/siteService.js', () => ({
  listSites: (...args) => listSitesMock(...args),
  // The provider imports the module namespace; stub the action helpers it
  // closes over so the module shape is complete.
  shortlistSite: vi.fn(), rejectSite: vi.fn(), archiveSite: vi.fn(),
  reviveSite: vi.fn(), saveDraftDetails: vi.fn(), submitDetails: vi.fn(),
  approveSite: vi.fn(), uploadLoi: vi.fn(), pushToPayments: vi.fn(),
  createSite: vi.fn(),
}));

async function renderProvider() {
  const { SitesProvider } = await import('../SitesContext.jsx');
  return render(<SitesProvider><div>child</div></SitesProvider>);
}

beforeEach(() => {
  listSitesMock.mockClear();
  sessionValue = { user: { name: 'A' }, session: { userId: 'u1' }, role: 'supervisor', authReady: false };
  vi.resetModules();
});

describe('SitesContext — auth gate (#popup-on-login)', () => {
  it('does NOT call listSites while authReady is false', async () => {
    await renderProvider();
    // Give effects a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it('calls listSites exactly once once authReady becomes true', async () => {
    sessionValue = { ...sessionValue, authReady: true };
    await renderProvider();
    await waitFor(() => expect(listSitesMock).toHaveBeenCalledTimes(1));
    // No extra fetches from a stray render — the mount effect is keyed on
    // [identityKey, role, authReady] which are all stable here.
    await new Promise((r) => setTimeout(r, 0));
    expect(listSitesMock).toHaveBeenCalledTimes(1);
  });
});
