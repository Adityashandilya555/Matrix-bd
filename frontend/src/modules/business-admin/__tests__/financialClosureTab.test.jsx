// skipcq: JS-0833
// Financial Closure in the Business Admin portal.
//
// It reads /financial-closure/admin-queue, not the /queue the BD tab uses: that
// one scopes an executive to their own allocations, which would silently hide
// rows from an admin who is meant to see the whole tenant. Details likewise
// reads admin-detail, since the supervisor-facing detail endpoint would 403.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getFCAdminQueue, getFCAdminDetail, getFCQueue, getFC } = vi.hoisted(() => ({
  getFCAdminQueue: vi.fn(),
  getFCAdminDetail: vi.fn(),
  getFCQueue: vi.fn(),
  getFC: vi.fn(),
}));

vi.mock('../../../services/api/financialClosureApi.js', () => ({
  getFCAdminQueue, getFCAdminDetail, getFCQueue, getFC,
}));

const row = (over = {}) => ({
  siteId: 'f1', siteCode: 'CA-301', siteName: 'Powai', city: 'Mumbai',
  financialClosureStatus: 'allocated', closureStatus: 'draft',
  allocatedToName: null, gfcBudgetTotal: null, closureBudgetTotal: null,
  variationTotal: null, ...over,
});

async function renderTab() {
  vi.resetModules();
  const { default: FinancialClosureTab } = await import('../closure/FinancialClosureTab.jsx');
  return render(<FinancialClosureTab />);
}

beforeEach(() => {
  getFCAdminQueue.mockReset();
  getFCAdminDetail.mockReset();
  getFCQueue.mockReset();
  getFC.mockReset();
  getFCAdminQueue.mockResolvedValue({ items: [row()], total: 1 });
  getFCAdminDetail.mockResolvedValue({
    siteId: 'f1', siteCode: 'CA-301', siteName: 'Powai', city: 'Mumbai',
    closureStatus: 'approved', lines: [],
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Business Admin — Financial Closure tab', () => {
  it('reads the admin queue, never the executive-scoped one', async () => {
    await renderTab();
    await waitFor(() => expect(getFCAdminQueue).toHaveBeenCalled());
    expect(getFCQueue).not.toHaveBeenCalled();
  });

  it('lists closures with who owes the next action', async () => {
    getFCAdminQueue.mockResolvedValue({
      items: [
        row({ siteId: 'f1', siteName: 'Delegated', allocatedToName: 'Priya S.' }),
        row({ siteId: 'f2', siteName: 'Direct' }),
        row({ siteId: 'f3', siteName: 'With admin', closureStatus: 'pending_admin' }),
      ],
      total: 3,
    });
    await renderTab();

    expect(await screen.findByText('Executive · Priya S. (delegated)')).toBeTruthy();
    expect(screen.getByText('Supervisor')).toBeTruthy();
    expect(screen.getByText('Business Admin')).toBeTruthy();
  });

  it('splits Pending from Closed', async () => {
    getFCAdminQueue.mockResolvedValue({
      items: [
        row({ siteId: 'f1', siteName: 'Open one', financialClosureStatus: 'open' }),
        row({ siteId: 'f2', siteName: 'Done one', financialClosureStatus: 'closed', closureStatus: 'approved' }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    await renderTab();
    await screen.findByText('Open one');
    expect(screen.queryByText('Done one')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Closed/ }));

    await waitFor(() => expect(screen.getByText('Done one')).toBeTruthy());
    expect(screen.queryByText('Open one')).toBeNull();
  });

  it('searches across code, site and pending with', async () => {
    getFCAdminQueue.mockResolvedValue({
      items: [
        row({ siteId: 'f1', siteName: 'Powai', allocatedToName: 'Priya S.' }),
        row({ siteId: 'f2', siteName: 'Bagaha', siteCode: 'CA-999' }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    await renderTab();
    await screen.findByText('Powai');

    await user.type(screen.getByLabelText(/Search by name, code, city, or pending with/i), 'priya');

    await waitFor(() => expect(screen.queryByText('Bagaha')).toBeNull());
    expect(screen.getByText('Powai')).toBeTruthy();
  });

  it('opens details through the ADMIN detail endpoint', async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(await screen.findByRole('button', { name: /Details for Powai/i }));

    await waitFor(() => expect(getFCAdminDetail).toHaveBeenCalledWith('f1'));
    // The supervisor-facing endpoint would 403 for an admin.
    expect(getFC).not.toHaveBeenCalled();
  });

  it('offers Details on every row, not just closed ones', async () => {
    // Unlike the BD tab, the admin is the one who finalises a closure, so the
    // record is worth reading while it is still moving.
    await renderTab();
    expect(await screen.findByRole('button', { name: /Details for Powai/i })).toBeTruthy();
  });

  it('surfaces a load failure with a retry', async () => {
    getFCAdminQueue.mockRejectedValue({ detail: 'boom' });
    await renderTab();
    expect(await screen.findByText('boom')).toBeTruthy();
  });

  it('shows an empty state when nothing is in closure', async () => {
    getFCAdminQueue.mockResolvedValue({ items: [], total: 0 });
    await renderTab();
    expect(await screen.findByText('No sites are in financial closure.')).toBeTruthy();
  });
});
