// skipcq: JS-0833
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../router/routes.js';
import LiveDashboard from '../shared/dashboard/LiveDashboard.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { getAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from '../business-admin/jwt.js';

// "Dashboard" for supervisors and executives in every module. An executive
// working in NSO through NSO supervisor access reads the NSO supervisor view.
// Each module's own home, used when the backend has no dashboard yet.
const MODULE_HOME = {
  legal: ROUTES.LEGAL, design: ROUTES.DESIGN, project: ROUTES.PROJECT, nso: ROUTES.NSO,
  project_excellence: ROUTES.PROJECT_EXCELLENCE,
};

export default function MyDashboardPage() {
  const { borrowedModule, effectiveModule, session } = useSession();
  const navigate = useNavigate();
  const fullName = decodeJwtPayload(getAuthToken()).user_metadata?.full_name;
  const module = effectiveModule || session?.module;
  // If the backend predates the dashboard endpoints, go to the usual module page.
  const toModuleHome = React.useCallback(
    () => navigate(MODULE_HOME[module] || ROUTES.OVERVIEW, { replace: true }),
    [navigate, module],
  );
  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1320, margin: '0 auto', boxSizing: 'border-box' }}>
      <LiveDashboard key={`${module}:${borrowedModule || ''}`} nso={borrowedModule === 'nso'} viewer={fullName} onUnavailable={toModuleHome} />
    </div>
  );
}
