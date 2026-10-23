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

  it('lists NSO, as supervisor access', async () => {
    await renderPage([{ module: 'legal', state: 'home' }]);
    expect(within(rowFor('nso')).getByText(/work here as its supervisor/i)).toBeInTheDocument();
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

  it('ignores a supervisor list that arrives after another row was opened', async () => {
    const user = userEvent.setup();
    let resolveDesign;
    api.listModuleSupervisors.mockImplementation((m) => (m === 'design'
      ? new Promise((r) => { resolveDesign = r; })
      : Promise.resolve([{ id: 'sup-2', name: 'Arun', email: 'arun@example.com' }])));
    await renderPage([{ module: 'design', state: 'none' }, { module: 'bd', state: 'none' }]);
    await user.click(within(rowFor('design')).getByRole('button', { name: /request access/i }));
    await user.click(within(rowFor('bd')).getByRole('button', { name: /request access/i }));
    expect(await within(rowFor('bd')).findByRole('option', { name: /Arun/ })).toBeInTheDocument();

    // Design's answer lands late; BD's picker must keep its own list.
    resolveDesign([{ id: 'sup-1', name: 'Meera', email: 'meera@example.com' }]);
    await waitFor(() => expect(within(rowFor('bd')).getByRole('option', { name: /Arun/ })).toBeInTheDocument());
    expect(within(rowFor('bd')).queryByText(/loading supervisors/i)).toBeNull();
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

  it('shows no rows when the panel fails to load, and retries', async () => {
    const user = userEvent.setup();
    api.listMyExecModuleAccess.mockRejectedValueOnce({ detail: 'Not Found' });
    render(<MemoryRouter><ModuleAccessPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not Found');
    // Without this every module would read as requestable, the home one too.
    expect(screen.queryByTestId('exec-access-legal')).toBeNull();
    api.listMyExecModuleAccess.mockResolvedValueOnce([{ module: 'legal', state: 'home' }]);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Your module')).toBeInTheDocument();
  });

  it('says so when the supervisor list fails instead of an empty dropdown', async () => {
    const user = userEvent.setup();
    api.listModuleSupervisors.mockRejectedValue({ detail: 'Not Found' });
    await renderPage([{ module: 'design', state: 'none' }]);
    await user.click(within(rowFor('design')).getByRole('button', { name: /request access/i }));
    expect(await within(rowFor('design')).findByText(/could not load design/i)).toBeInTheDocument();
    expect(within(rowFor('design')).queryByRole('combobox')).toBeNull();
  });

  it('requests NSO supervisor access without choosing a supervisor', async () => {
    const user = userEvent.setup();
    await renderPage([{ module: 'legal', state: 'home' }, { module: 'nso', state: 'none' }]);
    await user.click(within(rowFor('nso')).getByRole('button', { name: /request access/i }));
    expect(api.listModuleSupervisors).not.toHaveBeenCalled();
    expect(within(rowFor('nso')).queryByRole('combobox')).toBeNull();
    expect(within(rowFor('nso')).getByText(/including final approval/i)).toBeInTheDocument();
    await user.click(within(rowFor('nso')).getByRole('button', { name: /send request/i }));
    expect(api.requestExecModuleAccess).toHaveBeenCalledWith({
      module: 'nso', targetSupervisorId: null, note: '',
    });
  });

  it('labels a granted NSO row as supervisor access', async () => {
    await renderPage([{ module: 'nso', state: 'granted' }]);
    expect(within(rowFor('nso')).getByText('NSO supervisor access granted')).toBeInTheDocument();
  });
});
