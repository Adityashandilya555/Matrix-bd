// skipcq: JS-0833
// A budget whose amounts were never persisted reaches the admin as ₹0 and
// eleven em-dashes — visually identical to one that is still loading, and the
// panel happily let it be approved. Approving writes the gfc baseline that every
// Financial Closure variation is later measured against.
//
// These reproduce the reported card exactly: 11 labelled lines, every amount
// null, no areas, status pending_admin.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import SiteApprovalPanel from '../SiteApprovalPanel.jsx';

const LABELS = [
  'Professional Fees', 'HVAC', 'Furniture, Light & Planters', 'Civil & Interiors',
  'Kitchen Equipment', 'Branding', 'Crockery & Small Equipments', 'Utilities',
  'Licencing', 'BD Cost', 'Misc',
];

const lines = (amount) => LABELS.map((label, i) => ({ idx: i + 1, label, amount }));

function renderBudget(detail, { fetchDetail } = {}) {
  const handlers = {
    fetchBudgetDetail: fetchDetail || vi.fn(async () => detail),
    fetchBudgetDocuments: vi.fn(async () => []),
    onBudgetDecide: vi.fn(),
  };
  render(<SiteApprovalPanel site={{ siteId: 's1', project: {} }} handlers={handlers} />);
  return handlers;
}

describe('the PE budget gate', () => {
  it('blocks approval and explains why when no amounts were saved', async () => {
    renderBudget({
      submittedByName: 'aditya8', budgetStatus: 'pending_admin',
      items: lines(null), budgetTotal: null,
      totalIndoorAreaSqft: null, totalAreaSqft: null, covers: null,
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/no amounts were saved/i);
    expect(screen.getByRole('button', { name: /approve budget/i })).toBeDisabled();
    // Send back is the remedy — gating it would strand the site.
    expect(screen.getByRole('button', { name: /send back/i })).toBeEnabled();
  });

  it('allows approval once a single line carries a value', async () => {
    renderBudget({
      budgetStatus: 'pending_admin',
      items: [{ idx: 1, label: 'Professional Fees', amount: 5000 }, ...lines(null).slice(1)],
      budgetTotal: 5000,
    });

    expect(await screen.findByText(/1\. Professional Fees/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve budget/i })).toBeEnabled();
    });
    expect(screen.queryByText(/no amounts were saved/i)).toBeNull();
  });

  it('treats a genuine zero as a real amount, not an unfilled one', async () => {
    renderBudget({
      budgetStatus: 'pending_admin',
      items: [{ idx: 1, label: 'Professional Fees', amount: 0 }, ...lines(null).slice(1)],
      budgetTotal: 0,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve budget/i })).toBeEnabled();
    });
  });

  it('does not accuse the budget of being empty when the fetch failed', async () => {
    // detail is unknown, not known-empty — blocking here would strand a request
    // whose backend is merely unreachable.
    renderBudget(null, { fetchDetail: vi.fn(async () => { throw new Error('boom'); }) });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve budget/i })).toBeEnabled();
    });
    expect(screen.queryByText(/no amounts were saved/i)).toBeNull();
  });
});

describe('the financial-closure gate', () => {
  const closure = (closureAmount) => ({
    siteId: 's1', closureStatus: 'pending_admin',
    lines: LABELS.map((label, i) => ({ idx: i + 1, label, gfcAmount: 100, closureAmount, variation: null })),
  });

  function renderClosure(detail) {
    const handlers = {
      fetchClosureDetail: vi.fn(async () => detail),
      fetchClosureDocuments: vi.fn(async () => []),
      fetchClosureQAReports: vi.fn(async () => ({ before: null, after: null })),
      onClosureFinalize: vi.fn(),
    };
    render(<SiteApprovalPanel site={{ siteId: 's1', financialClosure: {} }} handlers={handlers} />);
    return handlers;
  }

  it('blocks the terminal finalize when no actuals were entered', async () => {
    renderClosure(closure(null));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no amounts were saved/i);
    expect(screen.getByRole('button', { name: /financial closure/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send back/i })).toBeEnabled();
  });

  it('allows finalize once actuals are present', async () => {
    renderClosure(closure(120));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /financial closure/i })).toBeEnabled();
    });
  });
});
