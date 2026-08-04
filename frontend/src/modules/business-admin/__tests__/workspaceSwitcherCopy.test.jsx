// skipcq: JS-0833
// One panel, two audiences. The admin's copy says the backend "will bypass its
// normal role and module guards" — true for a business admin, and both wrong
// and alarming for an observer, whose every write is refused no matter which
// role it enters as.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const activate = vi.fn();
let stored = null;
vi.mock('../../../services/api/adminOverride.js', () => ({
  getStoredOverride: () => stored,
  activateOverride: (...a) => activate(...a),
  deactivateOverride: vi.fn(),
}));

import WorkspaceSwitcherPanel from '../WorkspaceSwitcherPanel.jsx';

const text = (c) => c.textContent.toLowerCase();

beforeEach(() => { stored = null; activate.mockReset(); });

describe('WorkspaceSwitcherPanel — the observer variant', () => {
  it('never claims the guards are bypassed', () => {
    const { container } = render(<WorkspaceSwitcherPanel variant="observer" />);
    expect(text(container)).not.toContain('bypass');
  });

  it('says plainly that nothing can be changed', () => {
    const { container } = render(<WorkspaceSwitcherPanel variant="observer" />);
    expect(text(container)).toContain('read-only');
    expect(text(container)).toContain('refused');
  });

  it('does not call it a simulation — the observer is really only reading', () => {
    const { container } = render(<WorkspaceSwitcherPanel variant="observer" />);
    expect(text(container)).not.toContain('simulate');
  });

  it('labels the action for what it is', () => {
    render(<WorkspaceSwitcherPanel variant="observer" />);
    expect(screen.getByRole('button', { name: /open module/i })).toBeInTheDocument();
  });

  it('says "Viewing", not "Active simulation", once one is open', () => {
    stored = { role: 'supervisor', module: 'design' };
    const { container } = render(<WorkspaceSwitcherPanel variant="observer" />);
    expect(text(container)).toContain('viewing: supervisor · design');
    expect(text(container)).not.toContain('active simulation');
  });
});

describe('WorkspaceSwitcherPanel — the admin variant is untouched', () => {
  it('keeps its own copy, bypass warning included', () => {
    const { container } = render(<WorkspaceSwitcherPanel />);
    expect(text(container)).toContain('bypass');
    expect(text(container)).toContain('simulate');
  });

  it('keeps its own button label', () => {
    render(<WorkspaceSwitcherPanel />);
    expect(screen.getByRole('button', { name: /enter workspace/i })).toBeInTheDocument();
  });

  it('defaults to the admin variant when none is given', () => {
    const { container } = render(<WorkspaceSwitcherPanel variant="something-else" />);
    expect(text(container)).toContain('bypass');
  });
});

describe('WorkspaceSwitcherPanel — the roles on offer', () => {
  it('offers exactly the two the backend accepts for an observer', () => {
    // _OBSERVER_OVERRIDE_ROLES in app/core/deps.py. Offering business_admin
    // would be a control that silently does nothing.
    render(<WorkspaceSwitcherPanel variant="observer" />);
    const options = [...screen.getAllByRole('option')].map((o) => o.value);
    expect(options).toContain('supervisor');
    expect(options).toContain('executive');
    expect(options).not.toContain('business_admin');
    expect(options).not.toContain('observer');
  });

  it('stores the chosen role and module before leaving', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSwitcherPanel variant="observer" />);
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'legal');
    await user.click(screen.getByRole('button', { name: /open module/i }));
    expect(activate).toHaveBeenCalledWith({ role: 'supervisor', module: 'legal' });
  });
});
