// skipcq: JS-0833
// Which module the Team page manages.
//
// A supervisor inside a borrowed workspace (migration 20260930) manages THAT
// module's team. Reading session.module instead would render module A's team
// while every write went to B — the page would look right and act wrong.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

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

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMyInviteCode.mockResolvedValue({ code: 'ABC123', createdAt: null });
  api.listMyPendingExecutives.mockResolvedValue([]);
  api.listMyTeam.mockResolvedValue([]);
  api.listAvailableExecutives.mockResolvedValue([]);
});

describe('the module the Team page acts on', () => {
  it('follows the borrowed workspace, not the supervisor\'s own module', async () => {
    session.mockReturnValue({
      role: 'supervisor',
      session: { module: 'bd', realRole: 'supervisor' },
      effectiveModule: 'legal',
      user: { name: 'Asha' },
    });
    render(<TeamPage />);
    await waitFor(() => expect(api.listMyTeam).toHaveBeenCalledWith('legal'));
    expect(api.getMyInviteCode).toHaveBeenCalledWith('legal');
    expect(api.listMyPendingExecutives).toHaveBeenCalledWith('legal');
  });

  it('is the supervisor\'s own module when nothing is borrowed', async () => {
    session.mockReturnValue({
      role: 'supervisor',
      session: { module: 'bd', realRole: 'supervisor' },
      effectiveModule: 'bd',
      user: { name: 'Asha' },
    });
    render(<TeamPage />);
    await waitFor(() => expect(api.listMyTeam).toHaveBeenCalledWith('bd'));
  });
});
