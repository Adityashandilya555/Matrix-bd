// skipcq: JS-0833
// Two guards on the Business Admin launch drawer:
//
//   1. Stage-advancing actions confirm before discarding an unsaved edit. Every
//      one of them moves the record on and leaves no way back to save, so a lost
//      edit is unrecoverable rather than merely annoying.
//   2. The Documents tab reads the aggregated site documents at the point of
//      decision, and previews images in place rather than navigating away.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getLaunchApproval, saveLaunchRentFields, finalConfirm, sendForReview, getAdminSiteDocuments, state } =
  vi.hoisted(() => ({
    getLaunchApproval: vi.fn(),
    saveLaunchRentFields: vi.fn(),
    finalConfirm: vi.fn(),
    sendForReview: vi.fn(),
    getAdminSiteDocuments: vi.fn(),
    state: { queueStatus: 'pending_admin_review' },
  }));

vi.mock('../../../services/api/financialClosureApi.js', () => ({ sendForFinancialClosure: vi.fn() }));
vi.mock('../../../services/api/launchApprovalApi.js', () => ({
  getLaunchQueue: async () => ({
    items: [{ site_id: 's1', site_code: 'CA-1', site_name: 'Powai', city: 'Mumbai', status: state.queueStatus }],
  }),
  getLaunchApproval, saveLaunchRentFields, finalConfirm, sendForReview, launchSite: vi.fn(),
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

// Dirty the form by typing into the first commercial input (carpet area).
async function makeDirty(user) {
  await user.click(await screen.findByRole('button', { name: 'Edit commercial terms' }));
  const carpet = document.querySelectorAll('input[type="number"]')[0];
  await user.type(carpet, '5');
  return carpet;
}

beforeEach(() => {
  getLaunchApproval.mockReset();
  saveLaunchRentFields.mockReset();
  finalConfirm.mockReset();
  sendForReview.mockReset();
  getAdminSiteDocuments.mockReset();
  getAdminSiteDocuments.mockResolvedValue({ siteId: 's1', documents: [] });
  state.queueStatus = 'pending_admin_review';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('LaunchApprovalTab — unsaved changes guard', () => {
  it('warns before an action that would discard an unsaved edit', async () => {
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);

    await user.click(screen.getByRole('button', { name: /Send for review/i }));

    expect(await screen.findByText(/You have unsaved changes/i)).toBeTruthy();
    expect(sendForReview).not.toHaveBeenCalled();
  });

  it('keeps the dialog clickable — .ac-portal-root is pointer-events:none', async () => {
    // pointer-events inherits, and ModalPortal's wrapper sets it to none so it
    // never blocks the page while empty. Without an explicit 'auto' on the scrim
    // every button in this dialog is dead to the mouse and the clicks fall
    // through to the Drawer behind it (#495). Asserted on the INLINE style,
    // because jsdom never applies approval-center.css — which is exactly why the
    // userEvent clicks in the tests above kept passing while the real browser
    // could not dismiss the dialog at all.
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);
    await user.click(screen.getByRole('button', { name: /Send for review/i }));

    const dialog = await screen.findByRole('dialog', { name: /You have unsaved changes/i });
    expect(dialog.parentElement.style.pointerEvents).toBe('auto');
  });

  it('Back dismisses the dialog and does not advance the stage', async () => {
    getLaunchApproval.mockResolvedValue(record());
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);
    await user.click(screen.getByRole('button', { name: /Send for review/i }));
    await screen.findByText(/You have unsaved changes/i);

    await user.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(screen.queryByText(/You have unsaved changes/i)).toBeNull());
    expect(sendForReview).not.toHaveBeenCalled();
  });

  it('“anyway” proceeds and discards the edit', async () => {
    getLaunchApproval.mockResolvedValue(record());
    sendForReview.mockResolvedValue(record({ status: 'under_exec_review' }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);
    await user.click(screen.getByRole('button', { name: /Send for review/i }));
    await screen.findByText(/You have unsaved changes/i);

    await user.click(screen.getByRole('button', { name: /Send for review anyway/i }));

    await waitFor(() => expect(sendForReview).toHaveBeenCalled());
  });

  it('does not warn when nothing was edited', async () => {
    getLaunchApproval.mockResolvedValue(record());
    sendForReview.mockResolvedValue(record({ status: 'under_exec_review' }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);

    await user.click(await screen.findByRole('button', { name: /Send for review/i }));

    await waitFor(() => expect(sendForReview).toHaveBeenCalled());
    expect(screen.queryByText(/You have unsaved changes/i)).toBeNull();
  });

  it('a successful save clears the dirty flag, so the next action does not warn', async () => {
    getLaunchApproval.mockResolvedValue(record());
    saveLaunchRentFields.mockImplementation(async (_id, body) => record({ ...body }));
    sendForReview.mockResolvedValue(record({ status: 'under_exec_review' }));
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await makeDirty(user);

    await user.click(screen.getByRole('button', { name: 'Save commercial changes' }));
    await waitFor(() => expect(saveLaunchRentFields).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Send for review/i }));
    await waitFor(() => expect(sendForReview).toHaveBeenCalled());
    expect(screen.queryByText(/You have unsaved changes/i)).toBeNull();
  });
});

describe('LaunchApprovalTab — documents tab', () => {
  const doc = (over = {}) => ({
    id: 'd1', fileName: 'loi-signed.pdf', fileType: 'loi', module: 'BD',
    uploadedAt: '2026-04-02T10:00:00Z', uploadedBy: 'u1', url: 'https://x/loi.pdf', ...over,
  });

  it('lists the documents grouped by module', async () => {
    getLaunchApproval.mockResolvedValue(record());
    getAdminSiteDocuments.mockResolvedValue({
      siteId: 's1',
      documents: [doc(), doc({ id: 'd2', fileName: 'front.jpg', fileType: 'photo' })],
    });
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('tab', { name: /Documents/i }));

    expect(await screen.findByText('loi-signed.pdf')).toBeTruthy();
    expect(screen.getByText('front.jpg')).toBeTruthy();
    expect(screen.getByText(/BD · 2/)).toBeTruthy();
  });

  it('shows an empty state when the site has no documents', async () => {
    getLaunchApproval.mockResolvedValue(record());
    getAdminSiteDocuments.mockResolvedValue({ siteId: 's1', documents: [] });
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('tab', { name: /Documents/i }));

    expect(await screen.findByText('No documents')).toBeTruthy();
  });

  it('surfaces a load failure with a retry rather than an empty list', async () => {
    getLaunchApproval.mockResolvedValue(record());
    getAdminSiteDocuments.mockRejectedValue({ detail: 'boom' });
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('tab', { name: /Documents/i }));

    expect(await screen.findByText('boom')).toBeTruthy();
  });

  it('opens a non-image in a new tab, with noopener', async () => {
    getLaunchApproval.mockResolvedValue(record());
    getAdminSiteDocuments.mockResolvedValue({ siteId: 's1', documents: [doc()] });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('tab', { name: /Documents/i }));
    await user.click(await screen.findByText('loi-signed.pdf'));

    expect(openSpy).toHaveBeenCalledWith('https://x/loi.pdf', '_blank', 'noopener,noreferrer');
  });

  it('previews an image in place instead of navigating away', async () => {
    getLaunchApproval.mockResolvedValue(record());
    getAdminSiteDocuments.mockResolvedValue({
      siteId: 's1', documents: [doc({ id: 'd2', fileName: 'front.jpg', fileType: 'photo', url: 'https://x/front.jpg' })],
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('tab', { name: /Documents/i }));
    await user.click(await screen.findByText('front.jpg'));

    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('img[src="https://x/front.jpg"]')).toBeTruthy());
  });

  it('marks a document whose URL could not be signed as unavailable', async () => {
    getLaunchApproval.mockResolvedValue(record());
    getAdminSiteDocuments.mockResolvedValue({ siteId: 's1', documents: [doc({ url: null })] });
    const user = userEvent.setup();
    await renderTab();
    await openDrawer(user);
    await user.click(await screen.findByRole('tab', { name: /Documents/i }));

    expect(await screen.findByText(/unavailable/i)).toBeTruthy();
  });
});
