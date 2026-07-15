// skipcq: JS-0833
// The "Send for financial closure" action is one-way: the backend flips the
// site to financial_closure_status='open' and 409s any re-send. The drawer used
// to leave the action armed after a successful send (the send returns an
// FC-state record, not a launch-approval one, so `status` stayed 'launched'),
// which let an admin fire it twice and land on "already open for this site".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sendForFinancialClosure = vi.fn();
const getLaunchApproval = vi.fn();

vi.mock('../../../services/api/financialClosureApi.js', () => ({
  sendForFinancialClosure: (...a) => sendForFinancialClosure(...a),
}));
vi.mock('../../../services/api/launchApprovalApi.js', () => ({
  getLaunchQueue: async () => ({
    items: [{ site_id: 's1', site_code: 'BT-1', site_name: 'Cafe One', city: 'Pune', status: 'launched' }],
  }),
  getLaunchApproval: (...a) => getLaunchApproval(...a),
  saveLaunchRentFields: vi.fn(),
  sendForReview: vi.fn(),
  finalConfirm: vi.fn(),
  launchSite: vi.fn(),
}));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));

import LaunchApprovalTab from '../launch/LaunchApprovalTab.jsx';

const detail = (financialClosureStatus) => ({
  site_id: 's1', site_code: 'BT-1', site_name: 'Cafe One', city: 'Pune',
  tenant_id: 't1', status: 'launched',
  financial_closure_status: financialClosureStatus,
  details: {}, departments: {}, events: [],
});

const openDrawer = async (user) => {
  await user.click(await screen.findByText('Cafe One'));
  await screen.findByRole('button', { name: /send for financial closure/i });
};

beforeEach(() => {
  sendForFinancialClosure.mockReset().mockResolvedValue({ siteId: 's1' });
  getLaunchApproval.mockReset();
});

describe('LaunchApprovalTab — financial closure action', () => {
  it('disarms the action after a successful send so it cannot fire twice', async () => {
    const user = userEvent.setup();
    getLaunchApproval.mockResolvedValue(detail('pending'));
    render(<LaunchApprovalTab />);
    await openDrawer(user);

    await user.click(screen.getByRole('button', { name: /send for financial closure/i }));

    // The action is replaced by a sent confirmation — not a live button.
    await screen.findByText('Sent for financial closure');
    expect(screen.queryByRole('button', { name: /send for financial closure/i })).toBeNull();
    expect(sendForFinancialClosure).toHaveBeenCalledTimes(1);
  });

  it('never arms the action for a site whose closure is already open', async () => {
    const user = userEvent.setup();
    getLaunchApproval.mockResolvedValue(detail('open'));
    render(<LaunchApprovalTab />);

    await user.click(await screen.findByText('Cafe One'));

    await screen.findByText('Sent for financial closure');
    expect(screen.queryByRole('button', { name: /send for financial closure/i })).toBeNull();
  });

  it('keeps the action armed when the send fails, so it can be retried', async () => {
    const user = userEvent.setup();
    getLaunchApproval.mockResolvedValue(detail('pending'));
    sendForFinancialClosure.mockRejectedValue({ detail: 'Boom' });
    render(<LaunchApprovalTab />);
    await openDrawer(user);

    await user.click(screen.getByRole('button', { name: /send for financial closure/i }));

    await screen.findByText('Boom');
    expect(screen.queryByText('Sent for financial closure')).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send for financial closure/i })).toBeEnabled();
    });
  });
});
