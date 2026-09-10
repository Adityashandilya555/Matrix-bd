// skipcq: JS-0833
// The commercial terms section in the Business Admin launch drawer: its own
// Keep-same / Edit toggle, the staged values (not the canonical details.* copy),
// and the guard that stops a final confirm without a rent start date.
//
// Scaffolding mirrors launchApprovalRentV2.test.jsx — the feature flag is read at
// module load, so the tab is imported dynamically after resetModules.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getLaunchApproval, saveLaunchRentFields, finalConfirm, state } = vi.hoisted(() => ({
  getLaunchApproval: vi.fn(),
  saveLaunchRentFields: vi.fn(),
  finalConfirm: vi.fn(),
  state: { queueStatus: 'pending_admin_review' },
}));

vi.mock('../../../services/api/financialClosureApi.js', () => ({ sendForFinancialClosure: vi.fn() }));
vi.mock('../../../services/api/launchApprovalApi.js', () => ({
  getLaunchQueue: async () => ({
    items: [{ site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai', status: state.queueStatus }],
  }),
  getLaunchApproval, saveLaunchRentFields, finalConfirm,
  sendForReview: vi.fn(), launchSite: vi.fn(),
}));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));

const record = (over = {}) => ({
  site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai',
  tenant_id: 't1', status: state.queueStatus,
  rent_type: 'fixed', expected_rent: 205000, escalation_pct: 15, expected_escalation_years: 3,
  staggered_escalation: null, rev_share_pct: null,
  // Staged commercial terms live at the TOP LEVEL.
  carpet_area_sqft: 1200, cam_charges: 0, capex: 0,
  security_deposit: 1350000, brokerage: 120950, rent_start_date: null,
  financial_closure_status: 'pending',
  details: {}, departments: {}, events: [],
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
  finalConfirm.mockReset();
  state.queueStatus = 'pending_admin_review';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('LaunchApprovalTab — commercial terms', () => {
  it('summarises the STAGED values, not the canonical details copy', async () => {
    getLaunchApproval.mockResolvedValue(record({
      carpet_area_sqft: 1400,                    // staged (edited)
      details: { carpet_area_sqft: 1200 },       // canonical (pre-commit)
    }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);

    // 1,400 is what the reviewer agreed; 1,200 is what site_details still holds.
    expect(await screen.findByText(/1,400 sqft/)).toBeTruthy();
    expect(screen.queryByText(/1,200 sqft/)).toBeNull();
  });

  it('flags a missing rent start date in the Current grid', async () => {
    getLaunchApproval.mockResolvedValue(record({ rent_start_date: null }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    // "Not set" rather than the em dash every other empty value shows: this is
    // the one field whose absence blocks the final confirm.
    expect(await screen.findByText('Not set')).toBeTruthy();
  });

  it('lays the Current commercial terms out as labelled rows, not one run-on line', async () => {
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    for (const label of ['Carpet area', 'CAM', 'Capex', 'Security deposit', 'Brokerage', 'Rent start date']) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it('its Edit toggle opens the commercial form without opening the rent form', async () => {
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('button', { name: 'Edit commercial terms' }));

    expect(await screen.findByRole('button', { name: 'Save commercial changes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save rent changes' })).toBeNull();
  });

  it('sends the commercial keys in the PATCH body', async () => {
    getLaunchApproval.mockResolvedValue(record());
    saveLaunchRentFields.mockImplementation(async (_id, body) => record({ ...body }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('button', { name: 'Edit commercial terms' }));
    await user.click(screen.getByRole('button', { name: 'Save commercial changes' }));

    await waitFor(() => expect(saveLaunchRentFields).toHaveBeenCalled());
    const body = saveLaunchRentFields.mock.calls[0][1];
    expect(body.carpet_area_sqft).toBe(1200);
    expect(body.security_deposit).toBe(1350000);
    expect(body.brokerage).toBe(120950);
    expect('rent_start_date' in body).toBe(true);
  });

  it('at under_exec_review the admin gets no commercial Edit toggle', async () => {
    state.queueStatus = 'under_exec_review';
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await screen.findByText(/Awaiting executive review/i);
    expect(screen.queryByRole('button', { name: 'Edit commercial terms' })).toBeNull();
  });

  it('blocks Confirm & commit when the rent start date is blank, without calling the API', async () => {
    state.queueStatus = 'pending_admin_final';
    getLaunchApproval.mockResolvedValue(record({ rent_start_date: null }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('button', { name: /Confirm & commit/i }));

    expect(await screen.findByText(/Rent start date is required/i)).toBeTruthy();
    expect(finalConfirm).not.toHaveBeenCalled();
    // The guard opens the section holding the field it is asking for.
    expect(screen.getByRole('button', { name: 'Save commercial changes' })).toBeTruthy();
  });

  it('allows Confirm & commit once a rent start date is set', async () => {
    state.queueStatus = 'pending_admin_final';
    getLaunchApproval.mockResolvedValue(record({ rent_start_date: '2026-05-01' }));
    finalConfirm.mockResolvedValue(record({ rent_start_date: '2026-05-01', status: 'ready_to_launch' }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('button', { name: /Confirm & commit/i }));

    await waitFor(() => expect(finalConfirm).toHaveBeenCalled());
  });
});
