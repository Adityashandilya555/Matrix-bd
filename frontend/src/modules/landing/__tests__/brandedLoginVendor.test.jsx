// skipcq: JS-0833
// A vendor code opens the SAME /login/:code page in its vendor variant, while a
// Matrix workspace code keeps exactly the page it had: three join modes.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const getWorkspaceBranding = vi.fn();
vi.mock('../../../services/api/supabaseAuth.js', () => ({
  getWorkspaceBranding: (...a) => getWorkspaceBranding(...a),
  signupAsSupervisor: vi.fn(), signupAsExecutive: vi.fn(), signupAsObserver: vi.fn(), signupAsVendor: vi.fn(),
  signInWithWorkspaceCode: vi.fn(), checkAccountState: vi.fn(), setupPassword: vi.fn(),
  requestPasswordReset: vi.fn(), completePasswordReset: vi.fn(),
  PendingApprovalError: class extends Error {}, InvalidCredentialsError: class extends Error {},
}));

const { default: BrandedLoginPage } = await import('../BrandedLoginPage.jsx');

const renderAt = (code) => render(
  <MemoryRouter initialEntries={[`/login/${code}`]}>
    <Routes><Route path="/login/:code" element={<BrandedLoginPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => getWorkspaceBranding.mockReset());

describe('BrandedLoginPage — vendor codes', () => {
  it('shows the vendor variant and no Join tab when the workspace allows no self-join', async () => {
    getWorkspaceBranding.mockResolvedValue({ found: true, name: 'Shreeji Interiors', logo_url: null, platform: 'vendor', brand: 'Blue Tokai', join_allowed: false });
    renderAt('VND-9C2E7A41B03D5F68');
    expect(await screen.findByText('Vendor workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shreeji Interiors' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^join$/i })).toBeNull();
    expect(screen.getByLabelText('Work email')).toBeInTheDocument();
  });

  it('offers only the vendor staff join mode when joining is allowed', async () => {
    const user = userEvent.setup();
    getWorkspaceBranding.mockResolvedValue({ found: true, name: 'Shreeji Interiors', logo_url: null, platform: 'vendor', brand: 'Blue Tokai', join_allowed: true });
    renderAt('VND-9C2E7A41B03D5F68');
    await user.click(await screen.findByRole('tab', { name: /^join$/i }));
    expect(screen.getByLabelText('Staff code')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supervisor' })).toBeNull();
  });

  it('keeps the Matrix page unchanged for a workspace code', async () => {
    const user = userEvent.setup();
    getWorkspaceBranding.mockResolvedValue({ found: true, name: 'Blue Tokai', logo_url: null });
    renderAt('BTOKAI-4F8A1C9E2B7D60A3');
    expect(await screen.findByText('Workspace')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^join$/i }));
    for (const mode of ['Supervisor', 'Executive', 'Observer']) {
      expect(screen.getByRole('button', { name: mode })).toBeInTheDocument();
    }
  });
});
