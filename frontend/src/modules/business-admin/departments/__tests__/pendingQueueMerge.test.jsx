// skipcq: JS-0833
// One "Awaiting approval" queue for everyone waiting to get in.
//
// Pending observers shipped in a second queue inside the Observer access
// section, further down the tab. Two queues split one question — "who is
// waiting?" — across two places, and the lower one is under a heading nobody
// scrolls to. These tests pin the merge, and the thing the merge must not break:
// the two roles have different approval endpoints and must keep them.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DepartmentsTab from '../DepartmentsTab.jsx';

const SUP = { id: 's1', email: 'sup@example.com', module: 'bd', createdAt: '2026-08-01T10:00:00Z' };
const OBS = { id: 'o1', email: 'obs@example.com', createdAt: '2026-08-02T10:00:00Z' };

const ready = (items = []) => ({ status: 'ready', items, error: null, refreshing: false });

let handlers;

const renderTab = (props = {}) => render(
  <DepartmentsTab
    org={ready([])}
    pendingSupervisors={ready([SUP])}
    executiveRequests={ready([])}
    observers={{ code: 'ABC12345', pending: ready([OBS]), roster: ready([]) }}
    handlers={handlers}
    {...props}
  />,
);

const queue = () => screen.getByRole('heading', { name: /awaiting approval/i })
  .closest('section');

beforeEach(() => {
  handlers = {
    onApprovePending: vi.fn(),
    onRejectPending: vi.fn(),
    onApproveExecutiveReq: vi.fn(),
    onRejectExecutiveReq: vi.fn(),
    onRotate: vi.fn(),
    onRemoveUser: vi.fn(),
    onRotateObserverCode: vi.fn(),
    onRevokeObserver: vi.fn(),
    reloadOrg: vi.fn(),
    reloadPendingSupervisors: vi.fn(),
    reloadExecutiveRequests: vi.fn(),
    reloadObservers: vi.fn(),
  };
});

describe('Awaiting approval — one queue', () => {
  it('lists a pending supervisor and a pending observer together', () => {
    renderTab();
    expect(within(queue()).getByText('sup@example.com')).toBeInTheDocument();
    expect(within(queue()).getByText('obs@example.com')).toBeInTheDocument();
  });

  it('counts both in the section header', () => {
    renderTab();
    const header = within(queue()).getByRole('heading', { name: /awaiting approval/i }).parentElement;
    expect(within(header).getByText('2')).toBeInTheDocument();
  });

  it('counts both on the All tab', () => {
    // The header badge and the tab badge are computed separately — one counting
    // the merged list and the other not would be a quietly wrong number.
    renderTab();
    const allTab = within(queue()).getByRole('tab', { name: /^all/i });
    expect(within(allTab).getByText('2')).toBeInTheDocument();
  });

  it('labels the observer row so the two are told apart', () => {
    // The module chip is what distinguishes a BD supervisor from a Legal one;
    // an observer has no module, so the same slot names the role instead.
    renderTab();
    expect(within(queue()).getByText('observer')).toBeInTheDocument();
  });

  it('filters to observers only', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(within(queue()).getByRole('tab', { name: /observer/i }));
    expect(within(queue()).queryByText('sup@example.com')).toBeNull();
    expect(within(queue()).getByText('obs@example.com')).toBeInTheDocument();
  });

  it('filters to a department without dragging observers along', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(within(queue()).getByRole('tab', { name: /^bd/i }));
    expect(within(queue()).getByText('sup@example.com')).toBeInTheDocument();
    expect(within(queue()).queryByText('obs@example.com')).toBeNull();
  });
});

