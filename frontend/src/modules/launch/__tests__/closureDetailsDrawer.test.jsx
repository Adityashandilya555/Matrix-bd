// skipcq: JS-0833
// ClosureDetailsDrawer — the closure's own numbers, which the site drawer does
// not carry: GFC baseline vs closure actual, the variation, the budget lines
// behind the totals, the derived metrics, and the agreed rent.
//
// The money guard matters most here. formatINR(null) is ₹0, because Number(null)
// is 0 and finite — on a financial screen a missing figure must not read as
// "zero rupees", so every amount goes through a null check first.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClosureDetailsDrawer from '../ClosureDetailsDrawer.jsx';

const { getFC, getClosureQAReports, getSiteDocuments } = vi.hoisted(() => ({
  getFC: vi.fn(),
  getClosureQAReports: vi.fn(),
  getSiteDocuments: vi.fn(),
}));
vi.mock('../../../services/api/financialClosureApi.js', () => ({ getFC, getClosureQAReports }));
vi.mock('../../../services/api/siteService.js', () => ({ getSiteDocuments }));

const record = (over = {}) => ({
  siteId: 'f1', siteCode: 'CA-301', siteName: 'Powai', city: 'Mumbai',
  closureStatus: 'approved', financialClosureStatus: 'closed',
  allocatedToName: 'Priya S.',
  gfcBudgetTotal: 1000000, closureBudgetTotal: 1250000, variationTotal: 250000,
  totalIndoorAreaSqft: 1000, totalAreaSqft: 1250, covers: 50,
  rentType: 'fixed', expectedRent: 205000, expectedEscalationPct: 15, expectedEscalationYears: 3,
  lines: [
    { idx: 1, label: 'Civil', gfcAmount: 400000, closureAmount: 500000, variation: 100000 },
    { idx: 2, label: 'MEP', gfcAmount: 600000, closureAmount: 750000, variation: 150000 },
  ],
  supervisorComments: 'Overrun on civil, approved.',
  adminComments: null,
  ...over,
});

const renderDrawer = (props = {}) =>
  render(<ClosureDetailsDrawer siteId="f1" onClose={vi.fn()} onOpenSiteRecord={vi.fn()} {...props} />);

const doc = (over = {}) => ({
  id: 'd1', fileName: 'loi-signed.pdf', fileType: 'loi',
  uploadedAt: '2026-04-02T10:00:00Z', url: 'https://x/loi.pdf', ...over,
});

const qa = (over = {}) => ({
  siteId: 'f1',
  before: { kind: 'before', fileName: 'before.pdf', downloadUrl: 'https://x/before.pdf' },
  after: { kind: 'after', fileName: 'after.pdf', downloadUrl: 'https://x/after.pdf' },
  ...over,
});

const openDocuments = (user) => user.click(screen.getByRole('button', { name: /^Documents/ }));

beforeEach(() => {
  getFC.mockReset();
  getClosureQAReports.mockReset();
  getSiteDocuments.mockReset();
  getFC.mockResolvedValue(record());
  getSiteDocuments.mockResolvedValue({ documents: [doc()] });
  getClosureQAReports.mockResolvedValue(qa());
});
afterEach(() => vi.restoreAllMocks());

