// skipcq: JS-0833
// The site-photo lightbox. Before this, clicking a photo did nothing at all —
// PhotoTile was a background-image div with no handler and no accessible name.
//
// Two behaviours here are easy to regress and hard to notice: the 300-second
// signed-URL expiry (a drawer left open holds dead links, so the URL is
// re-signed on open and once more on error), and the portal (the site drawer's
// own scrim closes the drawer on click, so the lightbox must not sit inside it).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/dom';

import ImageLightbox from '../ImageLightbox.jsx';

const photo = {
  id: 'p1', url: 'https://storage/signed?token=AAA',
  name: 'storefront.jpg', mimeType: 'image/jpeg',
};

const renderBox = (props = {}) =>
  render(<ImageLightbox open photo={photo} onClose={vi.fn()} {...props}/>);

beforeEach(() => { document.body.style.overflow = ''; });

describe('rendering', () => {
  it('shows the image with an accessible name and portals out of the container', () => {
    const { container } = renderBox();
    const img = screen.getByRole('img', { name: 'storefront.jpg' });
    expect(img).toHaveAttribute('src', photo.url);
    // Portalled to body — not inside the caller's tree, which is what keeps it
    // off the site drawer's scrim.
    expect(container).not.toContainElement(img);
  });

  it('renders nothing when closed', () => {
    render(<ImageLightbox open={false} photo={photo} onClose={vi.fn()}/>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('falls back instead of rendering <img> when the URL is null', () => {
    renderBox({ photo: { ...photo, url: null } });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it('falls back for a non-image, which the backend allows through', () => {
    // photo_service has no server-side allowlist, so a PDF can land as a photo.
    renderBox({ photo: { ...photo, mimeType: 'application/pdf' } });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/not an image/i)).toBeInTheDocument();
  });
});

describe('dismissal', () => {
  it('closes on Escape and on the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderBox({ onClose });

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /close preview/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on the scrim but NOT on the image itself', () => {
    const onClose = vi.fn();
    renderBox({ onClose });

    // Clicking the picture must never dismiss — the scrim check is on the
    // event target, which also survives a drag that ends off the image.
    fireEvent.mouseDown(screen.getByRole('img', { name: 'storefront.jpg' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('focus and scroll', () => {
  it('moves focus in on open and restores it to the trigger on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = renderBox();
    await vi.waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('locks body scroll while open and restores the previous value', () => {
    document.body.style.overflow = 'scroll';   // something else already set it
    const { unmount } = renderBox();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });
});

describe('signed-URL expiry', () => {
  it('re-signs on open and uses the fresh URL', async () => {
    const onRefreshUrl = vi.fn().mockResolvedValue('https://storage/signed?token=FRESH');
    renderBox({ onRefreshUrl });

    expect(onRefreshUrl).toHaveBeenCalledWith(photo);
    await vi.waitFor(() => {
      expect(screen.getByRole('img', { name: 'storefront.jpg' }))
        .toHaveAttribute('src', 'https://storage/signed?token=FRESH');
    });
  });

  it('retries exactly once on a load error, then gives up', async () => {
    // The loop guard matters: a genuinely deleted object errors forever, and an
    // unguarded retry would hammer the API for as long as the dialog is open.
    const onRefreshUrl = vi.fn().mockResolvedValue(photo.url);
    renderBox({ onRefreshUrl });
    await vi.waitFor(() => expect(onRefreshUrl).toHaveBeenCalledTimes(1)); // the open re-sign

    fireEvent.error(screen.getByRole('img', { name: 'storefront.jpg' }));
    await vi.waitFor(() => expect(onRefreshUrl).toHaveBeenCalledTimes(2));

    fireEvent.error(screen.getByRole('img', { name: 'storefront.jpg' }));
    await screen.findByText(/could not be loaded/i);
    expect(onRefreshUrl).toHaveBeenCalledTimes(2);   // NOT 3
  });

  it('survives a refresh that throws', async () => {
    const onRefreshUrl = vi.fn().mockRejectedValue(new Error('offline'));
    renderBox({ onRefreshUrl });
    // Keeps the original URL rather than blanking the dialog.
    await vi.waitFor(() => {
      expect(screen.getByRole('img', { name: 'storefront.jpg' })).toHaveAttribute('src', photo.url);
    });
  });
});
