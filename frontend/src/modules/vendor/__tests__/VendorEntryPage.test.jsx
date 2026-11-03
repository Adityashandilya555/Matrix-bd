// skipcq: JS-0833
// #/vendor/:code forwards a configured vendor code to the static vendor page,
// and shows "not found" for anything else — a stale bookmark, a rotated code,
// or a build with no vendor codes at all.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ROUTES } from '../../../router/routes.js';

const openVendorPage = vi.fn();
vi.mock('../../../lib/vendorAccess.js', async (importOriginal) => ({
  ...(await importOriginal()),
  openVendorPage: () => openVendorPage(),
}));

const { default: VendorEntryPage } = await import('../VendorEntryPage.jsx');

const CODE = 'VND-9C2E7A41B03D5F68';
const renderAt = (code) => render(
  <MemoryRouter initialEntries={[`/vendor/${code}`]}>
    <Routes>
      <Route path={ROUTES.VENDOR_ENTRY} element={<VendorEntryPage />} />
      <Route path="/welcome" element={<p>Welcome page</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => openVendorPage.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe('VendorEntryPage', () => {
  it('opens the vendor page once for a configured code', () => {
    vi.stubEnv('VITE_VENDOR_WORKSPACE_CODES', `${CODE}=Shreeji Interiors`);
    const { rerender } = renderAt(CODE);
    expect(screen.getByText('Opening Shreeji Interiors')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the vendor workspace/i }))
      .toHaveAttribute('href', '/vendor/fit-out-tracker.html');
    rerender(
      <MemoryRouter initialEntries={[`/vendor/${CODE}`]}>
        <Routes><Route path={ROUTES.VENDOR_ENTRY} element={<VendorEntryPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(openVendorPage).toHaveBeenCalledTimes(1);
  });

  it('accepts the code in lower case, as a typed link might have it', () => {
    vi.stubEnv('VITE_VENDOR_WORKSPACE_CODES', `${CODE}=Shreeji Interiors`);
    renderAt(CODE.toLowerCase());
    expect(openVendorPage).toHaveBeenCalledTimes(1);
  });

  it('shows "not found" for a code that is not configured', () => {
    vi.stubEnv('VITE_VENDOR_WORKSPACE_CODES', `${CODE}=Shreeji Interiors`);
    renderAt('VND-0000000000000000');
    expect(screen.getByText('Vendor workspace not found')).toBeInTheDocument();
    expect(openVendorPage).not.toHaveBeenCalled();
  });

  it('shows "not found" when vendor entry is not configured at all', () => {
    vi.stubEnv('VITE_VENDOR_WORKSPACE_CODES', '');
    renderAt(CODE);
    expect(screen.getByText('Vendor workspace not found')).toBeInTheDocument();
    expect(openVendorPage).not.toHaveBeenCalled();
  });

  it('goes back to the welcome page from "not found"', async () => {
    vi.stubEnv('VITE_VENDOR_WORKSPACE_CODES', '');
    renderAt(CODE);
    screen.getByRole('button', { name: /back to home/i }).click();
    expect(await screen.findByText('Welcome page')).toBeInTheDocument();
  });
});
