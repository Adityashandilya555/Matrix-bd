import React from 'react';
import { Navigate } from 'react-router-dom';
import { clearAuthToken } from '../../services/api/authToken.js';
import { PRODUCT_NAME } from '../../router/routes.js';
import { useAuthToken } from '../../state/useAuthToken.js';
import { decodeJwtPayload } from './jwt.js';
import TeamDashboard from './TeamDashboard.jsx';

class BusinessAdminErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Business admin dashboard crashed', error, info);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const btn = {
      height: 36, padding: '0 16px', borderRadius: 10, border: '1px solid var(--zm-line-strong)',
      background: 'var(--zm-surface-2)', color: 'var(--zm-fg)', fontSize: 13, fontWeight: 650, cursor: 'pointer',
    };
    return (
      <div style={{ minHeight: '100vh', background: 'var(--zm-bg)', color: 'var(--zm-fg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
            {PRODUCT_NAME} · Business admin
          </div>
          <h1 style={{ margin: '8px 0 6px', fontSize: 22, fontWeight: 720, letterSpacing: '-0.02em' }}>
            Approval center hit a display error
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--zm-fg-2)', lineHeight: 1.55 }}>
            Refresh the view, or sign out and back in.
          </p>
          <div style={{ margin: '16px 0', padding: '10px 14px', borderRadius: 10, fontSize: 12.5,
            background: 'var(--zm-danger-soft)', color: 'var(--zm-danger)', border: '1px solid var(--zm-danger)' }}>
            {this.state.error?.message || 'Dashboard render failed.'}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button style={btn} type="button" onClick={this.handleRetry}>Refresh</button>
            <button style={btn} type="button" onClick={this.props.onLogout}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }
}

export default function BusinessAdminPortalPage() {
  // Subscribe to the shared token store so a mid-session 401 (the axios
  // interceptor clears the token) immediately redirects to the welcome page,
  // instead of leaving the portal stuck rendering with a dead token while every
  // call 401s until a manual reload. (#129)
  const token = useAuthToken();
  const role = decodeJwtPayload(token).role;
  const logout = React.useCallback(() => {
    clearAuthToken(); // useAuthToken flips to null → redirect to /welcome
  }, []);

  if (!token || role !== 'business_admin') {
    // No standalone business-admin login gate: deep-linking to /business-admin
    // without a session bounces to the welcome page (the normal workspace-code →
    // branded-login flow, which routes business admins here once authenticated).
    // An authenticated non-admin is likewise sent to /welcome, whose
    // LandingRedirectIfAuthed forwards them to their own module home.
    return <Navigate to="/welcome" replace/>;
  }
  return (
    <BusinessAdminErrorBoundary key={token} onLogout={logout}>
      <TeamDashboard onLogout={logout}/>
    </BusinessAdminErrorBoundary>
  );
}
