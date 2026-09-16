// skipcq: JS-0833
// The sidebar's Launch Approvals badge.
//
// The count has to come from the portal shell, not from the tab: the whole point
// is knowing how many sites need action WITHOUT opening the tab. It counts only
// the statuses where the ball is in the admin's court, so a queue full of sites
// parked with the executive or supervisor reads as zero rather than as work.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../services/api/authToken.js', () => ({ getAuthToken: () => 'a.token.here' }));
vi.mock('../jwt.js', () => ({ decodeJwtPayload: () => ({ workspace_name: 'Acme' }) }));

const TeamDashboard = (await import('../TeamDashboard.jsx')).default;

const emptyList = () => Promise.resolve([]);

const item = (over = {}) => ({
  site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai',
  status: 'pending_admin_review', ...over,
});

const mount = (launchItems) => {
  const listLaunchQueue = vi.fn(() => Promise.resolve({ items: launchItems }));
  const fetchers = {
    listDeliverables: emptyList, listGfc: emptyList, listFinance: emptyList,
    listBudget: emptyList, listQualityAudit: emptyList, listClosure: emptyList,
    listExecutiveReqs: emptyList, listOrg: emptyList, listSites: emptyList,
    listSupervisors: emptyList, listPendingObservers: emptyList, listActiveObservers: emptyList,
    getObserverCode: () => Promise.resolve('ABC12345'),
    listLaunchQueue,
  };
  render(<TeamDashboard onLogout={vi.fn()} fetchers={fetchers} workspaceName="Acme" />);
  return listLaunchQueue;
};

const navItem = async () => (await screen.findByRole('button', { name: /Launch Approvals/i }));

beforeEach(() => { vi.clearAllMocks(); });

describe('Launch Approvals sidebar badge', () => {
  it('counts the sites waiting on the admin', async () => {
    mount([
      item(),
      item({ site_id: 's2', status: 'pending_admin_final' }),
      item({ site_id: 's3', status: 'ready_to_launch' }),
    ]);

    await waitFor(async () => expect(within(await navItem()).getByText('3')).toBeTruthy());
  });

  it('ignores sites parked with the executive, the supervisor, or already launched', async () => {
    const listLaunchQueue = mount([
      item({ status: 'under_exec_review' }),
      item({ site_id: 's2', status: 'under_supervisor_review' }),
      item({ site_id: 's3', status: 'launched' }),
    ]);

    // Nothing actionable — the item renders without a badge at all.
    await waitFor(() => expect(listLaunchQueue).toHaveBeenCalled());
    expect(within(await navItem()).queryByText(/^[0-9]+$/)).toBeNull();
  });

  it('renders the item without a badge when the queue cannot be read', async () => {
    // No listLaunchQueue in the injected set (the dev preview's shape).
    render(<TeamDashboard onLogout={vi.fn()} workspaceName="Acme" fetchers={{
      listDeliverables: emptyList, listGfc: emptyList, listFinance: emptyList,
      listBudget: emptyList, listQualityAudit: emptyList, listClosure: emptyList,
      listExecutiveReqs: emptyList, listOrg: emptyList, listSites: emptyList,
      listSupervisors: emptyList, listPendingObservers: emptyList, listActiveObservers: emptyList,
      getObserverCode: () => Promise.resolve('ABC12345'),
    }} />);

    expect(within(await navItem()).queryByText(/^[0-9]+$/)).toBeNull();
  });
});
