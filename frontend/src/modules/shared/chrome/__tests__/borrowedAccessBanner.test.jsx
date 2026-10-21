// skipcq: JS-0833
// The borrowed-workspace strip's poll (migrations 20260930 / 20261022).
//
// A withdrawal of the module being borrowed arrives as a 403, not as a row
// saying "not granted": the poll carries X-Override-Module, and deps.py refuses
// an override with no grant before the route runs. The strip has to treat that
// as "go home", or the user stays in a workspace whose every request fails.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listMyModuleAccess: vi.fn(),
  listMyExecModuleAccess: vi.fn(),
}));
vi.mock('../../../../services/api/adapters/httpAdapter.js', () => api);

const switchAs = vi.hoisted(() => vi.fn());
vi.mock('../../../../state/SessionContext.jsx', () => ({
  useSession: () => ({
    session: { module: 'legal', realRole: 'executive' },
    borrowedModule: 'design',
    switchAs,
    workspaceAccessRevoked: null,
    clearWorkspaceAccessRevoked: vi.fn(),
  }),
}));

import BorrowedAccessBanner from '../BorrowedAccessBanner.jsx';

const renderBanner = () => render(<MemoryRouter><BorrowedAccessBanner /></MemoryRouter>);

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  switchAs.mockReset();
});

describe('the borrowed-workspace poll', () => {
  it('sends an executive home when the grant behind this module is refused', async () => {
    api.listMyExecModuleAccess.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
    renderBanner();
    await waitFor(() => expect(switchAs).toHaveBeenCalledWith(null, null));
    expect(api.listMyModuleAccess).not.toHaveBeenCalled();
  });

  it('keeps them where they are on a transient failure', async () => {
    api.listMyExecModuleAccess.mockRejectedValue(Object.assign(new Error('down'), { status: 0 }));
    renderBanner();
    await waitFor(() => expect(api.listMyExecModuleAccess).toHaveBeenCalled());
    expect(switchAs).not.toHaveBeenCalled();
    expect(screen.getByTestId('borrowed-access-banner')).toBeInTheDocument();
  });
});
