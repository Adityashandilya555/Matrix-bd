// skipcq: JS-0833
// The Financial Closure queue had no tests, which is how three defects stacked up
// unnoticed: the header scrolled independently of its rows, money rendered in
// western grouping with no currency symbol, and the CLOSURE STATUS column looked
// its value up in the wrong vocabulary so every lookup missed.
//
// The width assertion below is the durable one. PR #458 widened the Variation
// column 130 -> 160 to fix it looking "cramped" and pushed the grid further past
// the viewport; a test that sums the track minima is what catches the next one.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getFCQueue = vi.fn();
vi.mock('../../../services/api/financialClosureApi.js', () => ({ getFCQueue: (...a) => getFCQueue(...a) }));
vi.mock('../../../state/SessionContext.jsx', () => ({ useSession: () => ({ role: 'supervisor' }) }));
vi.mock('../../../hooks/useSiteDataRefresh.js', () => ({ useSiteDataRefresh: () => {} }));
// useFocusSite calls useLocation — mocking react-router-dom without it throws.
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/financial-closure', search: '', hash: '', state: null }),
}));

import FinancialClosureQueuePage from '../FinancialClosureQueuePage.jsx';

// getFCQueue is mocked, so these are the ALREADY-ADAPTED camelCase rows the real
// adapter (financialClosureApi.queueItemFromServer) hands the page — not raw
// snake_case from the wire.
const row = (over = {}) => ({
  siteId: 's1', siteCode: '201', siteName: 'Test_Site', city: 'Begusarai',
  closureStatus: 'approved', financialClosureStatus: 'closed',
  allocatedToName: null, submittedByName: 'Asha',
  gfcBudgetTotal: 145000, closureBudgetTotal: 140000, variationTotal: -5000,
  ...over,
});

const renderQueue = async (rows = [row()]) => {
  getFCQueue.mockResolvedValue({ items: rows, total: rows.length });
  const view = render(<FinancialClosureQueuePage />);
  await screen.findByText('Test_Site');
  return view;
};

// The header is the grid that carries the column labels; the rows carry data.
const gridsOf = (container) => {
  const header = screen.getByText('Closure status').closest('div');
  const dataRow = container.querySelector('.zm-row');
  return { header, dataRow };
};

beforeEach(() => { getFCQueue.mockReset(); });

describe('FinancialClosureQueuePage — the table fits its card', () => {
  it('scrolls horizontally on the CARD, not the body, so the header travels with the rows', async () => {
    const { container } = await renderQueue();
    const card = container.querySelector('.zm-glass');
    expect(card.style.overflowX).toBe('auto');

    // The body must NOT also scroll horizontally, or it desyncs from the header.
    const scrollBody = container.querySelector('.zm-row').parentElement;
    expect(scrollBody.style.overflowX).not.toBe('auto');
  });

  it('pins header and rows to the same minimum width', async () => {
    const { container } = await renderQueue();
    const { header, dataRow } = gridsOf(container);
    expect(header.style.minWidth).not.toBe('');
    expect(header.style.minWidth).toBe(dataRow.style.minWidth);
  });

  it('keeps the grid inside a 1280 viewport beside the sidebar', async () => {
    // 1280 viewport − 232 sidebar − 64 main padding ≈ 984 usable; allow 1024.
    const { container } = await renderQueue();
    const { header } = gridsOf(container);
    const tracks = header.style.gridTemplateColumns;

    const total = tracks.split(/\s+(?![^(]*\))/).reduce((sum, track) => {
      const minmax = track.match(/^minmax\((\d+(?:\.\d+)?)px/);      // its floor
      if (minmax) return sum + Number(minmax[1]);
      const px = track.match(/^(\d+(?:\.\d+)?)px$/);
      return px ? sum + Number(px[1]) : sum;                          // 1fr adds 0
    }, 0);
    const gaps = 6 * 12;
    const padding = 32;

    expect(total + gaps + padding).toBeLessThanOrEqual(1024);
  });
});

describe('FinancialClosureQueuePage — money reads like the rest of the app', () => {
  it('formats totals as Indian-grouped rupees', async () => {
    await renderQueue([row({ gfcBudgetTotal: 1000001690 })]);
    expect(screen.getByText('₹1,00,00,01,690')).toBeInTheDocument();
    // ...and not the old locale-less western grouping.
    expect(screen.queryByText('1,000,001,690')).toBeNull();
  });

  it('shows an em dash for a missing total — never ₹0, never ASCII "-"', async () => {
    // formatINR(null) returns ₹0 because Number(null) is 0 and finite. On a
    // financial screen that would read "closed at zero" instead of "not entered".
    const { container } = await renderQueue([
      row({ gfcBudgetTotal: 145000, closureBudgetTotal: null, variationTotal: null }),
    ]);
    const cells = [...container.querySelectorAll('.zm-row > span')].map((n) => n.textContent);
    expect(cells).toContain('—');
    expect(cells).not.toContain('₹0');
    expect(cells).not.toContain('-');
  });

  it('signs the variation', async () => {
    await renderQueue([row({ variationTotal: -250000 })]);
    expect(screen.getByText('−₹2,50,000')).toBeInTheDocument();
  });
});

describe('FinancialClosureQueuePage — status column uses its own vocabulary', () => {
  it('never renders a raw budget-status token', async () => {
    // closure_status is site_budgets.status; the column used to be looked up in
    // STATUS_LABELS, which is keyed on sites.financial_closure_status, so every
    // lookup missed and the raw token fell through.
    await renderQueue([row({ closureStatus: 'pending_supervisor' })]);
    expect(screen.queryByText('pending_supervisor')).toBeNull();
    expect(screen.getByText('Supervisor')).toBeInTheDocument();
  });

  it('keeps the filter pills on the workflow status, which is a different field', async () => {
    await renderQueue([row({ closureStatus: 'pending_supervisor', financialClosureStatus: 'budgeting' })]);
    // The pill counts the workflow stage...
    await waitFor(() => expect(screen.getByText('Budgeting')).toBeInTheDocument());
    // ...while the column shows the budget row's own state. Both, at once.
    expect(screen.getByText('Supervisor')).toBeInTheDocument();
  });
});
