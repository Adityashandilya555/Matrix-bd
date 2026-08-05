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

describe('rotating a code', () => {
  // The reveal is per-code, not a boolean. Rotating swaps the `code` prop on a
  // component that stays mounted, so a boolean would carry the reveal across
  // and print the brand new credential in plaintext with nobody asking — the
  // one moment the masking most needs to hold.
  const withCode = (code) => (
    <OrgModuleCard mod={{ ...MOD, code }} onRotate={vi.fn()} onRemove={vi.fn()} />
  );

  it('re-masks when the code changes under a revealed chip', async () => {
    const user = userEvent.setup();
    const { rerender } = render(withCode('OLDCODE111'));
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('OLDCODE111')).toBeInTheDocument();

    rerender(withCode('NEWCODE222'));
    expect(screen.queryByText('NEWCODE222')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
  });

  it('can reveal the new code on a fresh, deliberate click', async () => {
    const user = userEvent.setup();
    const { rerender } = render(withCode('OLDCODE111'));
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    rerender(withCode('NEWCODE222'));

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('NEWCODE222')).toBeInTheDocument();
  });

  it('does not re-reveal if an earlier code cycles back', async () => {
    // Can't realistically happen — rotation mints a random code and revokes the
    // old one. It is here to pin the MECHANISM: re-masking must key on the code
    // changing, not on `revealed === code`. The value-equality version passes
    // the two tests above and fails this one.
    const user = userEvent.setup();
    const { rerender } = render(withCode('OLDCODE111'));
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    rerender(withCode('NEWCODE222'));
    rerender(withCode('OLDCODE111'));
    expect(screen.queryByText('OLDCODE111')).toBeNull();
  });
});
