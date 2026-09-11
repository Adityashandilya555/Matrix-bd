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

const { getFC } = vi.hoisted(() => ({ getFC: vi.fn() }));
vi.mock('../../../services/api/financialClosureApi.js', () => ({ getFC }));

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

beforeEach(() => {
  getFC.mockReset();
  getFC.mockResolvedValue(record());
});
afterEach(() => vi.restoreAllMocks());

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

  it('hands off to the site record for documents', async () => {
    const onOpenSiteRecord = vi.fn();
    const user = userEvent.setup();
    renderDrawer({ onOpenSiteRecord });
    await screen.findByText('Powai', { exact: false });

    await user.click(screen.getByRole('button', { name: /Documents & site record/i }));

    expect(onOpenSiteRecord).toHaveBeenCalledWith('f1');
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
