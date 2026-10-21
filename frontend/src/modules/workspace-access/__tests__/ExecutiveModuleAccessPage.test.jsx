// skipcq: JS-0833
// The executive's Module access panel (migration 20261022).
//
// A requestable row opens a supervisor picker; the request carries the chosen
// supervisor. NSO is never listed — it has no executive role.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listMyModuleAccess: vi.fn(),
  requestModuleAccess: vi.fn(),
  listMyExecModuleAccess: vi.fn(),
  listModuleSupervisors: vi.fn(),
  requestExecModuleAccess: vi.fn(),
  cancelExecModuleAccessRequest: vi.fn(),
}));
vi.mock('../../../services/api/adapters/httpAdapter.js', () => api);

const switchAs = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => vi.fn());
vi.mock('../../../state/SessionContext.jsx', () => ({ useSession: () => session() }));

import ModuleAccessPage from '../ModuleAccessPage.jsx';

const renderPage = async (rows) => {
  api.listMyExecModuleAccess.mockResolvedValue(rows);
  render(<MemoryRouter><ModuleAccessPage /></MemoryRouter>);
  await waitFor(() => expect(api.listMyExecModuleAccess).toHaveBeenCalled());
  await screen.findByText('Module access');
};

const rowFor = (moduleKey) => screen.getByTestId(`exec-access-${moduleKey}`);

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.requestExecModuleAccess.mockResolvedValue(undefined);
  api.cancelExecModuleAccessRequest.mockResolvedValue(undefined);
  api.listModuleSupervisors.mockResolvedValue([
    { id: 'sup-1', name: 'Meera', email: 'meera@example.com' },
  ]);
  switchAs.mockReset();
  session.mockReturnValue({
    session: { module: 'legal', realRole: 'executive' },
    switchAs,
    effectiveModule: 'legal',
    borrowedModule: null,
  });
});

describe('the executive panel', () => {
  it('is the page an executive gets, and never the supervisor one', async () => {
    await renderPage([{ module: 'legal', state: 'home' }]);
    expect(api.listMyModuleAccess).not.toHaveBeenCalled();
  });

  it('does not list NSO', async () => {
    await renderPage([{ module: 'legal', state: 'home' }]);
    expect(screen.queryByTestId('exec-access-nso')).toBeNull();
    expect(screen.queryByText('NSO')).toBeNull();
  });

  it('marks the home module and offers nothing to press', async () => {
    await renderPage([{ module: 'legal', state: 'home' }]);
    const row = rowFor('legal');
    expect(within(row).getByText('Your module')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('sends a request under the chosen supervisor, then reloads', async () => {
    const user = userEvent.setup();
    await renderPage([{ module: 'legal', state: 'home' }, { module: 'design', state: 'none' }]);
    await user.click(within(rowFor('design')).getByRole('button', { name: /request access/i }));
    expect(api.listModuleSupervisors).toHaveBeenCalledWith('design');

    const send = await within(rowFor('design')).findByRole('button', { name: /send request/i });
    expect(send).toBeDisabled();
    await user.selectOptions(within(rowFor('design')).getByLabelText(/supervisor in design/i), 'sup-1');
    await user.type(within(rowFor('design')).getByLabelText(/note/i), 'Covering a launch');
    await user.click(send);

    expect(api.requestExecModuleAccess).toHaveBeenCalledWith({
      module: 'design', targetSupervisorId: 'sup-1', note: 'Covering a launch',
    });
    await waitFor(() => expect(api.listMyExecModuleAccess).toHaveBeenCalledTimes(2));
  });

  it('says so when the module has no supervisor to work under', async () => {
    const user = userEvent.setup();
    api.listModuleSupervisors.mockResolvedValue([]);
    await renderPage([{ module: 'design', state: 'none' }]);
    await user.click(within(rowFor('design')).getByRole('button', { name: /request access/i }));
    expect(await within(rowFor('design')).findByText(/no active supervisors/i)).toBeInTheDocument();
    expect(within(rowFor('design')).getByRole('button', { name: /send request/i })).toBeDisabled();
  });

  it('lets a pending request be withdrawn', async () => {
    const user = userEvent.setup();
    await renderPage([{ module: 'design', state: 'pending', requestId: 'r-1', supervisorName: 'Meera' }]);
    expect(within(rowFor('design')).getByText(/under Meera/)).toBeInTheDocument();
    await user.click(within(rowFor('design')).getByRole('button', { name: /withdraw request/i }));
    expect(api.cancelExecModuleAccessRequest).toHaveBeenCalledWith('r-1');
  });

  it('enters a granted module as an executive', async () => {
    const user = userEvent.setup();
    await renderPage([{ module: 'design', state: 'granted', supervisorName: 'Meera' }]);
    await user.click(within(rowFor('design')).getByRole('button', { name: /enter workspace/i }));
    expect(switchAs).toHaveBeenCalledWith('executive', 'design');
  });

  it('says why a previous attempt is not granted', async () => {
    await renderPage([{ module: 'design', state: 'none', lastDecision: 'cancelled' }]);
    expect(within(rowFor('design')).getByText(/withdrew a previous request/i)).toBeInTheDocument();
  });
});
