// skipcq: JS-0833
// Merging the two approval queues into one list is only safe if the shell still
// sends each row to its OWN endpoint.
//
// The two are deliberately not interchangeable: approving a supervisor also
// writes a user_module_memberships row, and approving an observer must not (an
// observer is workspace-wide and holds no membership). The backend refuses the
// wrong pairing outright — business_admin_service.approve_supervisor scopes to
// role='supervisor' — so getting this wrong fails silently in the UI rather
// than corrupting anything. Silently is the problem.
//
// Driven through the real TeamDashboard with injected fetchers, because the
// dispatch lives there; DepartmentsTab's own tests only prove the rows are
// tagged.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/api/authToken.js', () => ({
  getAuthToken: () => 'a.token.here',
}));
vi.mock('../jwt.js', () => ({ decodeJwtPayload: () => ({ workspace_name: 'Acme' }) }));

const TeamDashboard = (await import('../TeamDashboard.jsx')).default;

const SUP = { id: 's1', email: 'sup@example.com', module: 'bd', createdAt: '2026-08-01T10:00:00Z' };
const OBS = { id: 'o1', email: 'obs@example.com', createdAt: '2026-08-02T10:00:00Z' };

let fetchers;

const emptyList = () => Promise.resolve([]);

const mount = async ({ supervisors = [], observers = [] } = {}) => {
  fetchers = {
    listDeliverables: emptyList, listGfc: emptyList, listFinance: emptyList,
    listBudget: emptyList, listQualityAudit: emptyList, listClosure: emptyList,
    listExecutiveReqs: emptyList, listOrg: emptyList, listSites: emptyList,
    listSupervisors: () => Promise.resolve(supervisors),
    listPendingObservers: () => Promise.resolve(observers),
    listActiveObservers: emptyList,
    getObserverCode: () => Promise.resolve('ABC12345'),
    approveSupervisor: vi.fn().mockResolvedValue(undefined),
    rejectSupervisor: vi.fn().mockResolvedValue(undefined),
    approveObserver: vi.fn().mockResolvedValue(undefined),
    rejectObserver: vi.fn().mockResolvedValue(undefined),
  };
  render(<TeamDashboard onLogout={vi.fn()} fetchers={fetchers} workspaceName="Acme" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: /departments/i }));
  return screen.getByRole('heading', { name: /awaiting approval/i }).closest('section');
};

beforeEach(() => { fetchers = null; });

describe('approving from the merged queue', () => {
  it('sends an observer to the observer endpoint', async () => {
    const user = userEvent.setup();
    const queue = await mount({ observers: [OBS] });
    await user.click(await within(queue).findByRole('button', { name: /approve/i }));

    await waitFor(() => expect(fetchers.approveObserver).toHaveBeenCalledWith('o1'));
    expect(fetchers.approveSupervisor).not.toHaveBeenCalled();
  });

  it('sends a supervisor to the supervisor endpoint, with its module', async () => {
    const user = userEvent.setup();
    const queue = await mount({ supervisors: [SUP] });
    await user.click(await within(queue).findByRole('button', { name: /approve/i }));

    await waitFor(() => expect(fetchers.approveSupervisor).toHaveBeenCalledWith('s1', 'bd'));
    expect(fetchers.approveObserver).not.toHaveBeenCalled();
  });

  it('keeps them apart when both are in the list', async () => {
    // The case the merge actually creates, and the one a single shared handler
    // would get wrong.
    const user = userEvent.setup();
    const queue = await mount({ supervisors: [SUP], observers: [OBS] });
    const rows = await within(queue).findAllByRole('button', { name: /approve/i });
    expect(rows).toHaveLength(2);

    // Sorted oldest-first, so the supervisor (Aug 1) is row 0.
    await user.click(rows[0]);
    await waitFor(() => expect(fetchers.approveSupervisor).toHaveBeenCalledWith('s1', 'bd'));
    expect(fetchers.approveObserver).not.toHaveBeenCalled();

    await user.click((await within(queue).findAllByRole('button', { name: /approve/i })).at(-1));
    await waitFor(() => expect(fetchers.approveObserver).toHaveBeenCalledWith('o1'));
  });
});

describe('rejecting from the merged queue', () => {
  it('sends an observer to the observer endpoint', async () => {
    const user = userEvent.setup();
    const queue = await mount({ observers: [OBS] });
    await user.click(await within(queue).findByRole('button', { name: /reject/i }));

    await waitFor(() => expect(fetchers.rejectObserver).toHaveBeenCalledWith('o1'));
    expect(fetchers.rejectSupervisor).not.toHaveBeenCalled();
  });

  it('sends a supervisor to the supervisor endpoint', async () => {
    const user = userEvent.setup();
    const queue = await mount({ supervisors: [SUP] });
    await user.click(await within(queue).findByRole('button', { name: /reject/i }));

    await waitFor(() => expect(fetchers.rejectSupervisor).toHaveBeenCalledWith('s1'));
    expect(fetchers.rejectObserver).not.toHaveBeenCalled();
  });
});

describe('the entry points that tell you there is anything to approve', () => {
  // The merge made the Departments tab honest, but the nav badge, the attention
  // line and the Pending requests tile are how someone LEARNS to go there. They
  // counted supervisors only, so a workspace whose sole pending request was an
  // observer showed a zero badge and "You're all caught up" — the same "sits
  // unnoticed" problem the merge removed, one level up.
  const tile = () => screen.getByText('Pending requests')
    .closest('[role="button"]');

  it('counts a lone pending observer in the Pending requests tile', async () => {
    // The tile's caption is literally "workspace access", which is exactly what
    // an observer holds — it is the tile that should have counted them.
    await mount({ observers: [OBS] });
    await waitFor(() => expect(within(tile()).getByText('1')).toBeInTheDocument());
  });

  it('does not claim you are all caught up while an observer waits', async () => {
    await mount({ observers: [OBS] });
    await waitFor(() => expect(screen.getByText(/1 awaiting approval/i)).toBeInTheDocument());
  });

  it('counts observers and supervisors together', async () => {
    await mount({ supervisors: [SUP], observers: [OBS] });
    await waitFor(() => expect(screen.getByText(/2 awaiting approval/i)).toBeInTheDocument());
    await waitFor(() => expect(within(tile()).getByText('2')).toBeInTheDocument());
  });

  it('reports zero when genuinely nobody is waiting', async () => {
    await mount();
    await waitFor(() => expect(within(tile()).getByText('0')).toBeInTheDocument());
    // The attention line appends a count only when there IS one.
    expect(screen.queryByText(/\d+ awaiting approval/i)).toBeNull();
  });

  it('no longer labels the count "supervisors", since it may be neither', async () => {
    await mount({ observers: [OBS] });
    await waitFor(() => expect(screen.getByText(/1 awaiting approval/i)).toBeInTheDocument());
    expect(screen.queryByText(/pending supervisor/i)).toBeNull();
  });
});
