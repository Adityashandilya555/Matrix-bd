// skipcq: JS-0833
// Launch Sites: the CA code is what every tab shows, and the Financial Closure
// tab tells you who owes the next action.
//
// The code half is a regression guard. backend/_common.py's display_code exists
// because Launch once showed BT-BEG-XFDF for a site every other module called
// 201, and the Launched tab had drifted back to exactly that — the raw site_code
// — while ca_code sat unread on the same payload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getLaunchQueue, getFCQueue, getFC, listSites, onOpenSite, state } = vi.hoisted(() => ({
  getLaunchQueue: vi.fn(),
  getFCQueue: vi.fn(),
  getFC: vi.fn(),
  listSites: vi.fn(),
  onOpenSite: vi.fn(),
  state: { role: 'supervisor' },
}));

vi.mock('../../../services/api/launchApprovalApi.js', () => ({ getLaunchQueue }));
vi.mock('../../../services/api/financialClosureApi.js', () => ({ getFCQueue, getFC }));
vi.mock('../../../services/api/siteService.js', () => ({ listSites }));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn(), onOpenSite }) }));
vi.mock('../../../state/SessionContext.jsx', () => ({
  useSession: () => ({ role: state.role, user: { id: 'u1', name: 'Supervisor' } }),
}));

const launched = (over = {}) => ({
  site_id: 's1', site_code: 'BT-BAG-AS6B', ca_code: 'CA-293',
  site_name: 'Sainikpuri', city: 'Hyderabad', status: 'launched',
  launched_at: '2026-07-27T00:00:00Z', ...over,
});

// Mirrors queueItemFromServer in financialClosureApi.js — camelCase, because the
// adapter converts the wire payload before the page ever sees it. A snake_case
// fixture here is what let a tab that renders no rows pass its own tests.
const closure = (over = {}) => ({
  siteId: 'f1', siteCode: 'CA-301', siteName: 'Powai', city: 'Mumbai',
  financialClosureStatus: 'allocated', closureStatus: 'draft',
  allocatedToName: null, submittedByName: 'Creator',
  gfcBudgetTotal: null, closureBudgetTotal: null, variationTotal: null, ...over,
});

async function renderPage() {
  vi.resetModules();
  const { default: LaunchPage } = await import('../LaunchPage.jsx');
  return render(<LaunchPage />);
}

const openTab = async (user, name) => user.click(await screen.findByRole('button', { name: new RegExp(name, 'i') }));

