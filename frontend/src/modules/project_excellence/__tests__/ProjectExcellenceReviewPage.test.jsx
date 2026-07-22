// skipcq: JS-0833
// THE BUDGET-WIPE BUG. Typing the 11 amounts, uploading an attachment, then
// submitting sent all-null values — the admin card showed ₹0/—. Root cause: a
// background refresh (window 'focus' when the file dialog closes, or the
// upload's own site-data event) re-seeded the form from the empty server draft,
// clobbering the typed values before Submit persisted them. These lock the
// dirty-guard: a background refresh must NOT overwrite unsaved edits.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getPE = vi.fn();
const savePEBudget = vi.fn();

vi.mock('../../../services/api/projectExcellenceApi.js', () => ({
  getPE: (...a) => getPE(...a),
  savePEBudget: (...a) => savePEBudget(...a),
  allocatePE: vi.fn(),
  listPEDelegations: async () => ({ items: [] }),
  reviewPEBudget: vi.fn(),
  revokePEAllocation: vi.fn(),
  adminReviewPEBudget: vi.fn(),
}));
vi.mock('../../../services/api/adapters/httpAdapter.js', () => ({ listMyTeam: async () => [] }));
vi.mock('../../../state/SessionContext.jsx', () => ({
  useSession: () => ({ role: 'executive', session: { userId: 'u1' }, user: { id: 'u1' } }),
}));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ siteId: 's1' }),
  useNavigate: () => vi.fn(),
}));
// The attachment section makes its own API calls on mount; stub it out so this
// test focuses on the budget grid.
vi.mock('../../shared/documents/ExcellenceDocuments.jsx', () => ({ default: () => null }));
let fireBackgroundRefresh = null;
vi.mock('../../../hooks/useSiteDataRefresh.js', () => ({
  useSiteDataRefresh: (fn) => { fireBackgroundRefresh = fn; },
}));

import ProjectExcellenceReviewPage from '../ProjectExcellenceReviewPage.jsx';

const draft = (over = {}) => ({
  siteId: 's1', siteCode: 'BT-1', siteName: 'Cafe One', city: 'Pune',
  projectStatus: 'done', excellenceStatus: 'budgeting', budgetStatus: 'draft',
  budgetItems: [], totalIndoorAreaSqft: null, totalAreaSqft: null, covers: null,
  ...over,
});

beforeEach(() => {
  getPE.mockReset();
  savePEBudget.mockReset();
  fireBackgroundRefresh = null;
});

describe('budget dirty-guard', () => {
  it('keeps typed amounts when a background refresh returns the empty draft', async () => {
    const user = userEvent.setup();
    getPE.mockResolvedValue(draft());
    render(<ProjectExcellenceReviewPage/>);

    // First line item input (Professional Fees). Type a value.
    const inputs = await screen.findAllByPlaceholderText('0');
    await user.type(inputs[0], '12345');
    expect(inputs[0]).toHaveValue(12345);

    // The exact background refetch the closing file dialog triggers via window
    // 'focus' — the server still holds the empty draft (nothing saved yet).
    getPE.mockResolvedValue(draft());
    await act(async () => { await fireBackgroundRefresh(true); });

    // The typed value must survive — this is the bug.
    expect(inputs[0]).toHaveValue(12345);
  });

  it('re-syncs from the server after a successful save (dirty cleared)', async () => {
    const user = userEvent.setup();
    getPE.mockResolvedValue(draft());
    savePEBudget.mockResolvedValue(draft({
      budgetItems: [{ idx: 1, label: 'Professional Fees', amount: 500 }],
    }));
    render(<ProjectExcellenceReviewPage/>);

    const inputs = await screen.findAllByPlaceholderText('0');
    await user.type(inputs[0], '999');
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    // Save resolved with amount=500 → the grid reflects the server value, and a
    // later background refresh (dirty now cleared) no longer skips the re-seed.
    expect(await screen.findByDisplayValue('500')).toBeInTheDocument();
    getPE.mockResolvedValue(draft({
      budgetItems: [{ idx: 1, label: 'Professional Fees', amount: 500 }],
    }));
    await act(async () => { await fireBackgroundRefresh(true); });
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
  });
});
