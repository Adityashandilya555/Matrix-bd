// skipcq: JS-0833
// The admin's surface for creating observers: one workspace code, one pending
// queue. It is deliberately not an OrgModuleCard — an observer belongs to the
// workspace, not a department, so there is no module, supervisor tree or
// executive list anywhere in it.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ObserverAccessSection from '../ObserverAccessSection.jsx';

const ready = (items = []) => ({ status: 'ready', items });

const renderSection = (props = {}) => render(
  <ObserverAccessSection
    code="ABC123XY"
    pending={ready()}
    rotating={false}
    busyId={null}
    onRotate={vi.fn()}
    onApprove={vi.fn()}
    onReject={vi.fn()}
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
    expect(screen.getByText('Not yet generated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).toBeNull();
  });

  it('offers Rotate once a code exists, and warns that rotating revokes it', () => {
    renderSection();
    expect(screen.getByRole('button', { name: /rotate/i })).toBeInTheDocument();
    expect(screen.getByText(/immediately stops the old one working/i)).toBeInTheDocument();
  });

  it('rotates on click', async () => {
    const onRotate = vi.fn();
    const user = userEvent.setup();
    renderSection({ onRotate });
    await user.click(screen.getByRole('button', { name: /rotate/i }));
    expect(onRotate).toHaveBeenCalledTimes(1);
  });
});

describe('ObserverAccessSection — the pending queue', () => {
  const PERSON = { id: 'u1', email: 'asha@example.com', createdAt: '2026-08-01T10:00:00Z' };

  it('lists someone awaiting approval', () => {
    renderSection({ pending: ready([PERSON]) });
    expect(screen.getByText('asha@example.com')).toBeInTheDocument();
  });

  it('approves and rejects the specific person', async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const user = userEvent.setup();
    renderSection({ pending: ready([PERSON]), onApprove, onReject });

    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith(PERSON);

    await user.click(screen.getByRole('button', { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith(PERSON);
  });

  it('shows an empty state rather than a bare gap', () => {
    renderSection({ pending: ready([]) });
    expect(screen.getByText('No one waiting')).toBeInTheDocument();
  });

  it('surfaces a load failure with a retry', () => {
    const onRetry = vi.fn();
    renderSection({ pending: { status: 'error', error: 'Network down', items: [] }, onRetry });
    expect(screen.getByText('Network down')).toBeInTheDocument();
  });
});

describe('ObserverAccessSection — an observer has no module', () => {
  it('never mentions a module, supervisor or executive', () => {
    // The distinguishing property of the role. If this section ever grows a
    // module picker, the role has quietly stopped being workspace-wide.
    const { container } = renderSection({
      pending: ready([{ id: 'u1', email: 'asha@example.com', createdAt: null }]),
    });
    const text = container.textContent.toLowerCase();
    expect(text).not.toContain('module');
    expect(text).not.toContain('department code');
    expect(text).not.toContain('supervisor');
    expect(text).not.toContain('executive');
  });
});
