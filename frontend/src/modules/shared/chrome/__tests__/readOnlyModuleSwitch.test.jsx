// skipcq: JS-0833
// The module switcher in the read-only strip.
//
// Without it, changing module meant leaving to the portal and re-entering
// through Workspace Access — three steps and a lost place in the app, every
// time. The switcher has to do exactly what that panel does, because the
// override is a module-level store the axios interceptors read: write it, then
// hard-reload so SessionContext picks it up at mount.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const activateOverride = vi.fn();
let session;

vi.mock('../../../../state/SessionContext.jsx', () => ({
  useSession: () => session,
}));
vi.mock('../../../../services/api/adminOverride.js', () => ({
  activateOverride: (...a) => activateOverride(...a),
}));

const ReadOnlyBanner = (await import('../ReadOnlyBanner.jsx')).default;

// jsdom refuses assignment to window.location.href, so stand in a plain object.
let href;
beforeEach(() => {
  activateOverride.mockReset();
  href = null;
  delete window.location;
  window.location = { set href(v) { href = v; }, get href() { return href; } };
  session = { isReadOnly: true, effectiveModule: 'design', role: 'supervisor' };
});

const sel = () => screen.getByTestId('read-only-module-switch');

describe('the read-only module switcher', () => {
  it('is not rendered for anyone who is not read-only', () => {
    session = { isReadOnly: false, effectiveModule: 'design', role: 'supervisor' };
    render(<ReadOnlyBanner />);
    expect(screen.queryByTestId('read-only-module-switch')).toBeNull();
  });

  it('shows the module currently being viewed', () => {
    render(<ReadOnlyBanner />);
    expect(sel().value).toBe('design');
  });

  it('offers every workspace module', () => {
    render(<ReadOnlyBanner />);
    const values = [...sel().options].map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(['bd', 'legal', 'design', 'project', 'project_excellence', 'nso']),
    );
  });

  it('writes the override and lands on the new module', async () => {
    const user = userEvent.setup();
    render(<ReadOnlyBanner />);
    await user.selectOptions(sel(), 'legal');
    expect(activateOverride).toHaveBeenCalledWith({ role: 'supervisor', module: 'legal' });
    expect(href).toBe('/legal');
  });

  it('hard-navigates rather than soft-navigating', async () => {
    // The load-bearing detail. activateOverride writes the module-level store,
    // but SessionContext copies it into React state only at mount — a soft
    // navigation would arrive at the new module with the old one still in
    // context and every query scoped to the wrong module.
    const user = userEvent.setup();
    render(<ReadOnlyBanner />);
    await user.selectOptions(sel(), 'nso');
    expect(href).toBe('/nso');
  });

  it('carries the current role over instead of resetting to supervisor', async () => {
    // An observer reading as an executive is deliberately looking at an
    // executive's slice; silently promoting them on every module change
    // would undo that.
    session = { isReadOnly: true, effectiveModule: 'bd', role: 'executive' };
    const user = userEvent.setup();
    render(<ReadOnlyBanner />);
    await user.selectOptions(sel(), 'project');
    expect(activateOverride).toHaveBeenCalledWith({ role: 'executive', module: 'project' });
  });

  it('does nothing when the same module is re-picked', async () => {
    const user = userEvent.setup();
    render(<ReadOnlyBanner />);
    await user.selectOptions(sel(), 'design');
    expect(activateOverride).not.toHaveBeenCalled();
    expect(href).toBeNull();
  });

  it('still offers Leave module', async () => {
    // Switching module and leaving entirely are different intents; the
    // switcher must not have quietly replaced the exit.
    const onLeave = vi.fn();
    const user = userEvent.setup();
    render(<ReadOnlyBanner onLeave={onLeave} />);
    await user.click(screen.getByRole('button', { name: /leave module/i }));
    expect(onLeave).toHaveBeenCalled();
  });

  it('names the module in the banner text, from the same list it switches over', () => {
    session = { isReadOnly: true, effectiveModule: 'project_excellence', role: 'supervisor' };
    render(<ReadOnlyBanner />);
    expect(screen.getByTestId('read-only-banner').textContent)
      .toMatch(/viewing Project Excellence as a supervisor/);
  });
});
