// skipcq: JS-0833
// The supervisor's Module access page (migration 20260930).
//
// Each row renders exactly one control, decided by the state the backend
// reports: your own module offers nothing, a granted one is enterable, a
// pending one is inert, and anything else is requestable.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listMyModuleAccess: vi.fn(),
  requestModuleAccess: vi.fn(),
}));
vi.mock('../../../services/api/adapters/httpAdapter.js', () => api);

const switchAs = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => vi.fn());
vi.mock('../../../state/SessionContext.jsx', () => ({ useSession: () => session() }));

import ModuleAccessPage from '../ModuleAccessPage.jsx';

const renderPage = async (rows) => {
  api.listMyModuleAccess.mockResolvedValue(rows);
  render(<MemoryRouter><ModuleAccessPage /></MemoryRouter>);
  await waitFor(() => expect(api.listMyModuleAccess).toHaveBeenCalled());
  await screen.findByText('Module access');
};

// Every module gets a row, and anything the backend did not mention defaults to
// requestable — so assertions have to be scoped to the row under test rather
// than to the page.
const rowFor = (label) => screen.getByText(label).closest('li');

beforeEach(() => {
  api.listMyModuleAccess.mockReset();
  api.requestModuleAccess.mockReset().mockResolvedValue(undefined);
  switchAs.mockReset();
  session.mockReturnValue({
    session: { module: 'bd', realRole: 'supervisor' },
    switchAs,
    effectiveModule: 'bd',
    borrowedModule: null,
  });
});

describe('the row controls', () => {
  it('marks your own module and offers nothing to press', async () => {
    await renderPage([{ module: 'bd', state: 'home' }]);
    const row = rowFor('BD');
    expect(within(row).getByText('Your module')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('offers Request access for a module you do not hold', async () => {
    await renderPage([{ module: 'bd', state: 'home' }, { module: 'legal', state: 'none' }]);
    expect(within(rowFor('Legal')).getByRole('button', { name: /request access/i })).toBeInTheDocument();
  });

  it('shows a pending request as inert', async () => {
    await renderPage([{ module: 'legal', state: 'pending' }]);
    expect(within(rowFor('Legal')).getByRole('button', { name: /pending approval/i })).toBeDisabled();
  });

  it('offers Enter workspace once access is granted', async () => {
    await renderPage([{ module: 'legal', state: 'granted' }]);
    expect(within(rowFor('Legal')).getByRole('button', { name: /enter workspace/i })).toBeInTheDocument();
  });

  it('says why a previous attempt is not granted', async () => {
    await renderPage([{ module: 'legal', state: 'none', lastDecision: 'rejected' }]);
    expect(within(rowFor('Legal')).getByText(/previous request was declined/i)).toBeInTheDocument();
  });
});

describe('acting on a row', () => {
  it('requests access and reloads so the row flips to pending', async () => {
    const user = userEvent.setup();
    await renderPage([{ module: 'legal', state: 'none' }]);
    api.listMyModuleAccess.mockClear();
    await user.click(within(rowFor('Legal')).getByRole('button', { name: /request access/i }));
    expect(api.requestModuleAccess).toHaveBeenCalledWith('legal');
    await waitFor(() => expect(api.listMyModuleAccess).toHaveBeenCalled());
  });

  it('enters the workspace as that module\'s supervisor', async () => {
    const user = userEvent.setup();
    await renderPage([{ module: 'legal', state: 'granted' }]);
    await user.click(within(rowFor('Legal')).getByRole('button', { name: /enter workspace/i }));
    expect(switchAs).toHaveBeenCalledWith('supervisor', 'legal');
  });

  it('offers Exit on the module it is already inside', async () => {
    session.mockReturnValue({
      session: { module: 'bd', realRole: 'supervisor' },
      switchAs,
      effectiveModule: 'legal',
      borrowedModule: 'legal',
    });
    const user = userEvent.setup();
    await renderPage([{ module: 'legal', state: 'granted' }]);
    await user.click(await screen.findByRole('button', { name: /exit workspace/i }));
    expect(switchAs).toHaveBeenCalledWith(null, null);
  });

  it('surfaces a refusal instead of failing silently', async () => {
    const user = userEvent.setup();
    api.requestModuleAccess.mockRejectedValue({ detail: 'You already supervise this module.' });
    await renderPage([{ module: 'legal', state: 'none' }]);
    await user.click(within(rowFor('Legal')).getByRole('button', { name: /request access/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already supervise/i);
  });
});
