import React from 'react';
import { getAuthToken, clearAuthToken } from '../../services/api/authToken.js';
import { decodeJwtPayload } from './jwt.js';
import GateScreen from './GateScreen.jsx';
import TeamDashboard from './TeamDashboard.jsx';
import './TeamDashboard.css';

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
    return (
      <div className="ba-shell">
        <main className="ba-page">
          <section className="ba-hero">
            <div>
              <div className="ba-eyebrow">Matrix · Business admin</div>
              <h1 className="ba-title">Business Admin Command Center</h1>
              <p className="ba-subtitle">
                The command center hit a display error. Refresh the view, or sign out and sign back in.
              </p>
              <div className="ba-error" style={{ marginTop: 16 }}>
                {this.state.error?.message || 'Dashboard render failed.'}
              </div>
            </div>
            <div className="ba-actions">
              <button className="ba-button" type="button" onClick={this.handleRetry}>Refresh</button>
              <button className="ba-button" type="button" onClick={this.props.onLogout}>Sign out</button>
            </div>
          </section>
        </main>
      </div>
    );
  }
}

export default function BusinessAdminPortalPage() {
  const [token, setToken] = React.useState(() => getAuthToken());
  const role = decodeJwtPayload(token).role;
  const logout = React.useCallback(() => {
    clearAuthToken();
    setToken(null);
  }, []);

  if (!token || role !== 'business_admin') {
    return <GateScreen onAuth={setToken}/>;
  }
  return (
    <BusinessAdminErrorBoundary key={token} onLogout={logout}>
      <TeamDashboard onLogout={logout}/>
    </BusinessAdminErrorBoundary>
  );
}
