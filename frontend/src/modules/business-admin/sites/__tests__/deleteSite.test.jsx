// skipcq: JS-0833
// Deleting a site is the only irreversible action in the portal: the row goes,
// and every child table cascades with it. So the interesting assertions are all
// about what must NOT happen — the API is never called from the first dialog,
// never called by a stray click on the card, and the row stays put when the
// server refuses.
//
// The card itself is one big click target for the history drawer, which makes
// the delete button a stopPropagation trap: without it, clicking Delete would
// also open the drawer behind the dialog.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const deleteSite = vi.fn();
const fetchHistory = vi.fn();
const onRetry = vi.fn();
const showToast = vi.fn();

vi.mock('../../../../services/api/businessAdminApi.js', () => ({
  getAdminSiteDocuments: vi.fn().mockResolvedValue({ documents: [] }),
  getReversibleActions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  undoReversibleAction: vi.fn(),
  deleteSite: (...a) => deleteSite(...a),
}));
vi.mock('../../../../services/api/adapters/httpAdapter.js', () => ({ reviveSite: vi.fn() }));
vi.mock('../../../../App.jsx', () => ({ usePageContext: () => ({ showToast }) }));

import SitesTab from '../SitesTab.jsx';

const SITE = {
  siteId: 's1', siteCode: 'CA-300', siteName: 'Blue Tokai Summit', city: 'Gurugram',
  status: 'legal_review', legalDdStatus: 'in_review',
};

const renderTab = () => render(
  <SitesTab data={{ status: 'ready', items: [SITE], total: 1 }}
    fetchHistory={fetchHistory} onRetry={onRetry} />,
);

const openFirstDialog = async (user) => {
  renderTab();
  // Exact name: the card itself is role="button", and its name-from-content now
  // contains the word "Delete site" too.
  await user.click(await screen.findByRole('button', { name: 'Delete site Blue Tokai Summit' }));
};

beforeEach(() => {
  deleteSite.mockReset().mockResolvedValue({ ok: true });
  fetchHistory.mockReset().mockResolvedValue({ items: [], total: 0 });
  onRetry.mockReset();
  showToast.mockReset();
});

