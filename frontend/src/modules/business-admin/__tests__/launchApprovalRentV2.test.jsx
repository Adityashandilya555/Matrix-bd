// skipcq: JS-0833
// End-to-end lock for RentTermsFormV2 in the Business Admin launch-approval tab.
// Verifies the Edit toggle opens V2 (not the V1 cards) only where the gate allows
// it, and that a staggered save carries the per-year rev-share split through the
// payload. Mirrors launchClosureAction.test.jsx scaffolding; the flag is read at
// module load, so flag-on cases stubEnv + resetModules + dynamic import.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getLaunchApproval, saveLaunchRentFields, state } = vi.hoisted(() => ({
  getLaunchApproval: vi.fn(),
  saveLaunchRentFields: vi.fn(),
  state: { queueStatus: 'pending_admin_review' },
}));

vi.mock('../../../services/api/financialClosureApi.js', () => ({ sendForFinancialClosure: vi.fn() }));
vi.mock('../../../services/api/launchApprovalApi.js', () => ({
  getLaunchQueue: async () => ({
    items: [{ site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai', status: state.queueStatus }],
  }),
  getLaunchApproval, saveLaunchRentFields,
  sendForReview: vi.fn(), finalConfirm: vi.fn(), launchSite: vi.fn(),
}));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));

const record = (over = {}) => ({
  site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai',
  tenant_id: 't1', status: state.queueStatus,
  rent_type: 'fixed', expected_rent: 120000, escalation_pct: 5, expected_escalation_years: 1,
  staggered_escalation: null, rev_share_pct: null,
  financial_closure_status: 'pending', details: {}, departments: {}, events: [],
  ...over,
});

async function renderTab() {
  vi.resetModules();
  const { default: LaunchApprovalTab } = await import('../launch/LaunchApprovalTab.jsx');
  return render(<LaunchApprovalTab />);
}

const openDrawer = async (user) => user.click(await screen.findByText('Powai'));

beforeEach(() => {
  getLaunchApproval.mockReset();
  saveLaunchRentFields.mockReset();
  state.queueStatus = 'pending_admin_review';
  // chooseFlat() reads window.confirm; jsdom returns undefined, so stub it true.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('LaunchApprovalTab — rent v2', () => {
  it('flag ON: Edit at pending_admin_review opens V2, not the V1 cards', async () => {
    vi.stubEnv('VITE_FEATURE_RENT_V2', 'true');
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Is the rent staggered?')).toBeTruthy();
    expect(screen.queryByText('MG + Revenue share')).toBeNull(); // a V1-only card label
  });

  it('at under_exec_review the rent editor stays gated off (no Edit toggle, no form)', async () => {
    vi.stubEnv('VITE_FEATURE_RENT_V2', 'true');
    state.queueStatus = 'under_exec_review';
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await screen.findByText(/Awaiting executive review/i); // drawer loaded

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByText('Is the rent staggered?')).toBeNull();
  });

  it('flag ON: a staggered save carries the per-year dine-in split into the body', async () => {
    vi.stubEnv('VITE_FEATURE_RENT_V2', 'true');
    getLaunchApproval.mockResolvedValue(record({
      rent_type: 'staggered', expected_rent: 100000, escalation_pct: null,
      staggered_escalation: [{ year: 1, percent: 5, dine_in_pct: 8, delivery_pct: 4 }],
    }));
    saveLaunchRentFields.mockImplementation(async (_id, body) => record({ ...body }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByText('Is the rent staggered?');

    await user.click(screen.getByRole('button', { name: 'Save rent changes' }));

    await waitFor(() => expect(saveLaunchRentFields).toHaveBeenCalled());
    const body = saveLaunchRentFields.mock.calls[0][1];
    expect(body.staggered_escalation).toEqual([{ year: 1, percent: 5, dine_in_pct: 8, delivery_pct: 4 }]);
  });

  it('flag OFF: Edit opens the V1 four-card radiogroup (rollback)', async () => {
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    await screen.findByRole('radiogroup', { name: 'Rent type' });
    expect(screen.queryByText('Is the rent staggered?')).toBeNull();
  });
});
