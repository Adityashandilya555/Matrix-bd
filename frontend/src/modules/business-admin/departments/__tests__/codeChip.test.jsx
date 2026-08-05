// skipcq: JS-0833
// Every join code on the Departments tab is masked until revealed.
//
// The observer code shipped masked and the six department codes shipped in
// plain text, which is the wrong way round if anything: a department code
// onboards a supervisor who can WRITE, where an observer code only mints a
// reader. The realistic leak is not an attacker — it is the admin screen-sharing
// this tab, or someone reading over their shoulder. One component, one rule.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrgModuleCard from '../OrgModuleCard.jsx';
import ObserverAccessSection from '../ObserverAccessSection.jsx';

const MOD = { module: 'bd', code: 'XHIHOS0X5HI', supervisors: [], unassignedExecutives: [] };

describe('a department code', () => {
  it('is masked until revealed', async () => {
    const user = userEvent.setup();
    render(<OrgModuleCard mod={MOD} onRotate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByText('XHIHOS0X5HI')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('XHIHOS0X5HI')).toBeInTheDocument();
  });

  it('hides again on a second click', async () => {
    const user = userEvent.setup();
    render(<OrgModuleCard mod={MOD} onRotate={vi.fn()} onRemove={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('XHIHOS0X5HI')).toBeNull();
  });

  it('masks with one dot per character, so the chip does not resize on reveal', () => {
    // Otherwise Rotate shifts out from under the cursor mid-click.
    render(<OrgModuleCard mod={MOD} onRotate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('•'.repeat(MOD.code.length))).toBeInTheDocument();
  });

  it('still says when a department has no code yet', () => {
    render(<OrgModuleCard mod={{ ...MOD, code: null }} onRotate={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('No code yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull();
  });

  it('shows no code block at all for a reader who cannot have one', () => {
    // The backend blanks the code for anyone whose real role is not the
    // business admin, so the observer portal would otherwise render a
    // permanent, misleading "No code yet" beside every department.
    render(<OrgModuleCard mod={{ ...MOD, code: null }} />);
    expect(screen.queryByText('No code yet')).toBeNull();
    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull();
  });
});

describe('the observer code', () => {
  it('is masked by the same component, so the two cannot drift', async () => {
    const user = userEvent.setup();
    render(
      <ObserverAccessSection code="OBSCODE99" observers={{ status: 'ready', items: [] }}
        onRotate={vi.fn()} onRevoke={vi.fn()} />,
    );
    expect(screen.queryByText('OBSCODE99')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('OBSCODE99')).toBeInTheDocument();
  });
});
