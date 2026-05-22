import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useSession } from './state/SessionContext.jsx';
import { useSites } from './state/SitesContext.jsx';
import TopBar from './modules/shared/chrome/TopBar.jsx';
import Sidebar from './modules/shared/chrome/Sidebar.jsx';
import SiteDrawer from './modules/shared/site-drawer/SiteDrawer.jsx';
import { buildDrawerSite } from './lib/buildDrawerSite.js';
import Icon from './modules/shared/primitives/Icon.jsx';
import { filterByScope } from './rbac/scope.js';

// App.jsx is now the chrome shell only.
// Routing is handled by AppRouter / <Outlet/>.
// All view-specific logic lives in the page components.

export default function App() {
  const { user, role, setRole, dark, toggleDark } = useSession();
  const { drafts, shortlist, staging, archive, createDraft } = useSites();
  const navigate = useNavigate();
  const location = useLocation();

  const [openSite, setOpenSite] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  // SiteDrawer driven by URL search param ?site=<id>
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const siteId = params.get('site');
    if (!siteId) { setOpenSite(null); return; }
    // Find site across all lists
    const all = [...drafts, ...shortlist, ...staging, ...archive];
    const found = all.find(s => s.id === siteId || s.code === siteId);
    if (found) setOpenSite(buildDrawerSite(found));
  }, [location.search, drafts, shortlist, staging, archive]);

  const showToast = useCallback((msg, tone = 'success') => setToast({ msg, tone }), []);

  const onOpenSite = useCallback((row) => {
    // Push ?site=<id> to URL so deep links work; SiteDrawer renders as overlay
    const params = new URLSearchParams(location.search);
    params.set('site', row.id || row.code);
    navigate({ search: params.toString() }, { replace: false });
  }, [navigate, location.search]);

  const onCloseSite = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete('site');
    navigate({ search: params.toString() }, { replace: true });
    setOpenSite(null);
  }, [navigate, location.search]);

  // Scope-filtered counts using RBAC filterByScope
  const visibleDrafts    = filterByScope(drafts,    role, user);
  const visibleShortlist = filterByScope(shortlist, role, user);
  const visibleStaging   = role === 'exec'
    ? filterByScope(staging, role, user)
    : staging.filter(s => s.loiUploaded === true);

  const counts = {
    pipeline:  visibleDrafts.length,
    shortlist: visibleShortlist.length,
    staging:   visibleStaging.length,
    archive:   archive.length,
  };

  const ME = user.name;

  return (
    <div data-screen-label="01 Sites in motion" data-theme={dark ? 'dark' : 'light'} style={{
      width: '100%', height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--zm-bg)', color: 'var(--zm-fg)', overflow: 'hidden',
    }}>
      <TopBar
        user={user}
        role={role}
        dark={dark}
        onToggleDark={toggleDark}
        onNewPipeline={() => setShowNew(true)}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <Sidebar counts={counts} role={role} onRole={setRole}/>

        <main style={{
          flex: 1, overflowY: 'auto', padding: '24px 32px 64px',
          background: 'var(--zm-bg)',
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M40 0 L0 0 0 40' fill='none' stroke='" + (dark ? '%23E2E8F0' : '%23111827') + "' stroke-width='0.5' opacity='0.04'/></svg>\")",
          backgroundSize: '40px 40px',
        }}>
          {/* Pages inject showToast and onOpenSite via context (see below) or props.
              AppRouter clones page elements with these props via a wrapper. */}
          <PageContext.Provider value={{ showToast, onOpenSite }}>
            <Outlet/>
          </PageContext.Provider>
        </main>

        {openSite && <SiteDrawer site={openSite} onClose={onCloseSite}/>}
      </div>

      {showNew && (
        <NewPipelineModal
          onClose={() => setShowNew(false)}
          onSubmit={(form) => {
            setShowNew(false);
            createDraft(form, ME);
            showToast(`Pipeline submitted · ${form.name}. Supervisor notified.`);
          }}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--zm-fg)', color: '#fff',
          padding: '10px 16px', borderRadius: 10,
          boxShadow: 'var(--zm-shadow-pop)',
          fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 10, zIndex: 200,
          animation: 'zm-rise 240ms var(--zm-ease-emp)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: toast.tone === 'danger' ? '#F87171' : '#34D399' }}/>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// PageContext: provides showToast and onOpenSite to page components without prop drilling.
export const PageContext = React.createContext({ showToast: () => {}, onOpenSite: () => {} });
export function usePageContext() { return React.useContext(PageContext); }

// NewPipelineModal — extended to capture pipeline-stage Model · SPOC · Google pin · Expected rent.
// Same fields stay editable at shortlist (AddDetailsPage prefills from these values);
// edits at shortlist are diff-logged into the site Activity tab.
const PIPELINE_MODELS = ['Café · 600–900 sqft', 'Café · 900–1200 sqft', 'Café · 1200+ sqft', 'Kiosk · Express', 'Roastery + café'];
function NewPipelineModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({ name: '', visitDate: '', city: '', model: '', spocName: '', googlePin: '', rentType: '', expectedRent: '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ready = form.name && form.visitDate && form.city && form.model && form.spocName && form.googlePin && form.rentType && form.expectedRent;
  const inputBase = { height: 38, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg)', outline: 'none' };
  const labelBase = { fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'zm-fade 200ms var(--zm-ease)' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 560, maxHeight: '92vh', padding: 28, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18, animation: 'zm-rise 240ms var(--zm-ease-emp)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Pipeline · step 1 of 1</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>New pipeline draft</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Capture site basics and rent context. All fields stay editable at shortlist — changes are logged into the site Activity feed.</p>
          </div>
          <button onClick={onClose} className="zm-icon-btn" style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer', flex: '0 0 30px' }}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>Site / pipeline name</label><input value={form.name} onChange={set('name')} placeholder="e.g. Powai · Lake Homes" style={inputBase}/></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>Visit date</label><input type="date" value={form.visitDate} onChange={set('visitDate')} style={{ ...inputBase, fontFamily: 'var(--zm-font-mono)', fontSize: 13 }}/></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>City</label><select value={form.city} onChange={set('city')} style={inputBase}><option value="">Select city…</option><option>Mumbai</option><option>Bengaluru</option><option>New Delhi</option><option>Hyderabad</option><option>Pune</option><option>Chennai</option><option>Ahmedabad</option></select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>Model</label><select value={form.model} onChange={set('model')} style={inputBase}><option value="">Select model…</option>{PIPELINE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>SPOC name</label><input value={form.spocName} onChange={set('spocName')} placeholder="Landlord / agent" style={inputBase}/></div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>Google pin</label><input value={form.googlePin} onChange={set('googlePin')} placeholder="19.1183, 72.9089" style={{ ...inputBase, fontFamily: 'var(--zm-font-mono)', fontSize: 13 }}/></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>Rent type</label><select value={form.rentType} onChange={set('rentType')} style={inputBase}><option value="">Select…</option><option value="fixed">Fixed + escalation</option><option value="revshare">Revenue share</option></select></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={labelBase}>Expected rent</label>
              <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderRight: '1px solid var(--zm-line)' }}>₹</span>
                <input type="number" min="0" value={form.expectedRent} onChange={set('expectedRent')} placeholder="120000" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)' }}/>
                <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>/mo</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: 12, background: 'var(--zm-accent-soft)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}><span style={{ color: 'var(--zm-accent)', display: 'inline-flex', marginTop: 1 }}><Icon name="alert" size={14}/></span>Once submitted, your supervisor reviews the shortlist (Yes / No). All seven fields stay editable until then; edits at shortlist are logged into the site Activity feed.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="zm-btn" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button disabled={!ready} onClick={() => onSubmit(form)} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: ready ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)', color: ready ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: ready ? 'pointer' : 'not-allowed', boxShadow: ready ? 'var(--zm-shadow-1)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Submit for shortlist <Icon name="arrow" size={14}/></button>
        </div>
      </div>
    </div>
  );
}
