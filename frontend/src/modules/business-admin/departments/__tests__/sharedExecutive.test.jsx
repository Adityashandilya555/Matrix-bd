// skipcq: JS-0833
// An executive can report to several supervisors within one module, so the same
// person legitimately appears in more than one place on this card.
//
// Two things break when that happens and nobody has thought about it: the header
// count treats rows as people, and Remove — which sits inside each supervisor's
// group — deactivates the whole account from either row.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrgModuleCard from '../OrgModuleCard.jsx';

const SHARED = { id: 'exe-1', email: 'exe1@example.com', name: 'Exe One' };

// exe1 reports to both BD supervisors — the case the whole change exists for.
const mod = (over = {}) => ({
  module: 'bd',
  code: 'ABC123',
  supervisors: [
    { id: 'sup-1', email: 's1@example.com', name: 'Supr One', executives: [SHARED] },
    { id: 'sup-2', email: 's2@example.com', name: 'Supr Two', executives: [SHARED] },
  ],
  unassignedExecutives: [],
  ...over,
});

describe('the executive count', () => {
  it('counts one person, not one row per supervisor', () => {
    render(<OrgModuleCard mod={mod()} onRotate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/1 executive$/)).toBeInTheDocument();
  });

  it('still counts two distinct people as two', () => {
    const other = { id: 'exe-2', email: 'exe2@example.com', name: 'Exe Two' };
    const m = mod();
    m.supervisors[1].executives = [other];
    render(<OrgModuleCard mod={m} onRotate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/2 executives/)).toBeInTheDocument();
  });

  it('counts an unassigned executive too, and only once', () => {
    const m = mod({ unassignedExecutives: [SHARED] });
    render(<OrgModuleCard mod={m} onRotate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/1 executive$/)).toBeInTheDocument();
  });
});

describe('Remove inside a supervisor group', () => {
  const openBoth = async (user) => {
    for (const name of [/Supr One/, /Supr Two/]) {
      const toggle = screen.getAllByRole('button').find((b) => name.test(b.textContent));
      if (toggle) await user.click(toggle);
    }
  };

  it('names the supervisor whose group it was pressed in', async () => {
    // Without this the backend cannot tell which of the two links to drop, and
    // falls back to deactivating the account — from either row.
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<OrgModuleCard mod={mod()} onRotate={vi.fn()} onRemove={onRemove} />);
    await openBoth(user);

    const removes = screen.getAllByRole('button', { name: /remove executive/i });
    expect(removes.length).toBeGreaterThan(0);
    await user.click(removes[0]);
    await user.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'exe-1' }),
      { module: 'bd', supervisorId: 'sup-1' },
    );
  });

  it('sends no context for a supervisor row — that really is whole-account', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<OrgModuleCard mod={mod()} onRotate={vi.fn()} onRemove={onRemove} />);

    await user.click(screen.getAllByRole('button', { name: /remove supervisor/i })[0]);
    await user.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'sup-1' }));
    expect(onRemove.mock.calls[0][1]).toBeUndefined();
  });

  it('sends no context for an unassigned executive either', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <OrgModuleCard
        mod={mod({ supervisors: [], unassignedExecutives: [SHARED] })}
        onRotate={vi.fn()} onRemove={onRemove} />,
    );

    await user.click(screen.getByRole('button', { name: /remove executive/i }));
    await user.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(onRemove.mock.calls[0][1]).toBeUndefined();
  });

  it('still omits Remove entirely when no handler is passed', () => {
    render(<OrgModuleCard mod={mod()} onRotate={vi.fn()} onRemove={undefined} />);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });
});
