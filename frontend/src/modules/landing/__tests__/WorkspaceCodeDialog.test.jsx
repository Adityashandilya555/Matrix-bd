// skipcq: JS-0833
// The workspace-code suggestion dropdown. It shipped mouse-only: options were
// not tab stops and there was no key handling, so a keyboard or screen-reader
// user could not pick a remembered code at all. It also fell back to listing
// EVERY stored code when the filter matched nothing, so typing a wrong code
// surfaced three unrelated ones.
//
// These lock the combobox contract: input keeps focus, arrows move a virtual
// cursor via aria-activedescendant, Enter takes the highlight without
// submitting, Escape dismisses, and a non-matching query shows nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
const getWorkspaceBranding = vi.fn();

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../../services/api/supabaseAuth.js', () => ({
  getWorkspaceBranding: (...a) => getWorkspaceBranding(...a),
}));
vi.mock('../LottiePanel.jsx', () => ({ default: () => null }));
vi.mock('../../../assets/lottie/workspace-community.json', () => ({ default: {} }));

import WorkspaceCodeDialog from '../WorkspaceCodeDialog.jsx';

class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}

const seed = (codes) =>
  localStorage.setItem('zm_workspace_codes', JSON.stringify(codes));

const openDialog = () => render(<WorkspaceCodeDialog open onClose={vi.fn()}/>);
const input = () => screen.getByRole('combobox');

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  navigate.mockReset();
  getWorkspaceBranding.mockReset().mockResolvedValue({});
});
afterEach(() => vi.unstubAllGlobals());

describe('suggestions list', () => {
  it('is not rendered when there is no history', () => {
    openDialog();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('pre-fills the most recent code and opens the list when clicked', async () => {
    const user = userEvent.setup();
    seed(['AAAA', 'BBBB']);
    openDialog();

    expect(input()).toHaveValue('AAAA');
    // The input is autoFocused on mount, so onFocus has already fired and won't
    // fire again — clicking must open the list or a mouse user is stranded.
    expect(document.activeElement).toBe(input());
    await user.click(input());
    // AAAA is already in the box, so only BBBB is worth offering.
    expect(screen.getByRole('option', { name: 'BBBB' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'AAAA' })).toBeNull();
  });

  it('shows nothing when the query matches no stored code', async () => {
    const user = userEvent.setup();
    seed(['AAAA', 'BBBB']);
    openDialog();

    await user.clear(input());
    await user.type(input(), 'ZZZZ');

    // The old fallback listed every stored code here, which was pure noise.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('narrows as the user types', async () => {
    const user = userEvent.setup();
    seed(['ALPHA-1', 'BETA-2', 'ALPHA-3']);
    openDialog();

    await user.clear(input());
    await user.type(input(), 'ALPHA');

    expect(screen.getByRole('option', { name: 'ALPHA-1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ALPHA-3' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'BETA-2' })).toBeNull();
  });
});

describe('keyboard navigation', () => {
  it('moves the highlight with the arrow keys and marks it aria-selected', async () => {
    const user = userEvent.setup();
    seed(['AAAA', 'BBBB', 'CCCC']);
    openDialog();

    await user.clear(input());          // empty query → all three offered
    await user.keyboard('{ArrowDown}');

    const first = screen.getByRole('option', { name: 'AAAA' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input()).toHaveAttribute('aria-activedescendant', first.id);

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'BBBB' })).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'false');
  });

  it('wraps from the last option back to the first', async () => {
    const user = userEvent.setup();
    seed(['AAAA', 'BBBB']);
    openDialog();

    await user.clear(input());
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('option', { name: 'AAAA' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects the highlighted option with Enter instead of submitting', async () => {
    const user = userEvent.setup();
    seed(['AAAA', 'BBBB']);
    openDialog();

    await user.clear(input());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(input()).toHaveValue('AAAA');
    expect(screen.queryByRole('listbox')).toBeNull();
    // Enter picked a suggestion; it must NOT have submitted the form.
    expect(getWorkspaceBranding).not.toHaveBeenCalled();
  });

  it('dismisses the list with Escape', async () => {
    const user = userEvent.setup();
    seed(['AAAA', 'BBBB']);
    openDialog();

    await user.clear(input());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('submits normally with Enter when nothing is highlighted', async () => {
    const user = userEvent.setup();
    openDialog();

    await user.type(input(), 'BTOKAI-7X9F');
    await user.keyboard('{Enter}');

    expect(getWorkspaceBranding).toHaveBeenCalledWith('BTOKAI-7X9F');
  });
});

describe('persistence', () => {
  it('stores the code on a successful submit', async () => {
    const user = userEvent.setup();
    openDialog();

    await user.type(input(), 'btokai-7x9f');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(getWorkspaceBranding).toHaveBeenCalledWith('BTOKAI-7X9F');
    expect(JSON.parse(localStorage.getItem('zm_workspace_codes'))).toEqual(['BTOKAI-7X9F']);
  });

  it('does not store a code the server could not be asked about', async () => {
    const user = userEvent.setup();
    getWorkspaceBranding.mockRejectedValue(new Error('offline'));
    openDialog();

    await user.type(input(), 'BTOKAI-7X9F');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByRole('alert');
    expect(localStorage.getItem('zm_workspace_codes')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('rejects a malformed code without touching storage', async () => {
    const user = userEvent.setup();
    openDialog();

    await user.type(input(), 'ab');   // shorter than the 4-char minimum
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByRole('alert');
    expect(getWorkspaceBranding).not.toHaveBeenCalled();
    expect(localStorage.getItem('zm_workspace_codes')).toBeNull();
  });
});
