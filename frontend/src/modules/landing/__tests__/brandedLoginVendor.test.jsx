// skipcq: JS-0833
// The login fork after the workspace code: /login/:code offers Retail login
// and Vendor login; Retail is today's Matrix page unchanged, Vendor signs a
// vendor-platform account in with the SAME workspace code.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const getWorkspaceBranding = vi.fn();
const checkAccountState = vi.fn();
const signInWithWorkspaceCode = vi.fn();
const signupAsVendor = vi.fn();
vi.mock('../../../services/api/supabaseAuth.js', () => ({
  getWorkspaceBranding: (...a) => getWorkspaceBranding(...a),
  checkAccountState: (...a) => checkAccountState(...a),
  signInWithWorkspaceCode: (...a) => signInWithWorkspaceCode(...a),
  signupAsVendor: (...a) => signupAsVendor(...a),
  signupAsSupervisor: vi.fn(), signupAsExecutive: vi.fn(), signupAsObserver: vi.fn(),
  setupPassword: vi.fn(), requestPasswordReset: vi.fn(), completePasswordReset: vi.fn(),
  PendingApprovalError: class extends Error {}, InvalidCredentialsError: class extends Error {},
}));

const { default: BrandedLoginPage } = await import('../BrandedLoginPage.jsx');

const CODE = 'BTOKAI-4F8A1C9E2B7D60A3';
function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/login/:code/:side?" element={<><BrandedLoginPage /><Where /></>} />
      <Route path="/vendor" element={<p>VENDOR PORTAL</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  [getWorkspaceBranding, checkAccountState, signInWithWorkspaceCode, signupAsVendor].forEach((f) => f.mockReset());
  getWorkspaceBranding.mockResolvedValue({ found: true, name: 'Blue Tokai', logo_url: null });
});

describe('login fork after the workspace code', () => {
  it('offers Retail login and Vendor login, and each goes to its side', async () => {
    const user = userEvent.setup();
    renderAt(`/login/${CODE}`);
    await user.click(await screen.findByRole('button', { name: 'Vendor login' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/login/${CODE}/vendor`);
    await user.click(screen.getByRole('button', { name: /choose retail login/i }));
    await user.click(screen.getByRole('button', { name: 'Retail login' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/login/${CODE}/retail`);
  });

  it('keeps the Retail page as it was: three join modes, no platform sent', async () => {
    const user = userEvent.setup();
    checkAccountState.mockResolvedValue('active');
    renderAt(`/login/${CODE}/retail`);
    await user.type(await screen.findByLabelText('Work email'), 'exec@bluetokai.example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(checkAccountState).toHaveBeenCalledWith('exec@bluetokai.example', CODE);
    await user.click(screen.getByRole('tab', { name: /^join$/i }));
    for (const mode of ['Supervisor', 'Executive', 'Observer']) {
      expect(screen.getByRole('button', { name: mode })).toBeInTheDocument();
    }
  });

  it('signs a vendor in on the Vendor side with platform vendor', async () => {
    const user = userEvent.setup();
    checkAccountState.mockResolvedValue('active');
    signInWithWorkspaceCode.mockResolvedValue({ access_token: `x.${btoa(JSON.stringify({ app_metadata: { role: 'vendor' } }))}.y` });
    renderAt(`/login/${CODE}/vendor`);
    expect(await screen.findByText('Vendor login')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Work email'), 'owner@shreeji.example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(checkAccountState).toHaveBeenCalledWith('owner@shreeji.example', CODE, { platform: 'vendor' });
    await user.type(await screen.findByLabelText('Password'), 'secret1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signInWithWorkspaceCode).toHaveBeenCalledWith('owner@shreeji.example', CODE, 'secret1', { platform: 'vendor' });
    expect(await screen.findByText('VENDOR PORTAL')).toBeInTheDocument();
  });

  it('offers only the staff-code join on the Vendor side and sends the workspace code', async () => {
    const user = userEvent.setup();
    signupAsVendor.mockResolvedValue({});
    renderAt(`/login/${CODE}/vendor`);
    await user.click(await screen.findByRole('tab', { name: /^join$/i }));
    expect(screen.queryByRole('button', { name: 'Supervisor' })).toBeNull();
    await user.type(screen.getByLabelText('Work email'), 'site@shreeji.example');
    await user.type(screen.getByLabelText('Staff code'), 'VND-5A7C1E9B3D2F4086');
    await user.click(screen.getByRole('button', { name: /request access/i }));
    expect(signupAsVendor).toHaveBeenCalledWith('site@shreeji.example', 'VND-5A7C1E9B3D2F4086', CODE);
  });

  it('points a vendor account on the Retail side to Vendor login, and a stranger on the Vendor side to Retail', async () => {
    const user = userEvent.setup();
    checkAccountState.mockResolvedValue('vendor_account');
    renderAt(`/login/${CODE}/retail`);
    await user.type(await screen.findByLabelText('Work email'), 'owner@shreeji.example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Go to Vendor login' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/login/${CODE}/vendor`);

    checkAccountState.mockResolvedValue('unknown');
    await user.type(await screen.findByLabelText('Work email'), 'exec@bluetokai.example');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/registered as a vendor/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to retail login/i })).toBeInTheDocument();
  });

  it('sends an unknown side back to the chooser', async () => {
    renderAt(`/login/${CODE}/partner`);
    expect(await screen.findByRole('button', { name: 'Retail login' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/login/${CODE}`);
  });
});
