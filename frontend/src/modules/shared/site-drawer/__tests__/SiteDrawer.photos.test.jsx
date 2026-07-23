// skipcq: JS-0833
// Site photos in the drawer.
//
// PhotoTile used to be a background-image <div> with no onClick, no role and no
// accessible name, so a supervisor could not enlarge a photo to check it and a
// screen reader saw nothing at all. It is now a real <button> opening a
// portalled lightbox.
//
// The regression this guards hardest: the drawer's own scrim carries
// onClick={onClose}. If the lightbox rendered inside it, opening a photo would
// also close the drawer underneath.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getSiteDocuments = vi.fn();

vi.mock('../../../../services/api/siteService.js', () => ({
  getSiteDocuments: (...a) => getSiteDocuments(...a),
}));
vi.mock('../../../../services/api/audit.js', () => ({
  getSiteActivity: vi.fn().mockResolvedValue({ items: [] }),
  colorForAction: () => 'var(--zm-fg)',
  labelForEntry: () => 'did a thing',
}));
vi.mock('../../../../state/SessionContext.jsx', () => ({
  useSession: () => ({ role: 'supervisor', session: {}, user: { id: 'u1' } }),
}));
vi.mock('../../../../state/SitesContext.jsx', () => ({
  useSites: () => ({ sites: [], refresh: vi.fn() }),
}));

import SiteDrawer from '../SiteDrawer.jsx';

const site = {
  id: 's1', code: 'BT-1', name: 'Cafe One', city: 'Pune',
  status: 'approved', photos: [],
};

const doc = (over = {}) => ({
  id: 'd1', fileType: 'photo', url: 'https://storage/signed?token=AAA',
  fileName: 'storefront.jpg', mimeType: 'image/jpeg', ...over,
});

beforeEach(() => {
  getSiteDocuments.mockReset().mockResolvedValue({ documents: [doc()] });
});

describe('photo tiles', () => {
  it('renders each photo as a button with an accessible name', async () => {
    render(<SiteDrawer site={site} onClose={vi.fn()}/>);
    expect(
      await screen.findByRole('button', { name: /view photo · storefront\.jpg/i }),
    ).toBeInTheDocument();
  });

  it('opens the lightbox on click and leaves the drawer open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SiteDrawer site={site} onClose={onClose}/>);

    await user.click(await screen.findByRole('button', { name: /view photo/i }));

    expect(await screen.findByRole('img', { name: 'storefront.jpg' })).toBeInTheDocument();
    // The drawer's scrim must not have swallowed the click.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Cafe One')).toBeInTheDocument();
  });

  it('carries mimeType through, so a non-image is not rendered as <img>', async () => {
    const user = userEvent.setup();
    // SiteDrawer used to drop mimeType when mapping the documents response.
    getSiteDocuments.mockResolvedValue({
      documents: [doc({ mimeType: 'application/pdf', fileName: 'scan.pdf' })],
    });
    render(<SiteDrawer site={site} onClose={vi.fn()}/>);

    await user.click(await screen.findByRole('button', { name: /view photo · scan\.pdf/i }));

    expect(await screen.findByText(/not an image/i)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'scan.pdf' })).toBeNull();
  });

  it('re-signs the URL when the lightbox opens', async () => {
    const user = userEvent.setup();
    render(<SiteDrawer site={site} onClose={vi.fn()}/>);
    await screen.findByRole('button', { name: /view photo/i });
    const callsAfterLoad = getSiteDocuments.mock.calls.length;

    // Signed URLs expire after 300s, so opening must fetch a fresh one rather
    // than trusting the URL captured when the drawer first loaded.
    getSiteDocuments.mockResolvedValue({
      documents: [doc({ url: 'https://storage/signed?token=FRESH' })],
    });
    await user.click(screen.getByRole('button', { name: /view photo/i }));

    await vi.waitFor(() => {
      expect(getSiteDocuments.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    });
    await vi.waitFor(() => {
      expect(screen.getByRole('img', { name: 'storefront.jpg' }))
        .toHaveAttribute('src', 'https://storage/signed?token=FRESH');
    });
  });
});
