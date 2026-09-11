// skipcq: JS-0833
// Search on the Business Admin launch-approval queue.
//
// It composes WITH the status chips rather than replacing them — pick a status,
// then narrow within it — and the chip counts respect the search, or they would
// advertise rows the table is not showing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getLaunchQueue } = vi.hoisted(() => ({ getLaunchQueue: vi.fn() }));

vi.mock('../../../services/api/financialClosureApi.js', () => ({ sendForFinancialClosure: vi.fn() }));
vi.mock('../../../services/api/businessAdminApi.js', () => ({ getAdminSiteDocuments: vi.fn() }));
vi.mock('../../../services/api/launchApprovalApi.js', () => ({
  getLaunchQueue,
  getLaunchApproval: vi.fn(), saveLaunchRentFields: vi.fn(),
  sendForReview: vi.fn(), finalConfirm: vi.fn(), launchSite: vi.fn(),
}));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));

const row = (over = {}) => ({
  site_id: 's1', site_code: 'BT-HYD-1', ca_code: 'CA-293',
  site_name: 'Sainikpuri', city: 'Hyderabad', status: 'pending_admin_review',
  updated_at: '2026-07-27T00:00:00Z', ...over,
});

async function renderTab() {
  vi.resetModules();
  const { default: LaunchApprovalTab } = await import('../launch/LaunchApprovalTab.jsx');
  return render(<LaunchApprovalTab />);
}

const search = () => screen.getByLabelText(/Search sites by name, code, or city/i);

beforeEach(() => {
  getLaunchQueue.mockReset();
  getLaunchQueue.mockResolvedValue({
    items: [
      row(),
      row({ site_id: 's2', ca_code: 'CA-400', site_name: 'Powai', city: 'Mumbai' }),
      row({ site_id: 's3', ca_code: 'CA-500', site_name: 'Bagaha', city: 'Patna', status: 'launched' }),
    ],
    total: 3,
  });
});
afterEach(() => vi.restoreAllMocks());

describe('LaunchApprovalTab — search', () => {
  it('narrows the queue by site name', async () => {
    const user = userEvent.setup();
    await renderTab();
    await screen.findByText('Sainikpuri');

    await user.type(search(), 'powai');

    await waitFor(() => expect(screen.queryByText('Sainikpuri')).toBeNull());
    expect(screen.getByText('Powai')).toBeTruthy();
  });

  it('matches on the CA code', async () => {
    const user = userEvent.setup();
    await renderTab();
    await screen.findByText('Sainikpuri');

    await user.type(search(), 'CA-400');

    await waitFor(() => expect(screen.queryByText('Sainikpuri')).toBeNull());
    expect(screen.getByText('Powai')).toBeTruthy();
  });

  it('composes with the status chips instead of overriding them', async () => {
    const user = userEvent.setup();
    await renderTab();
    await screen.findByText('Bagaha');

    // ^ anchors to the status chip: a launched ROW is also a button, and its
    // accessible name contains 'Launched' too — but starts with the site code.
    await user.click(screen.getByRole('button', { name: /^Launched/ }));
    await waitFor(() => expect(screen.queryByText('Sainikpuri')).toBeNull());

    // Bagaha is the only launched row; searching for a row in another status
    // must not pull it back across the status filter.
    await user.type(search(), 'powai');
    await waitFor(() => expect(screen.queryByText('Bagaha')).toBeNull());
    expect(screen.queryByText('Powai')).toBeNull();
  });

  it('says the search emptied the table, not that nothing exists', async () => {
    const user = userEvent.setup();
    await renderTab();
    await screen.findByText('Sainikpuri');

    await user.type(search(), 'zzzz');

    expect(await screen.findByText('No sites match your search.')).toBeTruthy();
  });
});
