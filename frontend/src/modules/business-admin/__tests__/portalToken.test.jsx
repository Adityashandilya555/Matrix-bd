// Batch K — #129: BA portal reacts to a mid-session token clear.
// The standalone business-admin login gate was removed — clearing the token now
// redirects to /welcome (normal login flow) instead of rendering GateScreen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setAuthToken, clearAuthToken } from '../../../services/api/authToken.js';

vi.mock('../TeamDashboard.jsx', () => ({ default: () => <div>TEAM DASHBOARD</div> }));
vi.mock('../jwt.js', () => ({
  decodeJwtPayload: (t) => (t ? { role: 'business_admin' } : {}),
}));

import BusinessAdminPortalPage from '../BusinessAdminPortalPage.jsx';

beforeEach(() => clearAuthToken());

describe('BusinessAdminPortalPage token reactivity (#129)', () => {
  it('renders the dashboard with a valid BA token, then redirects to welcome on clear', () => {
    act(() => setAuthToken('ba-token'));
    render(
      <MemoryRouter initialEntries={['/business-admin']}>
        <Routes>
          <Route path="/business-admin" element={<BusinessAdminPortalPage />} />
          <Route path="/welcome" element={<div>WELCOME</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('TEAM DASHBOARD')).toBeInTheDocument();

    // Simulate the shared 401 interceptor clearing the token mid-session.
    act(() => clearAuthToken());
    expect(screen.getByText('WELCOME')).toBeInTheDocument();
    expect(screen.queryByText('TEAM DASHBOARD')).toBeNull();
  });
});