describe('Awaiting approval — the two roles keep their own endpoints', () => {
  // The whole risk of merging the queues. Approving a supervisor also writes a
  // user_module_memberships row; approving an observer must NOT (an observer is
  // workspace-wide and holds no membership). One list, two dispatches.
  it('tags an observer row as an observer', async () => {
    const user = userEvent.setup();
    renderTab({ pendingSupervisors: ready([]) });
    await user.click(within(queue()).getByRole('button', { name: /approve/i }));
    expect(handlers.onApprovePending).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', kind: 'observer' }),
    );
  });

  it('tags a supervisor row as a supervisor, module intact', async () => {
    const user = userEvent.setup();
    renderTab({ observers: { code: null, pending: ready([]), roster: ready([]) } });
    await user.click(within(queue()).getByRole('button', { name: /approve/i }));
    expect(handlers.onApprovePending).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', kind: 'supervisor', module: 'bd' }),
    );
  });

  it('routes reject the same way', async () => {
    const user = userEvent.setup();
    renderTab({ pendingSupervisors: ready([]) });
    await user.click(within(queue()).getByRole('button', { name: /reject/i }));
    expect(handlers.onRejectPending).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', kind: 'observer' }),
    );
  });
});

describe('Awaiting approval — when one source queue fails', () => {
  const obsDown = { code: null, roster: ready([]), pending: { status: 'error', error: 'Observers failed', items: [] } };

  it('still shows the rows it does have', () => {
    // Blanking them would let an outage in the observer endpoint block
    // supervisor approvals — an unrelated queue taking the section down.
    renderTab({ observers: obsDown });
    expect(within(queue()).getByText('sup@example.com')).toBeInTheDocument();
  });

  it('says the list is incomplete rather than letting it read as complete', () => {
    // A short list that looks complete is how someone concludes nobody is
    // waiting and closes the tab.
    renderTab({ observers: obsDown });
    expect(within(queue()).getByText(/pending observers could not be loaded/i)).toBeInTheDocument();
  });

  it('names the side that failed, not just "something"', () => {
    renderTab({
      pendingSupervisors: { status: 'error', error: 'Supervisors failed', items: [] },
    });
    expect(within(queue()).getByText(/pending supervisors could not be loaded/i)).toBeInTheDocument();
    expect(within(queue()).getByText('obs@example.com')).toBeInTheDocument();
  });

  it('is a real error only when both are down', () => {
    renderTab({
      pendingSupervisors: { status: 'error', error: 'Supervisors failed', items: [] },
      observers: obsDown,
    });
    expect(within(queue()).getByText('Supervisors failed')).toBeInTheDocument();
    expect(within(queue()).queryByRole('tab')).toBeNull();
  });

  it('says nothing about incompleteness on the happy path', () => {
    renderTab();
    expect(within(queue()).queryByText(/could not be loaded/i)).toBeNull();
  });
});

describe('the Observer access section keeps only what it owns', () => {
  it('still shows the code and the roster', () => {
    renderTab({ observers: { code: 'ABC12345', pending: ready([]), roster: ready([{ id: 'u9', email: 'ravi@example.com' }]) } });
    const section = screen.getByRole('heading', { name: /observer access/i }).closest('section');
    expect(within(section).getByText('ravi@example.com')).toBeInTheDocument();
  });

  it('no longer carries a second approval queue', () => {
    renderTab();
    const section = screen.getByRole('heading', { name: /observer access/i }).closest('section');
    expect(within(section).queryByText('obs@example.com')).toBeNull();
  });
});

describe('the observer portal renders this tab read-only', () => {
  it('drops the queue entirely rather than showing it empty', () => {
    // An empty "Awaiting approval" implies this role could clear it.
    render(
      <DepartmentsTab org={ready([])} pendingSupervisors={ready([])}
        executiveRequests={ready([])} handlers={handlers} readOnly />,
    );
    expect(screen.queryByRole('heading', { name: /awaiting approval/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /observer access/i })).toBeNull();
  });

  it('survives the observers prop being absent', () => {
    render(
      <DepartmentsTab org={ready([])} pendingSupervisors={ready([])}
        executiveRequests={ready([])} handlers={handlers} readOnly />,
    );
    expect(screen.getByRole('heading', { name: /departments/i })).toBeInTheDocument();
  });
});
