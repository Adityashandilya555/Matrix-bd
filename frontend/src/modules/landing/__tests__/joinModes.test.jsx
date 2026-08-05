// skipcq: JS-0833
// The observer signup shipped with a backend route, an API helper, an admin
// pending queue — and no way for anyone to reach it. Both join forms offered
// exactly two modes, so nothing could ever land in that queue.
//
// These assert the wiring end to end, because "the endpoint exists" was already
// true when the feature was unreachable.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const calls = [];
vi.mock('../../../services/api/supabaseAuth.js', () => ({
  signupAsSupervisor: (...a) => { calls.push(['supervisor', ...a]); return Promise.resolve(); },
  signupAsExecutive: (...a) => { calls.push(['executive', ...a]); return Promise.resolve(); },
  signupAsObserver: (...a) => { calls.push(['observer', ...a]); return Promise.resolve(); },
  getWorkspaceBranding: vi.fn().mockResolvedValue({}),
  passwordStatus: vi.fn(),
  signInBranded: vi.fn(),
  requestPasswordReset: vi.fn(),
  completePasswordReset: vi.fn(),
  PendingApprovalError: class extends Error {},
  InvalidCredentialsError: class extends Error {},
}));

const { JOIN_MODES, JOIN_MODE_KEYS, joinMode } = await import('../joinModes.js');

beforeEach(() => { calls.length = 0; });

describe('the join modes table', () => {
  it('offers all three ways into a workspace', () => {
    expect(JOIN_MODE_KEYS).toEqual(['supervisor', 'executive', 'observer']);
  });

  it('routes each mode to its own signup endpoint', async () => {
    for (const key of JOIN_MODE_KEYS) await JOIN_MODES[key].signup('a@b.com', 'CODE');
    expect(calls.map((c) => c[0])).toEqual(['supervisor', 'executive', 'observer']);
  });

  it('tells an observer the business admin reviews it, not a supervisor', () => {
    // The distinguishing fact: an observer is workspace-level, so no supervisor
    // is involved anywhere in its lifecycle.
    expect(JOIN_MODES.observer.submitted).toMatch(/business admin/i);
    expect(JOIN_MODES.observer.submitted).not.toMatch(/supervisor/i);
    expect(JOIN_MODES.observer.codeLabel).toBe('Observer code');
  });

  it('every mode is fully described — no half-filled entry', () => {
    for (const key of JOIN_MODE_KEYS) {
      const m = JOIN_MODES[key];
      for (const field of ['tab', 'short', 'codeLabel', 'placeholder', 'hint', 'submitted']) {
        expect(typeof m[field], `${key}.${field}`).toBe('string');
        expect(m[field].length, `${key}.${field}`).toBeGreaterThan(0);
      }
      expect(typeof m.signup, `${key}.signup`).toBe('function');
    }
  });

  it('falls back to supervisor rather than crashing on an unknown key', () => {
    expect(joinMode('nonsense')).toBe(JOIN_MODES.supervisor);
    expect(joinMode(undefined)).toBe(JOIN_MODES.supervisor);
  });
});

describe('BrandedLoginPage — the Join panel', () => {
  const renderJoin = async () => {
    const { default: BrandedLoginPage } = await import('../BrandedLoginPage.jsx');
    const { MemoryRouter, Routes, Route } = await import('react-router-dom');
    // The page reads the workspace code off the route and renders "Workspace
    // not found" without one.
    render(
      <MemoryRouter initialEntries={['/login/BTOKAI']}>
        <Routes><Route path="/login/:code" element={<BrandedLoginPage />} /></Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: /^join$/i }));
  };

  it('shows an Observer tab beside Supervisor and Executive', async () => {
    await renderJoin();
    for (const label of ['Supervisor', 'Executive', 'Observer']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('asks for the observer code and submits to the observer endpoint', async () => {
    const user = userEvent.setup();
    await renderJoin();
    await user.click(screen.getByRole('button', { name: 'Observer' }));
    expect(screen.getByText('Observer code')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/work email/i), 'asha@example.com');
    await user.type(screen.getByLabelText(/observer code/i), 'ABC123XY');
    await user.click(screen.getByRole('button', { name: /request access/i }));

    expect(calls).toEqual([['observer', 'asha@example.com', 'ABC123XY']]);
  });

  it('accepts a code containing an underscore', async () => {
    // The backend mints codes with secrets.token_urlsafe, whose alphabet
    // includes '_'. The client regex excluded it, so ~15% of real codes were
    // rejected before the request was ever sent — with a message blaming the
    // user for mistyping.
    const user = userEvent.setup();
    await renderJoin();
    await user.click(screen.getByRole('button', { name: 'Observer' }));
    await user.type(screen.getByLabelText(/work email/i), 'asha@example.com');
    await user.type(screen.getByLabelText(/observer code/i), 'B2JN7IGG_DG');
    await user.click(screen.getByRole('button', { name: /request access/i }));

    expect(calls).toEqual([['observer', 'asha@example.com', 'B2JN7IGG_DG']]);
  });
});
