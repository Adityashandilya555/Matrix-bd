// skipcq: JS-0833
// The supervisor's LOI preview + send-back dialog.
//
// The bug this replaces: "View LOI" was a mock stub that toasted and returned.
// The fix must actually surface the document — and it deliberately uses a real
// <a href> rather than window.open, because the URL only exists after an
// awaited fetch and a post-await window.open is popup-blocked (which would
// reproduce "the button does nothing" for a brand-new reason).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const viewLoi = vi.fn();

vi.mock('../../../../services/api/siteService.js', () => ({
  viewLoi: (...a) => viewLoi(...a),
}));

import LOIDialog from '../LOIDialog.jsx';

const site = { id: 's1', code: 'BT-1', name: 'Cafe One', pushed: false };

const renderDialog = (props = {}) =>
  render(
    <LOIDialog site={site} onClose={vi.fn()} onSendBack={vi.fn()} canSendBack {...props}/>,
  );

beforeEach(() => {
  viewLoi.mockReset().mockResolvedValue({
    siteId: 's1', fileUrl: 'https://storage/signed?token=AAA',
    uploadedAt: '2026-07-01', uploadedBy: 'u1',
  });
});

describe('preview', () => {
  it('renders a real anchor to the signed URL', async () => {
    renderDialog();
    const link = await screen.findByRole('link', { name: /open loi/i });
    expect(link).toHaveAttribute('href', 'https://storage/signed?token=AAA');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(viewLoi).toHaveBeenCalledWith('s1');
  });

  it('refuses a javascript: URL and explains why', async () => {
    // safeHref guards every server-supplied href in this codebase. Rendering
    // nothing would reproduce "the button does nothing", so it must say so.
    viewLoi.mockResolvedValue({
      siteId: 's1', fileUrl: 'javascript:alert(1)', uploadedAt: '2026-07-01', uploadedBy: 'u1',
    });
    renderDialog();

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid web address/i);
    expect(screen.queryByRole('link', { name: /open loi/i })).toBeNull();
    // Send-back stays available — a bad link is exactly when you want it.
    expect(screen.getByRole('button', { name: /^send back$/i })).toBeInTheDocument();
  });

  it('shows the empty state when nothing has been uploaded', async () => {
    viewLoi.mockResolvedValue({ siteId: 's1', fileUrl: null, uploadedAt: null, uploadedBy: null });
    renderDialog();
    expect(await screen.findByText(/no loi has been uploaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open loi/i })).toBeNull();
  });

  it('surfaces a failure and retries on demand', async () => {
    const user = userEvent.setup();
    // The backend now 503s when a stored file cannot be signed.
    viewLoi.mockRejectedValueOnce({ detail: 'link could not be generated' });
    renderDialog();

    expect(await screen.findByRole('alert')).toHaveTextContent(/link could not be generated/i);

    viewLoi.mockResolvedValue({
      siteId: 's1', fileUrl: 'https://storage/signed?token=BBB',
      uploadedAt: '2026-07-01', uploadedBy: 'u1',
    });
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: /open loi/i }))
      .toHaveAttribute('href', 'https://storage/signed?token=BBB');
  });
});

describe('send back', () => {
  it('requires comments and never calls the API without them', async () => {
    const user = userEvent.setup();
    const onSendBack = vi.fn();
    renderDialog({ onSendBack });

    await user.click(await screen.findByRole('button', { name: /^send back$/i }));

    expect(await screen.findByText(/comments are required/i)).toBeInTheDocument();
    expect(onSendBack).not.toHaveBeenCalled();
  });

  it('sends the trimmed comments and closes', async () => {
    const user = userEvent.setup();
    const onSendBack = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderDialog({ onSendBack, onClose });

    await user.type(await screen.findByRole('textbox'), '  Wrong tenant named.  ');
    await user.click(screen.getByRole('button', { name: /^send back$/i }));

    expect(onSendBack).toHaveBeenCalledWith(site, 'Wrong tenant named.');
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces a send-back failure without closing', async () => {
    const user = userEvent.setup();
    const onSendBack = vi.fn().mockRejectedValue({ detail: 'Site already pushed.' });
    const onClose = vi.fn();
    renderDialog({ onSendBack, onClose });

    await user.type(await screen.findByRole('textbox'), 'wrong file');
    await user.click(screen.getByRole('button', { name: /^send back$/i }));

    expect(await screen.findByText(/site already pushed/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is hidden once the site has been pushed to Legal', async () => {
    renderDialog({ canSendBack: false });
    await screen.findByRole('link', { name: /open loi/i });
    expect(screen.queryByRole('button', { name: /^send back$/i })).toBeNull();
  });
});

it('closes on Escape', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  renderDialog({ onClose });
  await screen.findByRole('link', { name: /open loi/i });
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalled();
});
