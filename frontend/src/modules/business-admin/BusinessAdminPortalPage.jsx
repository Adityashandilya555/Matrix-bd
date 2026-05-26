import React from 'react';
import { getAuthToken, clearAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from './jwt.js';
import GateScreen from './GateScreen.jsx';
import TeamDashboard from './TeamDashboard.jsx';

export default function BusinessAdminPortalPage() {
  const [token, setToken] = React.useState(() => getAuthToken());
  const role = decodeJwtPayload(token).role;

  if (!token || role !== 'business_admin') {
    return <GateScreen onAuth={setToken}/>;
  }
  return <TeamDashboard onLogout={() => { clearAuthToken(); setToken(null); }}/>;
}
