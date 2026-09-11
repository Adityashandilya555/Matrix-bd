// skipcq: JS-0833
// Financial Closure in the Business Admin portal.
//
// The endpoint choice is the thing worth pinning. It reads /financial-closure/
// queue, which lists every opened closure — NOT admin-queue, which despite its
// name filters to budgets with status 'pending_admin' and so never returns a
// closed site, leaving the Closed view permanently empty.
//
// /queue narrows by allocation only for an EXECUTIVE, so an admin gets the whole
// tenant. Detail reads admin-detail, which has no status filter.
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
  getClosureQAReports: vi.fn(async () => ({ before: null, after: null })),
}));
vi.mock('../../../services/api/businessAdminApi.js', () => ({
  getAdminSiteDocuments: vi.fn(async () => ({ documents: [] })),
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
  getFCQueue.mockResolvedValue({ items: [row()], total: 1 });
  getFCAdminQueue.mockResolvedValue({ items: [], total: 0 });
  getFCAdminDetail.mockResolvedValue({
    siteId: 'f1', siteCode: 'CA-301', siteName: 'Powai', city: 'Mumbai',
    closureStatus: 'approved', lines: [],
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Business Admin — Financial Closure tab', () => {
  it('reads the full closure list, never the pending-admin action queue', async () => {
    // admin-queue filters to status='pending_admin'. Using it here would make
    // the Closed pill permanently empty and drop every in-flight closure that
    // is not currently awaiting the admin.
    await renderTab();
    await waitFor(() => expect(getFCQueue).toHaveBeenCalled());
    expect(getFCAdminQueue).not.toHaveBeenCalled();
  });

  it('lists closures with who owes the next action', async () => {
    getFCQueue.mockResolvedValue({
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
    getFCQueue.mockResolvedValue({
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
    getFCQueue.mockResolvedValue({
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
    getFCQueue.mockRejectedValue({ detail: 'boom' });
    await renderTab();
    expect(await screen.findByText('boom')).toBeTruthy();
  });

  it('shows an empty state when nothing is in closure', async () => {
    getFCQueue.mockResolvedValue({ items: [], total: 0 });
    await renderTab();
    expect(await screen.findByText('No sites are in financial closure.')).toBeTruthy();
  });
});
