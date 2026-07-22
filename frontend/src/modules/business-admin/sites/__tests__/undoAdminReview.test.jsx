// skipcq: JS-0833
// The Undo affordance on the site history drawer.
//
// Only decisions the CALLING admin made and has not already undone come back
// from /reversible-actions, so the button is driven entirely by that list —
// never by inspecting the audit action string. That keeps the whitelist on the
// server: an entry with no snapshot row is simply not undoable, and the UI
// cannot invent one.
//
// The refusal path matters as much as the happy path: the backend explains
// precisely why an undo was rejected (GFC budget open, site moved on, already
// undone), and that text must reach the user rather than a generic error.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getReversibleActions = vi.fn();
const undoAdminReview = vi.fn();
const fetchHistory = vi.fn();

vi.mock('../../../../services/api/businessAdminApi.js', () => ({
  getAdminSiteDocuments: vi.fn().mockResolvedValue({ items: [] }),
  getReversibleActions: (...a) => getReversibleActions(...a),
  undoAdminReview: (...a) => undoAdminReview(...a),
}));
vi.mock('../../../../services/api/adapters/httpAdapter.js', () => ({ reviveSite: vi.fn() }));
vi.mock('../../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));

import SitesTab from '../SitesTab.jsx';

const SITE = {
  siteId: 's1', siteCode: 'BT-1', siteName: 'Cafe One', city: 'Pune',
  status: 'approved', designStatus: 'in_progress',
};

const entry = (over = {}) => ({
  id: 'audit-1', siteId: 's1', actor: 'Ada Admin',
  action: 'design_admin_approved', detail: 'kind=3d approved by business_admin',
  createdAt: '2026-07-21T12:00:00Z', ...over,
});

const openDrawer = async (user) => {
  render(
    <SitesTab
      data={{ status: 'ready', items: [SITE], total: 1 }}
      fetchHistory={fetchHistory}
      onRetry={vi.fn()}
    />,
  );
  await user.click(await screen.findByText('Cafe One'));
};

beforeEach(() => {
  fetchHistory.mockReset().mockResolvedValue({ items: [entry()], total: 1 });
  getReversibleActions.mockReset().mockResolvedValue({ items: [], total: 0 });
  undoAdminReview.mockReset().mockResolvedValue({});
});

describe('undo button visibility', () => {
  it('is absent when the admin has nothing undoable', async () => {
    const user = userEvent.setup();
    await openDrawer(user);

    await screen.findByText(/admin approved/i);
    expect(screen.queryByRole('button', { name: /undo this decision/i })).toBeNull();
  });

  it('appears only on the audit entry the snapshot points at', async () => {
    const user = userEvent.setup();
    fetchHistory.mockResolvedValue({
      items: [entry({ id: 'audit-1' }), entry({ id: 'audit-2', action: 'design_gfc_approved' })],
      total: 2,
    });
    getReversibleActions.mockResolvedValue({
      items: [{ id: 'rev-1', auditLogId: 'audit-1', action: 'design_admin_review', entityType: 'design_deliverable', createdAt: '2026-07-21T12:00:00Z' }],
      total: 1,
    });
    await openDrawer(user);

    // One button, not two — the GFC entry has no snapshot row and must not
    // acquire one client-side.
    expect(await screen.findAllByRole('button', { name: /undo this decision/i })).toHaveLength(1);
  });

  it('does not break the history view when the reversible lookup fails', async () => {
    const user = userEvent.setup();
    getReversibleActions.mockRejectedValue(new Error('boom'));
    await openDrawer(user);

    expect(await screen.findByText(/admin approved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo this decision/i })).toBeNull();
  });
});

describe('performing an undo', () => {
  beforeEach(() => {
    getReversibleActions.mockResolvedValue({
      items: [{ id: 'rev-1', auditLogId: 'audit-1', action: 'design_admin_review', entityType: 'design_deliverable', createdAt: '2026-07-21T12:00:00Z' }],
      total: 1,
    });
  });

  it('calls the API with the reversible id, not the audit id', async () => {
    const user = userEvent.setup();
    await openDrawer(user);

    await user.click(await screen.findByRole('button', { name: /undo this decision/i }));
    expect(undoAdminReview).toHaveBeenCalledWith('s1', 'rev-1');
  });

  it('re-reads both lists so the consumed snapshot disappears', async () => {
    const user = userEvent.setup();
    await openDrawer(user);
    await screen.findByRole('button', { name: /undo this decision/i });

    // After the undo the snapshot is consumed, so the server returns nothing.
    getReversibleActions.mockResolvedValue({ items: [], total: 0 });
    fetchHistory.mockResolvedValue({
      items: [entry({ id: 'audit-9', action: 'design_admin_review_undone' }), entry()],
      total: 2,
    });

    await user.click(screen.getByRole('button', { name: /undo this decision/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /undo this decision/i })).toBeNull());
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });

  it('surfaces the backend refusal verbatim', async () => {
    const user = userEvent.setup();
    undoAdminReview.mockRejectedValue({
      detail: 'GFC has already been decided for this site and the Project Excellence budget is open.',
    });
    await openDrawer(user);

    await user.click(await screen.findByRole('button', { name: /undo this decision/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Project Excellence budget is open/);
    // The entry stays undoable — the refusal is not a consumption.
    expect(screen.getByRole('button', { name: /undo this decision/i })).toBeInTheDocument();
  });

  it('disables the button while the request is in flight', async () => {
    const user = userEvent.setup();
    let release;
    undoAdminReview.mockReturnValue(new Promise((res) => { release = res; }));
    await openDrawer(user);

    const btn = await screen.findByRole('button', { name: /undo this decision/i });
    await user.click(btn);

    expect(screen.getByRole('button', { name: /undoing/i })).toBeDisabled();
    release({});
  });
});
