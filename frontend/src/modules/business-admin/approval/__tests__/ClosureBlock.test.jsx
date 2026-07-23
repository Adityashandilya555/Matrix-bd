// skipcq: JS-0833
// #5b — when the project sends the closure budget to the admin, the admin's
// Financial Closure card must show the full 11 line items (GFC / actual /
// variation), the Project-Excellence + Closure attachments, and the before/
// after quality-audit report PDFs — not just the variation totals.
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import SiteApprovalPanel from '../SiteApprovalPanel.jsx';

const LABELS = [
  'Professional Fees', 'HVAC', 'Furniture, Light & Planters', 'Civil & Interiors',
  'Kitchen Equipment', 'Branding', 'Crockery & Small Equipments', 'Utilities',
  'Licencing', 'BD Cost', 'Misc',
];

const closureDetail = {
  siteId: 's1', closureStatus: 'pending_admin',
  lines: LABELS.map((label, i) => ({ idx: i + 1, label, gfcAmount: 100, closureAmount: 120, variation: 20 })),
  gfcBudgetTotal: 1100, closureBudgetTotal: 1320, variationTotal: 220,
  totalIndoorAreaSqft: 300, totalAreaSqft: 800, covers: 30,
};

function renderPanel() {
  const handlers = {
    fetchClosureDetail: vi.fn(async () => closureDetail),
    fetchClosureDocuments: vi.fn(async (_siteId, kind) => (kind === 'closure'
      ? [{ id: 'c1', fileName: 'closure.pdf', url: 'https://s/closure.pdf' }]
      : [{ id: 'e1', fileName: 'pe.pdf', url: 'https://s/pe.pdf' }])),
    fetchClosureQAReports: vi.fn(async () => ({
      before: { kind: 'before', fileName: 'qa-before.pdf', downloadUrl: 'https://s/qa-before.pdf' },
      after: null,
    })),
    onClosureFinalize: vi.fn(),
  };
  const site = { siteId: 's1', financialClosure: { closureBudgetTotal: 1320, gfcBudgetTotal: 1100, variationTotal: 220 } };
  render(<SiteApprovalPanel site={site} handlers={handlers} />);
  return handlers;
}

it('renders the 11 lines, attachments (PE + closure) and QA report links', async () => {
  renderPanel();

  // 11 line items (first + last prove the whole set rendered).
  expect(await screen.findByText(/1\. Professional Fees/)).toBeInTheDocument();
  expect(screen.getByText(/11\. Misc/)).toBeInTheDocument();

  // Both attachments + the QA report, each a click-through link.
  expect((await screen.findByText('pe.pdf')).closest('a')).toHaveAttribute('href', 'https://s/pe.pdf');
  expect(screen.getByText('closure.pdf').closest('a')).toHaveAttribute('href', 'https://s/closure.pdf');
  expect(screen.getByText(/Before — qa-before\.pdf/).closest('a')).toHaveAttribute('href', 'https://s/qa-before.pdf');

  // Finalize action still present.
  expect(screen.getByRole('button', { name: /financial closure/i })).toBeInTheDocument();
});

it('still renders (finalize works) when the detail/doc fetchers fail', async () => {
  const handlers = {
    fetchClosureDetail: vi.fn(async () => { throw new Error('boom'); }),
    fetchClosureDocuments: vi.fn(async () => { throw new Error('boom'); }),
    fetchClosureQAReports: vi.fn(async () => { throw new Error('boom'); }),
    onClosureFinalize: vi.fn(),
  };
  const site = { siteId: 's1', financialClosure: { closureBudgetTotal: 1320 } };
  render(<SiteApprovalPanel site={site} handlers={handlers} />);

  // Falls back to the queue totals + keeps the finalize buttons.
  expect(await screen.findByRole('button', { name: /financial closure/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /send back/i })).toBeInTheDocument();
});
