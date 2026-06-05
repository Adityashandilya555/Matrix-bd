import React from 'react';
import TeamDashboard, { REAL_FETCHERS } from '../TeamDashboard.jsx';
import { mockFetchers } from './mockApprovalData.js';

// Dev-only harness: renders the full Approval Center with mock data so the UI can
// be reviewed/screenshotted without a backend or a real business_admin login.
// Mounted on a DEV-only route (#/business-admin-preview) in AppRouter.jsx.
export default function ApprovalCenterPreview() {
  // `?live` swaps to the real API (useful when a backend is running locally).
  const live = new URLSearchParams(window.location.hash.split('?')[1] || '').get('live') === '1';
  return (
    <TeamDashboard
      workspaceName="Blue Tokai Coffee"
      fetchers={live ? REAL_FETCHERS : mockFetchers}
      onLogout={() => window.alert('(preview) sign out')}
    />
  );
}