// The confirmation dialog must render at <body>, not inside the list.
//
// It is `position: fixed` and centred, which reads as viewport-centred — but a
// fixed element is positioned against its nearest ancestor that establishes a
// containing block, and TeamDashboard wraps every tab in `.ac-fade-in`. That
// class animates `transform` with fill-mode `both`, so the computed value
// settles at the identity matrix rather than `none`, and an identity matrix
// still creates a containing block. Measured in a browser with 100 rows, the
// dialog landed 3405px above the viewport — entirely off-screen, exactly as
// reported ("the popup for the 90th site appears around site 50").
//
// jsdom does no layout, so position cannot be asserted here. What CAN be
// asserted is the structural property the fix rests on: the dialog is not a
// descendant of the component's own tree.
describe('delete confirmation is portalled out of the list', () => {
  // Exact name, as openFirstDialog does — the card is itself role="button" and
  // its name-from-content also contains "Delete site".
  const openDialog = async (user) => {
    await user.click(await screen.findByRole('button', { name: 'Delete site Blue Tokai Summit' }));
    return screen.getByRole('alertdialog');
  };

  it('renders the dialog outside the SitesTab container', async () => {
    const user = userEvent.setup();
    const { container } = renderTab();
    const dialog = await openDialog(user);

    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('mounts it under .ac-portal-root, so tokens and theme still resolve', async () => {
    // Outside .ac-root the --zm-* custom properties do not cascade, which is why
    // the portal re-establishes the wrapper rather than appending bare to body.
    const user = userEvent.setup();
    renderTab();
    const dialog = await openDialog(user);

    const root = dialog.closest('.ac-portal-root');
    expect(root).not.toBeNull();
    expect(root.classList.contains('ac-root')).toBe(true);
    expect(root.getAttribute('data-theme')).toBeTruthy();
  });

  it('keeps the scrim clickable — .ac-portal-root is pointer-events:none', async () => {
    const user = userEvent.setup();
    renderTab();
    const dialog = await openDialog(user);

    const scrim = dialog.parentElement;
    expect(scrim.style.pointerEvents).toBe('auto');
  });

  it('removes the portal again when the dialog closes', async () => {
    const user = userEvent.setup();
    renderTab();
    await openDialog(user);
    // Step 1 dismisses with 'No'; 'Cancel' is the step-2 label.
    await user.click(screen.getByRole('button', { name: 'No' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.querySelectorAll('.ac-portal-root')).toHaveLength(0);
  });
});


describe('two-step confirmation', () => {
  it('asks first, and deletes nothing while it is asking', async () => {
    const user = userEvent.setup();
    await openFirstDialog(user);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/do you really want to delete this site/i);
    // Names the site, so a mis-click on the wrong row is recoverable here.
    expect(dialog).toHaveTextContent('Blue Tokai Summit');
    expect(deleteSite).not.toHaveBeenCalled();
  });

  it('does not open the history drawer when the delete button is clicked', async () => {
    const user = userEvent.setup();
    await openFirstDialog(user);

    // The drawer loads history on open; if the click propagated to the card, this
    // fetch would have fired.
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it('closes without calling the API when the first step is declined', async () => {
    const user = userEvent.setup();
    await openFirstDialog(user);
    await user.click(screen.getByRole('button', { name: 'No' }));

    await waitFor(() => {
      expect(screen.queryByText(/do you really want to delete/i)).not.toBeInTheDocument();
    });
    expect(deleteSite).not.toHaveBeenCalled();
  });

  it('still deletes nothing after step one is accepted', async () => {
    const user = userEvent.setup();
    await openFirstDialog(user);
    await user.click(screen.getByRole('button', { name: 'Yes' }));

    expect(screen.getByText(/this cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument();
    expect(deleteSite).not.toHaveBeenCalled();
  });

  it('backing out of the final step leaves the site alone', async () => {
    const user = userEvent.setup();
    await openFirstDialog(user);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText(/this cannot be undone/i)).not.toBeInTheDocument();
    });
    expect(deleteSite).not.toHaveBeenCalled();
    expect(screen.getByText('Blue Tokai Summit')).toBeInTheDocument();
  });
});

describe('the delete itself', () => {
  it('calls the API only from the final confirmation, then reloads the list', async () => {
    const user = userEvent.setup();
    await openFirstDialog(user);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(deleteSite).toHaveBeenCalledWith('s1'));
    expect(deleteSite).toHaveBeenCalledTimes(1);
    // The list is stale the moment the row is gone.
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith(true));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Blue Tokai Summit'));
  });

  it('surfaces the server refusal and keeps the row', async () => {
    // The backend is specific about why it refused; a generic "failed" would
    // strand the admin with no next step.
    deleteSite.mockRejectedValue({ detail: 'Site not found' });
    const user = userEvent.setup();
    await openFirstDialog(user);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Site not found', 'danger');
    });
    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByText('Blue Tokai Summit')).toBeInTheDocument();
  });

  it('shows the reason INSIDE the dialog, not only as a toast', async () => {
    // The dialog stays open on failure by design (so you can retry), which made
    // a toast-only error read as "the button did nothing" once the toast faded.
    deleteSite.mockRejectedValue({ detail: 'Site not found' });
    const user = userEvent.setup();
    await openFirstDialog(user);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Site not found');
    // ...and it must still be dismissable — "stuck" was the actual complaint.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: /delete permanently/i })).toBeNull();
  });

  it('names a 404 as a not-yet-deployed endpoint', async () => {
    // The frontend ships ahead of the API often enough that a bare "Not Found"
    // sends people hunting through their own data instead of the deploy.
    deleteSite.mockRejectedValue({ status: 404, detail: 'Not Found' });
    const user = userEvent.setup();
    await openFirstDialog(user);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not live on the server yet/i);
  });
});
