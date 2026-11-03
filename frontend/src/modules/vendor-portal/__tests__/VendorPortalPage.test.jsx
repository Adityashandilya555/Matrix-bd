// skipcq: JS-0833
// The vendor portal opens only for a vendor token, loads the company and its
// sites from the API, and shows the owner-only Team page only to owners.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setAuthToken, clearAuthToken } from '../../../services/api/authToken.js';

const getVendorMe = vi.fn();
const getVendorHome = vi.fn();
vi.mock('../../../services/api/vendorPortalApi.js', () => ({
  getVendorMe: (...a) => getVendorMe(...a),
  getVendorHome: (...a) => getVendorHome(...a),
  getVendorProject: vi.fn(), listVendorUpdates: vi.fn(), acceptVendorPo: vi.fn(),
  saveVendorInitiation: vi.fn(), submitVendorUpdate: vi.fn(), getVendorStaff: vi.fn(),
  rotateVendorStaffCode: vi.fn(), decideVendorStaff: vi.fn(),
}));
vi.mock('../../../services/api/supabaseAuth.js', () => ({ signOut: vi.fn() }));

const { default: VendorPortalPage } = await import('../VendorPortalPage.jsx');

const token = (role) => `x.${btoa(JSON.stringify({ app_metadata: { role } }))}.y`;
const ME = (vendorRole) => ({
  user: { id: 'u1', email: 'owner@shreeji.example', name: 'Mr. Mehta', vendorRole },
  vendor: { id: 'v1', name: 'Shreeji Interiors', status: 'active' },
  brand: { tenantName: 'Blue Tokai', portalTitle: 'Blue Tokai Fit-Out Portal', accentColor: '#1D3F8C', welcomeText: 'Post by 7 pm.' },
});
const HOME = {
  kpis: { activeSites: 1, updatesDue: 1, posToAccept: 0, lateSites: 0 },
  alerts: [],
  projects: [{ id: 'p1', caCode: 'CA-2187', name: 'Koramangala 5th Block', city: 'Bengaluru', brand: 'Blue Tokai',
    siteType: 'non_mall', poNumber: 'PO/2187/26', poValue: 3850000, status: 'active', scheduleStatus: 'ontrack',
    day: 28, duration: 45, actualPct: 62, plannedPct: 61, slipDays: 0, targetDate: '2026-11-20' }],
};

const renderAt = (path = '/vendor') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/vendor/*" element={<VendorPortalPage />} />
      <Route path="/welcome" element={<div>WELCOME</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  clearAuthToken();
  getVendorMe.mockReset();
  getVendorHome.mockReset().mockResolvedValue(HOME);
});

describe('VendorPortalPage', () => {
  it('sends anyone without a vendor token to the welcome page', () => {
    act(() => setAuthToken(token('supervisor')));
    renderAt();
    expect(screen.getByText('WELCOME')).toBeInTheDocument();
    expect(getVendorMe).not.toHaveBeenCalled();
  });

  it('opens the portal for a vendor owner, with branding, sites and the Team link', async () => {
    getVendorMe.mockResolvedValue(ME('owner'));
    act(() => setAuthToken(token('vendor')));
    renderAt();
    expect(await screen.findByText('Blue Tokai Fit-Out Portal')).toBeInTheDocument();
    expect(await screen.findByText('Koramangala 5th Block')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByText('Post by 7 pm.')).toBeInTheDocument();
  });

  it('hides the Team page from site staff and redirects its URL home', async () => {
    getVendorMe.mockResolvedValue(ME('site_supervisor'));
    act(() => setAuthToken(token('vendor')));
    renderAt('/vendor/staff');
    expect(await screen.findByText('Koramangala 5th Block')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull();
  });

  it('shows a retry when the account cannot be loaded', async () => {
    getVendorMe.mockRejectedValue({ detail: 'Your vendor account is suspended.' });
    act(() => setAuthToken(token('vendor')));
    renderAt();
    expect(await screen.findByText('Your vendor account is suspended.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
