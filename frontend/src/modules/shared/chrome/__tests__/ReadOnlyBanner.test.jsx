// The persistent strip an observer carries through the workspace.
//
// It matters more than a banner usually would: the pages underneath render in
// their supervisor's shape, buttons included, so this is the only thing on
// screen that explains why pressing one does nothing.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const session = vi.fn();
vi.mock('../../../../state/SessionContext.jsx', () => ({ useSession: () => session() }));

import ReadOnlyBanner from '../ReadOnlyBanner.jsx';

const observer = (over = {}) => ({
  isReadOnly: true, effectiveModule: 'design', role: 'supervisor', ...over,
});

beforeEach(() => { session.mockReset().mockReturnValue(observer()); });

describe('ReadOnlyBanner — when it shows', () => {
  it('renders nothing at all for a writable session', () => {
    session.mockReturnValue({ isReadOnly: false, effectiveModule: 'bd', role: 'supervisor' });
    const { container } = render(<ReadOnlyBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows for a read-only session', () => {
    render(<ReadOnlyBanner />);
    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
  });

  it('is announced, not just drawn', () => {
    render(<ReadOnlyBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('ReadOnlyBanner — what it says', () => {
  it('names the role and the module, so the shape on screen is explained', () => {
    render(<ReadOnlyBanner />);
    const text = screen.getByTestId('read-only-banner').textContent;
    expect(text).toContain('Observer');
    expect(text).toContain('Design');
    expect(text).toContain('as a supervisor');
  });

  it('says executive when that is the view', () => {
    session.mockReturnValue(observer({ role: 'executive', effectiveModule: 'legal' }));
    expect(render(<ReadOnlyBanner />).container.textContent).toContain('as an executive');
  });

  it('drops the module clause rather than printing a raw slug it has no label for', () => {
    session.mockReturnValue(observer({ effectiveModule: 'something_new' }));
    const text = render(<ReadOnlyBanner />).container.textContent;
    expect(text).not.toContain('something_new');
    expect(text).toContain('Read-only');
  });

  it('spells out all three refusals — edit, approve, delete', () => {
    const text = render(<ReadOnlyBanner />).container.textContent;
    for (const verb of ['edited', 'approved', 'deleted']) expect(text).toContain(verb);
  });
});

describe('ReadOnlyBanner — leaving', () => {
  it('offers a way out and calls it', async () => {
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(<ReadOnlyBanner onLeave={onLeave} />);
    await user.click(screen.getByRole('button', { name: /leave module/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('omits the button when there is nowhere to go, rather than drawing a dead one', () => {
    render(<ReadOnlyBanner />);
    expect(screen.queryByRole('button', { name: /leave module/i })).toBeNull();
  });
});
