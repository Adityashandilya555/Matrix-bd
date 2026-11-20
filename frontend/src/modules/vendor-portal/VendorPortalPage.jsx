// skipcq: JS-0833
// #/vendor/* — the vendor platform's own portal, for outside fit-out vendor
// companies. It lives outside RequireAuth and the tenant App shell for the same
// reason /business-admin and /observer do: the shared shell derives its nav from
// a Matrix module, which a vendor does not have.
//
// Gate: a token whose role is 'vendor'; anything else goes to /welcome, whose
// LandingRedirectIfAuthed sends a signed-in Matrix user to their own home. The
// server is the real boundary: get_current_user confines vendor tokens to
// /vendor/* and the auth routes (app/core/deps.py).
import React from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { signOut } from '../../services/api/supabaseAuth.js';
import { deactivateOverride } from '../../services/api/adminOverride.js';
import { getVendorMe } from '../../services/api/vendorPortalApi.js';
import { useAuthToken } from '../../state/useAuthToken.js';
import { decodeJwtPayload } from '../business-admin/jwt.js';
import VendorHome from './VendorHome.jsx';
import VendorSite from './VendorSite.jsx';
import VendorStaff from './VendorStaff.jsx';
import { safeAccent } from './format.js';
import { VendorContext } from './context.js';
import './vendor-portal.css';

class VendorErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('vendor portal crashed', err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="vp-center"><div className="vp-card" style={{ maxWidth: 420 }}>
        <h2>Something went wrong</h2>
        <p className="vp-muted">Reload the page to try again. If it keeps happening, sign out and back in.</p>
        <div className="vp-row"><button type="button" className="vp-btn primary" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" className="vp-btn" onClick={this.props.onLogout}>Sign out</button></div>
      </div></div>
    );
  }
}

function PortalShell({ onLogout }) {
  const [me, setMe] = React.useState({ status: 'loading' });
  const navigate = useNavigate();

  const load = React.useCallback(() => {
    setMe({ status: 'loading' });
    getVendorMe()
      .then((data) => setMe({ status: 'ready', data }))
      .catch((err) => setMe({ status: 'error', message: err?.detail || err?.message || 'Could not load your account.' }));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // Built before any early return so the hook order never changes.
  const data = me.status === 'ready' ? me.data : null;
  const ctx = React.useMemo(() => (data ? {
    user: data.user, vendor: data.vendor, brand: data.brand,
    isOwner: data.user?.vendorRole === 'owner', reloadMe: load,
  } : null), [data, load]);

  if (me.status === 'loading') return <div className="vp-center vp-muted">Loading your workspace…</div>;
  if (me.status === 'error') {
    return (
      <div className="vp-center"><div className="vp-card" style={{ maxWidth: 420 }}>
        <h2>We couldn&#39;t open your workspace</h2>
        <p className="vp-error">{me.message}</p>
        <div className="vp-row"><button type="button" className="vp-btn primary" onClick={load}>Try again</button>
          <button type="button" className="vp-btn" onClick={onLogout}>Sign out</button></div>
      </div></div>
    );
  }

  const { user, vendor, brand, isOwner } = ctx;
  const title = brand?.portalTitle || 'Fit-out portal';
  const accent = safeAccent(brand?.accentColor);

  return (
    <VendorContext.Provider value={ctx}>
      <div className="vp-root" style={accent ? { '--vp-accent': accent } : undefined}>
        <header className="vp-top"><div className="vp-top-in">
          <button type="button" className="vp-brand" style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
            onClick={() => navigate('/vendor')}>
            <span className="vp-mark" aria-hidden="true">
              {brand?.logoUrl ? <img src={brand.logoUrl} alt="" /> : (brand?.tenantName || 'V').slice(0, 2).toUpperCase()}
            </span>
            <span>{title}</span>
          </button>
          <nav className="vp-nav" aria-label="Vendor portal">
            <NavLink to="/vendor" end>My sites</NavLink>
            {isOwner && <NavLink to="/vendor/staff">Team</NavLink>}
          </nav>
          <div className="vp-who">
            <span><b>{vendor?.name}</b> · {user?.name || user?.email}</span>
            <button type="button" className="vp-btn sm" onClick={onLogout}>Sign out</button>
          </div>
        </div></header>
        <main className="vp-main"><div className="vp-wrap">
          <Routes>
            <Route index element={<VendorHome />} />
            <Route path="sites/:projectId" element={<VendorSite />} />
            <Route path="staff" element={isOwner ? <VendorStaff /> : <Navigate to="/vendor" replace />} />
            <Route path="*" element={<Navigate to="/vendor" replace />} />
          </Routes>
          {brand?.supportContact && <p className="vp-small vp-muted" style={{ marginTop: 32 }}>Need help? {brand.supportContact}</p>}
        </div></main>
      </div>
    </VendorContext.Provider>
  );
}

export default function VendorPortalPage() {
  const token = useAuthToken();
  const role = decodeJwtPayload(token).role;

  // A Matrix workspace override lives in sessionStorage; a vendor session must
  // never carry one, whatever this tab did before.
  React.useEffect(() => { deactivateOverride(); }, []);

  const logout = React.useCallback(() => {
    deactivateOverride();
    signOut();
  }, []);

  if (!token || role !== 'vendor') return <Navigate to="/welcome" replace />;
  return (
    <VendorErrorBoundary key={token} onLogout={logout}>
      <PortalShell onLogout={logout} />
    </VendorErrorBoundary>
  );
}