describe('ClosureDetailsDrawer — floats free of its mount point', () => {
  // The bug: the admin shell wraps every tab panel in `.ac-fade-in`, whose
  // keyframes animate transform with fill-mode: both. The animation keeps
  // applying after it ends, so the wrapper is permanently a containing block for
  // fixed descendants and the drawer was sized and clipped to the panel instead
  // of the viewport. These pin the portal that escapes it.
  it('renders outside the element it was mounted into', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(<ClosureDetailsDrawer siteId="f1" onClose={vi.fn()} />, { container: host });

    const dialog = await screen.findByRole('dialog', { name: /Financial closure details/i });
    expect(host.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('is not trapped by an ancestor that establishes a containing block', async () => {
    // Reproduces the admin shell's wrapper directly.
    const trap = document.createElement('div');
    trap.style.transform = 'translateY(7px)';
    document.body.appendChild(trap);
    render(<ClosureDetailsDrawer siteId="f1" onClose={vi.fn()} />, { container: trap });

    const dialog = await screen.findByRole('dialog', { name: /Financial closure details/i });
    expect(trap.contains(dialog)).toBe(false);
  });

  it('carries the app theme across the portal', async () => {
    // Dark tokens are [data-theme="dark"] on an ancestor div, never on <html>.
    // A portal that drops the attribute renders the panel unthemed.
    const themed = document.createElement('div');
    themed.setAttribute('data-theme', 'dark');
    document.body.appendChild(themed);
    render(<ClosureDetailsDrawer siteId="f1" onClose={vi.fn()} />, { container: themed });

    const dialog = await screen.findByRole('dialog', { name: /Financial closure details/i });
    expect(dialog.closest('[data-theme="dark"]')).toBeTruthy();
  });
});

describe('ClosureDetailsDrawer — dialog behaviour', () => {
  it('moves focus into the panel and keeps Tab inside it', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const dialog = await screen.findByRole('dialog', { name: /Financial closure details/i });

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('locks the page behind while open and restores it on close', async () => {
    // Restores the PREVIOUS value, not '': another overlay may already have
    // locked it, and clobbering that would unlock the page underneath it.
    document.body.style.overflow = 'scroll';
    const { unmount } = renderDrawer();
    await screen.findByText('Powai', { exact: false });
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });
});

describe('ClosureDetailsDrawer', () => {
  it('shows the budget totals and the variation', async () => {
    renderDrawer();
    expect(await screen.findByText('₹10,00,000')).toBeTruthy();  // GFC baseline
    expect(screen.getByText('₹12,50,000')).toBeTruthy();          // closure actual
    expect(screen.getByText('+₹2,50,000')).toBeTruthy();          // variation, signed
  });

  it('lists the budget lines behind the totals', async () => {
    renderDrawer();
    expect(await screen.findByText('Civil')).toBeTruthy();
    expect(screen.getByText('MEP')).toBeTruthy();
    expect(screen.getByText('+₹1,50,000')).toBeTruthy();
  });

  it('derives the per-sqft and per-cover metrics', async () => {
    renderDrawer();
    // 1,250,000 / 1,000 indoor sqft, / 1,250 total sqft, / 50 covers.
    expect(await screen.findByText('₹1,250')).toBeTruthy();
    expect(screen.getByText('₹1,000')).toBeTruthy();
    expect(screen.getByText('₹25,000')).toBeTruthy();
  });

  it('summarises the agreed rent', async () => {
    renderDrawer();
    expect(await screen.findByText(/Fixed · ₹2,05,000\/mo · 15% every 3 yr/)).toBeTruthy();
  });

  it('shows a missing amount as a dash, never as zero rupees', async () => {
    getFC.mockResolvedValue(record({
      gfcBudgetTotal: null, closureBudgetTotal: null, variationTotal: null,
      totalIndoorAreaSqft: null, totalAreaSqft: null, covers: null, lines: [],
    }));
    renderDrawer();
    await screen.findByText('No budget lines were recorded.');
    expect(screen.queryByText('₹0')).toBeNull();
  });

  it('renders only the comments that exist', async () => {
    renderDrawer();
    expect(await screen.findByText('“Overrun on civil, approved.”')).toBeTruthy();
    expect(screen.queryByText('Business admin')).toBeNull();
  });

  it('no longer links out to the site record', async () => {
    // Documents live in this drawer now, so the footer went with them.
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    expect(screen.queryByRole('button', { name: /site record/i })).toBeNull();
  });

  it('surfaces a load failure instead of an empty shell', async () => {
    getFC.mockRejectedValue({ detail: 'Site not found' });
    renderDrawer();
    expect(await screen.findByText('Site not found')).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDrawer({ onClose });
    await screen.findByText('Powai', { exact: false });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});


describe('ClosureDetailsDrawer — Documents tab', () => {
  it('does not fetch documents until the tab is opened', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    expect(getSiteDocuments).not.toHaveBeenCalled();

    await openDocuments(user);
    await waitFor(() => expect(getSiteDocuments).toHaveBeenCalledWith('f1'));
  });

  it('lists documents and quality-audit reports together', async () => {
    // QA reports are not in site_files — they come from a second endpoint and
    // are flattened into the same list, which is the whole point of the tab.
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);

    expect(await screen.findByText('loi-signed.pdf')).toBeTruthy();
    expect(screen.getByText(/Before — before\.pdf/)).toBeTruthy();
    expect(screen.getByText(/After — after\.pdf/)).toBeTruthy();
    expect(screen.getByText(/Quality audit · 2/)).toBeTruthy();
  });

  it('still shows documents when the QA reports are forbidden', async () => {
    // The two surfaces have different reach, so one source failing must hide
    // only its own group rather than empty the tab.
    getClosureQAReports.mockRejectedValue({ status: 403 });
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);

    expect(await screen.findByText('loi-signed.pdf')).toBeTruthy();
    expect(screen.queryByText(/Quality audit/)).toBeNull();
  });

  it('still shows the QA reports when the documents list is forbidden', async () => {
    getSiteDocuments.mockRejectedValue({ status: 403 });
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);

    expect(await screen.findByText(/Before — before\.pdf/)).toBeTruthy();
    expect(screen.queryByText('loi-signed.pdf')).toBeNull();
  });

  it('opens a PDF in a new tab with noopener', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);
    await user.click(await screen.findByRole('button', { name: /Open loi-signed\.pdf/i }));

    expect(openSpy).toHaveBeenCalledWith('https://x/loi.pdf', '_blank', 'noopener,noreferrer');
  });

  it('previews an image in place instead of navigating away', async () => {
    getSiteDocuments.mockResolvedValue({
      documents: [doc({ id: 'd2', fileName: 'front.jpg', fileType: 'photo', url: 'https://x/front.jpg' })],
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);
    await user.click(await screen.findByRole('button', { name: /Open front\.jpg/i }));

    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('img[src="https://x/front.jpg"]')).toBeTruthy());
  });

  it('marks an unsignable document unavailable rather than a dead click', async () => {
    getSiteDocuments.mockResolvedValue({ documents: [doc({ url: null })] });
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);

    expect(await screen.findByText(/unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open loi-signed/i })).toBeNull();
  });

  it('uses the injected documents source, so the admin can read the richer list', async () => {
    const fetchDocuments = vi.fn().mockResolvedValue({ documents: [doc({ fileName: 'recce.pdf', fileType: 'design_recce' })] });
    const user = userEvent.setup();
    renderDrawer({ fetchDocuments });
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);

    await waitFor(() => expect(fetchDocuments).toHaveBeenCalledWith('f1'));
    expect(getSiteDocuments).not.toHaveBeenCalled();
    expect(await screen.findByText('recce.pdf')).toBeTruthy();
  });

  it('shows an empty state when the site has nothing attached', async () => {
    getSiteDocuments.mockResolvedValue({ documents: [] });
    getClosureQAReports.mockResolvedValue({ before: null, after: null });
    const user = userEvent.setup();
    renderDrawer();
    await screen.findByText('Powai', { exact: false });
    await openDocuments(user);

    expect(await screen.findByText(/No documents have been uploaded/i)).toBeTruthy();
  });
});
