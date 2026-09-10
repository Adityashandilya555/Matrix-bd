// skipcq: JS-0833
// Reproduction for the reported bug: dismissing the unsaved-changes dialog with
// Back closed the whole drawer, threw the user out of the site, and left the
// dialog armed so it reappeared on the next open — with the edits gone.
//
// Back must do one thing: hide the dialog. The drawer stays open, the edits stay
// in the form, and Save is right there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getLaunchApproval, saveLaunchRentFields, sendForReview, getAdminSiteDocuments, state } =
  vi.hoisted(() => ({
    getLaunchApproval: vi.fn(),
    saveLaunchRentFields: vi.fn(),
    sendForReview: vi.fn(),
    getAdminSiteDocuments: vi.fn(),
    state: { queueStatus: 'pending_admin_review' },
  }));

vi.mock('../../../services/api/financialClosureApi.js', () => ({ sendForFinancialClosure: vi.fn() }));
vi.mock('../../../services/api/launchApprovalApi.js', () => ({
  getLaunchQueue: async () => ({
    items: [{ site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai', status: state.queueStatus }],
  }),
  getLaunchApproval, saveLaunchRentFields, sendForReview,
  finalConfirm: vi.fn(), launchSite: vi.fn(),
}));
vi.mock('../../../services/api/businessAdminApi.js', () => ({ getAdminSiteDocuments }));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));

const record = (over = {}) => ({
  site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai',
  tenant_id: 't1', status: state.queueStatus,
  rent_type: 'fixed', expected_rent: 205000, escalation_pct: 15, expected_escalation_years: 3,
  staggered_escalation: null, rev_share_pct: null,
  carpet_area_sqft: 1200, cam_charges: 0, capex: 0,
  security_deposit: 1350000, brokerage: 120950, rent_start_date: '2026-05-01',
  financial_closure_status: 'pending', details: {}, departments: {}, events: [],
  ...over,
});

async function renderTab() {
  vi.resetModules();
  const { default: LaunchApprovalTab } = await import('../launch/LaunchApprovalTab.jsx');
  return render(<LaunchApprovalTab />);
}

const openDrawer = async (user) => user.click(await screen.findByText('Powai'));
const drawerOpen = () => Boolean(document.querySelector('.ac-drawer'));
const carpetInput = () => document.querySelectorAll('input[type="number"]')[0];

async function makeDirty(user) {
  await user.click(await screen.findByRole('button', { name: 'Edit commercial terms' }));
  await user.type(carpetInput(), '5');
}

beforeEach(() => {
  getLaunchApproval.mockReset();
  saveLaunchRentFields.mockReset();
  sendForReview.mockReset();
  getAdminSiteDocuments.mockReset();
  getAdminSiteDocuments.mockResolvedValue({ siteId: 's1', documents: [] });
  state.queueStatus = 'pending_admin_review';
  getLaunchApproval.mockResolvedValue(record());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('unsaved-changes dialog — Back', () => {
  it('keeps the drawer open', async () => {
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);
    await user.click(screen.getByRole('button', { name: /Send for review/i }));
    await screen.findByText(/You have unsaved changes/i);

    await user.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(screen.queryByText(/You have unsaved changes/i)).toBeNull());
    expect(drawerOpen()).toBe(true);
  });

  it('leaves the edit in the form so Save is still available', async () => {
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);
    const edited = carpetInput().value;
    await user.click(screen.getByRole('button', { name: /Send for review/i }));
    await screen.findByText(/You have unsaved changes/i);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByText(/You have unsaved changes/i)).toBeNull());

    expect(carpetInput().value).toBe(edited);
    expect(screen.getByRole('button', { name: 'Save commercial changes' })).toBeTruthy();
  });

  it('Escape closes the dialog but not the drawer behind it', async () => {
    // Drawer registers its own Escape handler on window, so without a capture
    // handler the one keypress would dismiss both.
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);
    await user.click(screen.getByRole('button', { name: /Send for review/i }));
    await screen.findByText(/You have unsaved changes/i);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByText(/You have unsaved changes/i)).toBeNull());
    expect(drawerOpen()).toBe(true);
    expect(sendForReview).not.toHaveBeenCalled();
  });

  it('does not leave the dialog armed for the next time the drawer opens', async () => {
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);
    await user.click(screen.getByRole('button', { name: /Send for review/i }));
    await screen.findByText(/You have unsaved changes/i);

    // Close the drawer outright while the dialog is up — the state must not
    // survive to greet the next visitor.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(drawerOpen()).toBe(false));

    await openDrawer(user);
    await screen.findByText('Commercial terms');
    expect(screen.queryByText(/You have unsaved changes/i)).toBeNull();
  });
});
