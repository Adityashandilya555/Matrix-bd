// skipcq: JS-0833
// The admin's surface for observers: one workspace code, and the people who
// hold read-only access.
//
// Shaped as a sibling of OrgModuleCard — same header row, code chip and person
// rows — because on this tab it is still "a code, and who joined with it", and
// reading as a different kind of thing made it look like a different feature.
// It still must not become a department: no module, no supervisor tree, no
// executives.
//
// Pending sign-ups are NOT here any more. They live in Awaiting approval at the
// top of the tab with the pending supervisors; see DepartmentsTab's tests.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ObserverAccessSection from '../ObserverAccessSection.jsx';

const ready = (items = []) => ({ status: 'ready', items });

const renderSection = (props = {}) => render(
  <ObserverAccessSection
    code="ABC123XY"
    observers={ready()}
    rotating={false}
    busyId={null}
    onRotate={vi.fn()}
    onRevoke={vi.fn()}
    onRetry={vi.fn()}
    {...props}
  />,
);

describe('ObserverAccessSection — the code', () => {
  it('masks the code until it is revealed', async () => {
    // Shoulder-surfing a shared screen is the realistic leak, and the code is
    // the only thing standing between a stranger and a pending signup.
    const user = userEvent.setup();
    renderSection();
    expect(screen.queryByText('ABC123XY')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('ABC123XY')).toBeInTheDocument();
  });

  it('says so when no code has been minted, and offers Generate', () => {
    renderSection({ code: null });
    expect(screen.getByText('No code yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).toBeNull();
  });

  it('offers Rotate once a code exists', () => {
    renderSection();
    expect(screen.getByRole('button', { name: /rotate/i })).toBeInTheDocument();
  });

  it('rotates on click', async () => {
    const onRotate = vi.fn();
    const user = userEvent.setup();
    renderSection({ onRotate });
    await user.click(screen.getByRole('button', { name: /rotate/i }));
    expect(onRotate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a rotate failure instead of swallowing it', async () => {
    const user = userEvent.setup();
    renderSection({ onRotate: vi.fn().mockRejectedValue({ detail: 'Rotate blew up' }) });
    await user.click(screen.getByRole('button', { name: /rotate/i }));
    expect(await screen.findByText('Rotate blew up')).toBeInTheDocument();
  });
});

describe('ObserverAccessSection — the roster', () => {
  const ACTIVE = { id: 'u9', email: 'ravi@example.com', name: 'Ravi' };

  it('lists who currently holds workspace-wide read access', () => {
    // Without this the role is invisible after approval: an observer holds no
    // module membership, so it appears in no other list in the product.
    // Name on the primary line, email in the meta line — the same Person row
    // shape a supervisor gets, which is the point.
    renderSection({ observers: ready([ACTIVE]) });
    expect(screen.getByText('Ravi')).toBeInTheDocument();
    expect(screen.getByText(/ravi@example\.com/)).toBeInTheDocument();
  });

  it('counts them in the header, the way a department card counts its people', () => {
    renderSection({ observers: ready([ACTIVE]) });
    expect(screen.getByText(/1 observer · read-only, workspace-wide/i)).toBeInTheDocument();
  });

  it('says what that access actually is', () => {
    renderSection({ observers: ready([ACTIVE]) });
    expect(screen.getByText(/read-only across the whole workspace/i)).toBeInTheDocument();
  });

  it('revokes behind the same two-step confirm every other person row uses', async () => {
    // Not a one-click red pill. Revoking deletes the account, which is no more
    // reversible than removing a supervisor — and that has always been trash →
    // confirm.
    const onRevoke = vi.fn();
    const user = userEvent.setup();
    renderSection({ observers: ready([ACTIVE]), onRevoke });

    await user.click(screen.getByRole('button', { name: /remove observer/i }));
    expect(onRevoke).not.toHaveBeenCalled();
    expect(screen.getByText(/remove this observer\?/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(onRevoke).toHaveBeenCalledWith(ACTIVE);
  });

  it('lets the confirm be backed out of', async () => {
    const onRevoke = vi.fn();
    const user = userEvent.setup();
    renderSection({ observers: ready([ACTIVE]), onRevoke });
    await user.click(screen.getByRole('button', { name: /remove observer/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onRevoke).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /remove observer/i })).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare gap', () => {
    renderSection({ observers: ready([]) });
    expect(screen.getByText(/no one has read-only access yet/i)).toBeInTheDocument();
  });

  it('surfaces a load failure with a retry', () => {
    renderSection({ observers: { status: 'error', error: 'Network down', items: [] } });
    expect(screen.getByText('Network down')).toBeInTheDocument();
  });

  it('omits remove when no handler is passed, rather than drawing a dead button', () => {
    renderSection({ observers: ready([ACTIVE]), onRevoke: undefined });
    expect(screen.queryByRole('button', { name: /remove observer/i })).toBeNull();
  });

  it('still renders when the roster prop is missing entirely', () => {
    // DepartmentsTab is shared with the observer portal, which passes none.
    renderSection({ observers: undefined });
    expect(screen.getByText('Observer access')).toBeInTheDocument();
  });
});

describe('ObserverAccessSection — an observer has no module', () => {
  it('never mentions a module, supervisor or executive', () => {
    // The distinguishing property of the role. If this section ever grows a
    // module picker, the role has quietly stopped being workspace-wide.
    const { container } = renderSection({
      observers: ready([{ id: 'u9', email: 'ravi@example.com', name: 'Ravi' }]),
    });
    const text = container.textContent.toLowerCase();
    expect(text).not.toContain('module');
    expect(text).not.toContain('department code');
    expect(text).not.toContain('supervisor');
    expect(text).not.toContain('executive');
  });

  it('carries no approval controls — that queue lives at the top of the tab', () => {
    // A second approval queue further down the page is how a request sits
    // unnoticed under a heading nobody scrolls to.
    renderSection({ observers: ready([{ id: 'u9', email: 'ravi@example.com' }]) });
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull();
  });
});
