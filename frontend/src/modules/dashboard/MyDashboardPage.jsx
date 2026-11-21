// skipcq: JS-0833
import React from 'react';
import LiveDashboard from '../shared/dashboard/LiveDashboard.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from '../business-admin/jwt.js';

// "Dashboard" for supervisors and executives in every module. An executive
// working in NSO through NSO supervisor access reads the NSO supervisor view.
export default function MyDashboardPage() {
  const { borrowedModule } = useSession();
  const fullName = decodeJwtPayload(getAuthToken()).user_metadata?.full_name;
  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1320, margin: '0 auto', boxSizing: 'border-box' }}>
      <LiveDashboard nso={borrowedModule === 'nso'} viewer={fullName} />
    </div>
  );
}