beforeEach(() => {
  state.role = 'supervisor';
  listSites.mockResolvedValue({ items: [], total: 0 });
  getLaunchQueue.mockResolvedValue({ items: [launched()], total: 1 });
  getFCQueue.mockResolvedValue({ items: [], total: 0 });
  onOpenSite.mockReset();
  getFC.mockResolvedValue({ siteId: 'f9', siteCode: 'CA-301', siteName: 'Done one', city: 'Mumbai', closureStatus: 'approved', lines: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('Launch Sites — the code column', () => {
  it('shows the CA code on the Launched tab, not the internal site code', async () => {
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Launched');

    expect(await screen.findByText('CA-293')).toBeTruthy();
    expect(screen.queryByText('BT-BAG-AS6B')).toBeNull();
  });

  it('falls back to the site code when no CA code has been minted', async () => {
    getLaunchQueue.mockResolvedValue({ items: [launched({ ca_code: null })], total: 1 });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Launched');

    expect(await screen.findByText('BT-BAG-AS6B')).toBeTruthy();
  });

  it('treats an empty-string CA code as absent', async () => {
    // The write path normalises to `.strip().upper() or None`, but the API
    // pattern permits "", so an empty string can reach the client and must not
    // win over the real code.
    getLaunchQueue.mockResolvedValue({ items: [launched({ ca_code: '' })], total: 1 });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Launched');

    expect(await screen.findByText('BT-BAG-AS6B')).toBeTruthy();
  });
});

describe('Launch Sites — Financial Closure tab', () => {
  it('lists sites in closure', async () => {
    getFCQueue.mockResolvedValue({ items: [closure()], total: 1 });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');

    expect(await screen.findByText('Powai')).toBeTruthy();
    expect(screen.getByText('CA-301')).toBeTruthy();
  });

  it('names the delegated executive, and says Supervisor when not delegated', async () => {
    getFCQueue.mockResolvedValue({
      items: [
        closure({ siteId: 'f1', siteName: 'Delegated', allocatedToName: 'Priya S.' }),
        closure({ siteId: 'f2', siteName: 'Direct', allocatedToName: null }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');

    expect(await screen.findByText('Executive · Priya S. (delegated)')).toBeTruthy();
    expect(screen.getByText('Supervisor')).toBeTruthy();
  });

  it('reads pending-with off the BUDGET status once it is under review', async () => {
    // The budget status says whose desk it is on, and outranks the allocation:
    // the executive prepared it, but it is the admin who owes the next action.
    getFCQueue.mockResolvedValue({
      items: [closure({ closureStatus: 'pending_admin', allocatedToName: 'Priya S.' })],
      total: 1,
    });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');

    expect(await screen.findByText('Business Admin')).toBeTruthy();
    expect(screen.queryByText(/Priya S./)).toBeNull();
  });

  it('splits Pending from Closed and Closed excludes the in-flight stages', async () => {
    getFCQueue.mockResolvedValue({
      items: [
        closure({ siteId: 'f1', siteName: 'Open one', financialClosureStatus: 'open' }),
        closure({ siteId: 'f2', siteName: 'Budgeting one', financialClosureStatus: 'budgeting' }),
        closure({ siteId: 'f3', siteName: 'Done one', financialClosureStatus: 'closed', closureStatus: 'approved' }),
      ],
      total: 3,
    });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');

    // Pending is the default and holds the two in-flight rows.
    expect(await screen.findByText('Open one')).toBeTruthy();
    expect(screen.getByText('Budgeting one')).toBeTruthy();
    expect(screen.queryByText('Done one')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Closed/ }));

    await waitFor(() => expect(screen.getByText('Done one')).toBeTruthy());
    expect(screen.queryByText('Open one')).toBeNull();
  });

  it('searches on code, site and pending-with', async () => {
    getFCQueue.mockResolvedValue({
      items: [
        closure({ siteId: 'f1', siteName: 'Powai', allocatedToName: 'Priya S.' }),
        closure({ siteId: 'f2', siteName: 'Bagaha', siteCode: 'CA-999', allocatedToName: null }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');
    await screen.findByText('Powai');

    // Pending-with is part of the haystack, so "who owes this" is a way to find
    // a row rather than only something to read off one.
    await user.type(screen.getByLabelText(/Search code, site, city, pending with/i), 'priya');

    await waitFor(() => expect(screen.queryByText('Bagaha')).toBeNull());
    expect(screen.getByText('Powai')).toBeTruthy();
  });

  it('offers Details on a closed site, opening the closure record', async () => {
    // Details opens the CLOSURE record — the budget numbers the site drawer does
    // not carry. The site drawer is one hop further, from that drawer's footer.
    getFCQueue.mockResolvedValue({
      items: [closure({ siteId: 'f9', siteName: 'Done one', financialClosureStatus: 'closed', closureStatus: 'approved' })],
      total: 1,
    });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');
    await user.click(screen.getByRole('button', { name: /^Closed/ }));

    await user.click(await screen.findByRole('button', { name: /Details for Done one/i }));

    await waitFor(() => expect(getFC).toHaveBeenCalledWith('f9'));
    expect(await screen.findByRole('dialog', { name: /Financial closure details/i })).toBeTruthy();
  });

  it('does not offer Details while a closure is still moving', async () => {
    // Nothing to read yet, and the drawer says nothing about closure progress —
    // the row's own PENDING WITH is the thing to look at.
    getFCQueue.mockResolvedValue({ items: [closure({ siteName: 'Still open' })], total: 1 });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');
    await screen.findByText('Still open');

    expect(screen.queryByRole('button', { name: /Details for/i })).toBeNull();
  });

  it('shows an empty state rather than a bare table', async () => {
    getFCQueue.mockResolvedValue({ items: [], total: 0 });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Financial Closure');

    expect(await screen.findByText('No sites are in financial closure.')).toBeTruthy();
  });
});

describe('Launch Sites — search is per tab', () => {
  it('clears the needle when switching tabs', async () => {
    // Each tab searches a different list, so carrying a needle across would
    // silently filter a table the user has not typed into.
    getLaunchQueue.mockResolvedValue({
      items: [launched(), launched({ site_id: 's2', ca_code: 'CA-400', site_name: 'Big Chill' })],
      total: 2,
    });
    getFCQueue.mockResolvedValue({ items: [closure({ siteName: 'Powai' })], total: 1 });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Launched');
    await user.type(screen.getByLabelText(/Search code, site, city/i), 'big');
    await waitFor(() => expect(screen.queryByText('Sainikpuri')).toBeNull());

    await openTab(user, 'Financial Closure');

    expect(screen.getByLabelText(/Search code, site, city, pending with/i).value).toBe('');
    expect(await screen.findByText('Powai')).toBeTruthy();
  });
});

describe('Launch Sites — Launched tab search', () => {
  it('narrows the launched list, which it previously could not do', async () => {
    getLaunchQueue.mockResolvedValue({
      items: [launched(), launched({ site_id: 's2', ca_code: 'CA-400', site_name: 'Big Chill' })],
      total: 2,
    });
    const user = userEvent.setup();
    await renderPage();
    await openTab(user, 'Launched');
    await screen.findByText('Sainikpuri');

    await user.type(screen.getByLabelText(/Search code, site, city/i), 'big');

    await waitFor(() => expect(screen.queryByText('Sainikpuri')).toBeNull());
    expect(screen.getByText('Big Chill')).toBeTruthy();
  });
});
