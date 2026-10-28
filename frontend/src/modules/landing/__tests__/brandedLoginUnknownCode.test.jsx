// skipcq: JS-0833
// A /login/<code> link whose code doesn't exist. /tenancy/branding now answers
// `found: false` for it, and the page must show "Workspace not found" rather
// than a sign-in form that can never work.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const getWorkspaceBranding = vi.fn();
vi.mock('../../../services/api/supabaseAuth.js', () => ({
  getWorkspaceBranding: (...a) => getWorkspaceBranding(...a),
  signupAsSupervisor: vi.fn(),
  signupAsExecutive: vi.fn(),
  signupAsObserver: vi.fn(),
  passwordStatus: vi.fn(),
  signInBranded: vi.fn(),
  requestPasswordReset: vi.fn(),
  completePasswordReset: vi.fn(),
  PendingApprovalError: class extends Error {},
  InvalidCredentialsError: class extends Error {},
}));

const { default: BrandedLoginPage } = await import('../BrandedLoginPage.jsx');

const renderAt = (code) => render(
  <MemoryRouter initialEntries={[`/login/${code}`]}>
    <Routes><Route path="/login/:code" element={<BrandedLoginPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { getWorkspaceBranding.mockReset(); });

describe('BrandedLoginPage — the workspace code', () => {
  it('shows "Workspace not found" when the code does not exist', async () => {
    getWorkspaceBranding.mockResolvedValue({ found: false, name: null, logo_url: null });
    renderAt('NOPE-0000');
    expect(await screen.findByText('Workspace not found')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^join$/i })).toBeNull();
  });

  it('shows the sign-in page for a code that exists', async () => {
    getWorkspaceBranding.mockResolvedValue({ found: true, name: 'Acme', logo_url: null });
    renderAt('ACME-0000');
    expect(await screen.findByRole('tab', { name: /^join$/i })).toBeInTheDocument();
    expect(screen.queryByText('Workspace not found')).toBeNull();
  });
});
