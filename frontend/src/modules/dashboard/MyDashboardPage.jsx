// skipcq: JS-0833
import React from 'react';
import LiveDashboard from '../shared/dashboard/LiveDashboard.jsx';
import { useSession } from '../../state/SessionContext.jsx';

// "Dashboard" for supervisors and executives in every module. An executive
// working in NSO through NSO supervisor access reads the NSO supervisor view.
export default function MyDashboardPage() {
  const { borrowedModule } = useSession();
  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1320, margin: '0 auto', boxSizing: 'border-box' }}>
      <LiveDashboard nso={borrowedModule === 'nso'} />
    </div>
  );
}
