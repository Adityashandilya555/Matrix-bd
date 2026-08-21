// skipcq: JS-0833
// The supervisor's side of sharing an executive.
//
// This panel is the ONLY way a second supervisor link gets made: an executive
// cannot redeem a second invite code, because signup refuses an email that is
// already active in the workspace. So if this section is missing or wired to the
// wrong call, the feature has no entry point at all — which is exactly how the
// observer signup shipped unreachable.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.hoisted: vi.mock factories are lifted above the imports, so a plain const
// declared here would still be in its TDZ when the factory runs.
const api = vi.hoisted(() => ({
  getMyInviteCode: vi.fn(),
  rotateMyInviteCode: vi.fn(),
  listMyPendingExecutives: vi.fn(),
  approveMyPendingExecutive: vi.fn(),
  rejectMyPendingExecutive: vi.fn(),
  listMyTeam: vi.fn(),
  listAvailableExecutives: vi.fn(),
  addExistingExecutive: vi.fn(),
  removeFromMyTeam: vi.fn(),
}));
vi.mock('../../../services/api/adapters/httpAdapter.js', () => api);

const session = vi.hoisted(() => vi.fn());
vi.mock('../../../state/SessionContext.jsx', () => ({ useSession: () => session() }));

import TeamPage from '../TeamPage.jsx';

const MINE = { id: 'exe-9', email: 'mine@example.com', name: 'Already Mine' };
const FREE = { id: 'exe-1', email: 'exe1@example.com', name: 'Exe One' };

const renderPage = async ({ team = [], available = [] } = {}) => {
  api.listMyTeam.mockResolvedValue(team);
  api.listAvailableExecutives.mockResolvedValue(available);
  const view = render(<TeamPage />);
  await waitFor(() => expect(api.listAvailableExecutives).toHaveBeenCalled());
  return view;
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMyInviteCode.mockResolvedValue({ code: 'ABC123', createdAt: null });
  api.listMyPendingExecutives.mockResolvedValue([]);
  api.addExistingExecutive.mockResolvedValue(undefined);
  api.removeFromMyTeam.mockResolvedValue(undefined);
  session.mockReturnValue({
    role: 'supervisor', session: { module: 'bd' }, user: { name: 'Supr Two' },
  });
});

describe('adding someone already in the module', () => {
  it('offers the people who are in this module but not on my team', async () => {
    await renderPage({ available: [FREE] });
    expect(screen.getByText('Exe One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to my team/i })).toBeInTheDocument();
  });

  it('adds them to this module, by id', async () => {
    const user = userEvent.setup();
    await renderPage({ available: [FREE] });
    await user.click(screen.getByRole('button', { name: /add to my team/i }));
    expect(api.addExistingExecutive).toHaveBeenCalledWith('bd', 'exe-1');
  });

  it('reloads afterwards, so they move into My active team', async () => {
    const user = userEvent.setup();
    await renderPage({ available: [FREE] });
    api.listMyTeam.mockClear();
    await user.click(screen.getByRole('button', { name: /add to my team/i }));
    await waitFor(() => expect(api.listMyTeam).toHaveBeenCalled());
  });

  it('says the existing team is kept, because that is the surprising part', async () => {
    await renderPage({ available: [FREE] });
    expect(screen.getByText(/keep their existing\s+team/i)).toBeInTheDocument();
  });

  it('hides the whole panel when there is nobody to add', async () => {
    // The common case — most modules have one supervisor. An empty panel on
    // every supervisor's page would be permanent noise.
    await renderPage({ available: [] });
    expect(screen.queryByText(/also in this module/i)).toBeNull();
  });

  it('surfaces a failure instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    api.addExistingExecutive.mockRejectedValue({ detail: 'Not a member of this module.' });
    await renderPage({ available: [FREE] });
    await user.click(screen.getByRole('button', { name: /add to my team/i }));
    expect(await screen.findByText(/not a member of this module/i)).toBeInTheDocument();
  });
});

describe('removing someone from my team', () => {
  it('unlinks only my own team, never the account', async () => {
    const user = userEvent.setup();
    await renderPage({ team: [MINE] });
    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(api.removeFromMyTeam).toHaveBeenCalledWith('bd', 'exe-9');
  });

  it('reloads afterwards so they reappear as available', async () => {
    const user = userEvent.setup();
    await renderPage({ team: [MINE] });
    api.listAvailableExecutives.mockClear();
    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(api.listAvailableExecutives).toHaveBeenCalled());
  });
});
