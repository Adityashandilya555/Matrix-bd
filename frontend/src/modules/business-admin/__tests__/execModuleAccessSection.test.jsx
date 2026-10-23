// skipcq: JS-0833
// The business admin's executive module access queue (migration 20261022).
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExecModuleAccessSection from '../ExecModuleAccessSection.jsx';

const queue = (items) => ({ status: 'ready', items, error: null, refreshing: false });

const request = {
  id: 'r-1', executiveName: 'Ravi', executiveEmail: 'ravi@example.com',
  homeModule: 'legal', module: 'design', supervisorName: 'Meera',
  note: 'Covering a launch', createdAt: '2026-10-20T10:00:00Z',
};
const grant = { ...request, id: 'g-1', note: null };

const renderSection = (over = {}) => {
  const props = {
    requests: queue([request]), grants: queue([grant]),
    onApprove: vi.fn().mockResolvedValue(undefined),
    onReject: vi.fn().mockResolvedValue(undefined),
    onRevoke: vi.fn().mockResolvedValue(undefined),
    onRetryRequests: vi.fn(), onRetryGrants: vi.fn(),
    ...over,
  };
  render(<ExecModuleAccessSection {...props} />);
  return props;
};

afterEach(() => { vi.restoreAllMocks(); });

describe('executive module access requests', () => {
  it('shows who, from where to where, under whom, and the note', () => {
    renderSection();
    const row = screen.getByTestId('exec-access-request-r-1');
    expect(within(row).getByText('Ravi')).toBeInTheDocument();
    expect(within(row).getByText(/legal →/)).toBeInTheDocument();
    expect(within(row).getByText('under Meera')).toBeInTheDocument();
    expect(within(row).getByText(/Covering a launch/)).toBeInTheDocument();
  });

  it('approves and rejects by id', async () => {
    const user = userEvent.setup();
    const props = renderSection();
    const row = screen.getByTestId('exec-access-request-r-1');
    await user.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(props.onApprove).toHaveBeenCalledWith('r-1');
    await user.click(within(row).getByRole('button', { name: 'Reject' }));
    expect(props.onReject).toHaveBeenCalledWith('r-1');
  });

  it('confirms before withdrawing a grant, and respects a No', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = renderSection();
    const row = screen.getByTestId('exec-access-grant-g-1');
    await user.click(within(row).getByRole('button', { name: 'Withdraw' }));
    expect(confirm).toHaveBeenCalled();
    expect(props.onRevoke).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(within(row).getByRole('button', { name: 'Withdraw' }));
    expect(props.onRevoke).toHaveBeenCalledWith('g-1');
  });

  it('does not claim nobody holds access while the grants are still loading', () => {
    // useQueue starts at status 'loading' with items [].
    renderSection({ grants: { status: 'loading', items: [], error: null, refreshing: false } });
    expect(screen.queryByText(/No executive is currently working/)).toBeNull();
    expect(screen.getByTestId('exec-access-grants-loading')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is waiting', () => {
    renderSection({ requests: queue([]), grants: queue([]) });
    expect(screen.getByText('No executive access requests')).toBeInTheDocument();
  });

  it('labels NSO rows as supervisor access and confirms before approving', async () => {
    const user = userEvent.setup();
    const nso = { ...request, id: 'r-2', module: 'nso', supervisorName: null, note: null };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const props = renderSection({ requests: queue([nso]), grants: queue([]) });
    const row = screen.getByTestId('exec-access-request-r-2');
    expect(within(row).getByText('as NSO supervisor')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(confirm).toHaveBeenCalled();
    expect(props.onApprove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(props.onApprove).toHaveBeenCalledWith('r-2');
  });

  it('approves other modules without a confirm', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm');
    const props = renderSection();
    await user.click(within(screen.getByTestId('exec-access-request-r-1')).getByRole('button', { name: 'Approve' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(props.onApprove).toHaveBeenCalledWith('r-1');
  });
});
