// Batch K — #129: BA portal reacts to a mid-session token clear (drops to gate).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { setAuthToken, clearAuthToken } from '../../../services/api/authToken.js';

vi.mock('../GateScreen.jsx', () => ({ default: () => <div>GATE SCREEN</div> }));
vi.mock('../TeamDashboard.jsx', () => ({ default: () => <div>TEAM DASHBOARD</div> }));
vi.mock('../jwt.js', () => ({
  decodeJwtPayload: (t) => (t ? { role: 'business_admin' } : {}),
}));

import BusinessAdminPortalPage from '../BusinessAdminPortalPage.jsx';

beforeEach(() => clearAuthToken());

describe('BusinessAdminPortalPage token reactivity (#129)', () => {
  it('renders the dashboard with a valid BA token, then drops to the gate on clear', () => {
    act(() => setAuthToken('ba-token'));
    render(<BusinessAdminPortalPage />);
    expect(screen.getByText('TEAM DASHBOARD')).toBeInTheDocument();

    // Simulate the shared 401 interceptor clearing the token mid-session.
    act(() => clearAuthToken());
    expect(screen.getByText('GATE SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('TEAM DASHBOARD')).toBeNull();
  });
});
