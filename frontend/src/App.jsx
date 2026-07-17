import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useSession } from './state/SessionContext.jsx';
import { useSites } from './state/SitesContext.jsx';
import { listPendingUsers } from './services/api/adapters/httpAdapter.js';
import TopBar from './modules/shared/chrome/TopBar.jsx';
import Sidebar from './modules/shared/chrome/Sidebar.jsx';
import SiteDrawer from './modules/shared/site-drawer/SiteDrawer.jsx';
import { buildDrawerSite } from './lib/buildDrawerSite.js';
import { safeHref } from './lib/safeHref.js';
import Icon from './modules/shared/primitives/Icon.jsx';
import { filterByScope } from './rbac/scope.js';
import { extractGoogleMapsCoords, looksLikeMapsUrl } from './lib/googleMaps.js';
import { GRID_LAYERS, GRID_ATTACH, stageVignette, canvasBase } from './lib/surfaces.js';
import { INDIAN_CITIES_DATA } from './constants/indianCities.js';
import CitySelect from './modules/shared/primitives/CitySelect.jsx';

// App.jsx is now the chrome shell only.
// Routing is handled by AppRouter / <Outlet/>.
// All view-specific logic lives in the page components.

export default function App() {
  const { user, role, setRole, dark, toggleDark, authReady, isBusinessAdmin, adminOverride, switchAs } = useSession();
  const { drafts, shortlist, staging, archive, createDraft, error: sitesError, refresh } = useSites();
  const navigate = useNavigate();
  const location = useLocation();

  const [openSite, setOpenSite] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState(null);
  // #182 — surface a SitesContext fetch failure to the user (was set but never
  // displayed). Dismissible; resets when a different error arrives.
  const [dismissedSitesError, setDismissedSitesError] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('zm-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const mainRef = useRef(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    try {
      window.localStorage.setItem('zm-sidebar-collapsed', sidebarCollapsed ? 'true' : 'false');
    } catch {
      // localStorage may be unavailable in restrictive browser contexts.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

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
  // HTTP mode emits role='executive'; mock mode kept the legacy 'exec' alias.
  // Match both so role-based filters don't silently drop the executive view.
  const isExec = role === 'exec' || role === 'executive';
  const visibleStaging   = isExec
    ? filterByScope(staging, role, user)
    : staging;

  // Pending-user count for the "Team" sidebar badge. Only fetched for
  // supervisors — the endpoint is supervisor-gated and would 403 for anyone
  // else, polluting the console. Gated on `authReady` so we don't fire it
  // during the pre-hydration window when `role` still holds the default
  // 'supervisor' value (before /auth/whoami resolves the real role) — that
  // race fired a spurious 403 on every executive's first page load.
  const [pendingUserCount, setPendingUserCount] = useState(0);
  useEffect(() => {
    if (!authReady || role !== 'supervisor') { setPendingUserCount(0); return; }
    let alive = true;
    const refresh = () => listPendingUsers()
      .then(arr => alive && setPendingUserCount(arr.length))
      .catch(() => { /* ignore — empty badge is fine */ });
    refresh();
    // Cheap poll so a supervisor reviewing the queue sees joiners show up.
    const t = window.setInterval(refresh, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [authReady, role]);

  // Memoized so the context value identity is stable across renders (both
  // showToast/onOpenSite are already useCallback) — prevents every consumer
  // from re-rendering on unrelated App state changes (#232).
  const pageContextValue = useMemo(() => ({ showToast, onOpenSite }), [showToast, onOpenSite]);

  const counts = {
    pipeline:     visibleDrafts.length,
    shortlist:    visibleShortlist.length,
    staging:      visibleStaging.length,
    archive:      archive.length,
    pendingUsers: pendingUserCount || undefined, // hide the badge at 0
  };

  const ME = user.name;
  const sidebarWidth = sidebarCollapsed ? 72 : 232;

  return (
    <div data-screen-label="01 Sites" data-theme={dark ? 'dark' : 'light'} data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'} style={{
      '--zm-sidebar-width': `${sidebarWidth}px`,
      width: '100%', height: '100vh', display: 'flex', flexDirection: 'column',
      background: 'var(--zm-bg)', color: 'var(--zm-fg)', overflow: 'hidden',
    }}>
      <TopBar
        user={user}
        role={role}
        dark={dark}
        onToggleDark={toggleDark}
        onNewPipeline={() => setShowNew(true)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <Sidebar counts={counts} role={role} onRole={setRole} collapsed={sidebarCollapsed}/>

        <main ref={mainRef} className="zm-app-main" style={{
          flex: 1, overflowY: 'auto', padding: '24px 32px 64px',
          backgroundColor: canvasBase(dark),
          // Premium grid canvas: stage-light vignette (fixed) layered over a
          // fine + coarse grid (scrolls with content) so the plane sits deeper
          // and every card above it reads as raised. See lib/surfaces.js.
          backgroundImage: stageVignette(dark) + ', ' + GRID_LAYERS,
          backgroundAttachment: 'fixed, fixed, ' + GRID_ATTACH,
        }}>
          {/* Pages inject showToast and onOpenSite via context (see below) or props.
              AppRouter clones page elements with these props via a wrapper. */}
          {sitesError && sitesError !== dismissedSitesError && (
            <div role="alert" style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between',
              background: dark ? '#3a1a1a' : '#fdecec',
              border: '1px solid ' + (dark ? '#7a2d2d' : '#f3b5b5'),
              color: dark ? '#ffb4b4' : '#9e1c1c', fontSize: 13,
            }}>
              <span>Couldn’t load sites: {sitesError}</span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => { setDismissedSitesError(null); refresh?.(); }}
                  style={{ cursor: 'pointer', border: '1px solid currentColor', background: 'transparent',
                    color: 'inherit', borderRadius: 6, padding: '3px 10px', fontSize: 12 }}>
                  Retry
                </button>
                <button type="button" aria-label="Dismiss error" onClick={() => setDismissedSitesError(sitesError)}
                  style={{ cursor: 'pointer', border: 'none', background: 'transparent',
                    color: 'inherit', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>
                  ×
                </button>
              </span>
            </div>
          )}
          <PageContext.Provider value={pageContextValue}>
            {/* Content-area boundary for lazily-loaded pages (#385): a chunk
                load shows this placeholder INSIDE the chrome — TopBar/Sidebar
                stay mounted — instead of blanking the whole screen. */}
            <React.Suspense fallback={
              <div style={{ padding: '4rem', textAlign: 'center', opacity: 0.6 }}>Loading…</div>
            }>
              <Outlet key={role}/>
            </React.Suspense>
          </PageContext.Provider>
        </main>

        {openSite && <SiteDrawer site={openSite} onClose={onCloseSite}/>}
      </div>

      {showNew && (
        <NewPipelineModal
          dark={dark}
          onClose={() => setShowNew(false)}
          onSubmit={async (form) => {
            await createDraft(form, ME);
            setShowNew(false);
            showToast(
              role === 'supervisor'
                ? `Pipeline created · ${form.name}. Delegate it to an executive from Shortlisted sites.`
                : `Pipeline submitted · ${form.name}. Supervisor notified.`,
            );
          }}
        />
      )}

      {isBusinessAdmin && adminOverride && (
        <div style={{
          position: 'fixed', top: 12, left: `calc(${sidebarWidth}px + 24px)`, zIndex: 999,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 14px 7px 14px', borderRadius: 12,
          background: dark ? '#1a1a2e' : '#fff',
          border: '1px solid ' + (dark ? '#333' : '#ddd'),
          fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600,
          color: dark ? '#f5f5f5' : '#1a1a2e',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          transition: 'left 200ms ease',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: '#4CAF50', flexShrink: 0, animation: 'zm-pulse 2s infinite' }}/>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Simulating</span>
          <select
            value={adminOverride.role}
            onChange={(e) => { switchAs(e.target.value, adminOverride.module); }}
            style={{
              height: 28, padding: '0 6px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
              border: '1px solid ' + (dark ? '#444' : '#ccc'),
              background: dark ? '#2a2a3e' : '#f5f5f5',
              color: dark ? '#f5f5f5' : '#1a1a2e',
              fontFamily: 'var(--zm-font-body)', cursor: 'pointer',
            }}
          >
            <option value="supervisor">Supervisor</option>
            <option value="executive">Executive</option>
          </select>
          <select
            value={adminOverride.module}
            onChange={(e) => {
              switchAs(adminOverride.role, e.target.value);
              const routes = { bd: '/', legal: '/legal', design: '/design', project_excellence: '/project-excellence', project: '/project', nso: '/nso' };
              navigate(routes[e.target.value] || '/');
            }}
            style={{
              height: 28, padding: '0 6px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
              border: '1px solid ' + (dark ? '#444' : '#ccc'),
              background: dark ? '#2a2a3e' : '#f5f5f5',
              color: dark ? '#f5f5f5' : '#1a1a2e',
              fontFamily: 'var(--zm-font-body)', cursor: 'pointer',
            }}
          >
            <option value="bd">BD</option>
            <option value="legal">Legal</option>
            <option value="design">Design</option>
            <option value="project_excellence">Project Excellence</option>
            <option value="project">Project</option>
            <option value="nso">NSO</option>
          </select>
          <button
            type="button"
            onClick={() => { switchAs(null, null); navigate('/business-admin'); }}
            style={{
              marginLeft: 2, padding: '4px 12px', borderRadius: 8,
              border: 'none', background: '#C62828',
              color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'var(--zm-font-body)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            ✕ Exit
          </button>
        </div>
      )}

      {toast && (() => {
        const tone = toast.tone === 'error' ? 'danger' : (toast.tone || 'success');
        const TONES = {
          success: { color: 'var(--zm-success)', soft: 'var(--zm-success-soft)', icon: 'check' },
          danger:  { color: 'var(--zm-danger)',  soft: 'var(--zm-danger-soft)',  icon: 'alert' },
          warning: { color: 'var(--zm-warning)', soft: 'var(--zm-warning-soft)', icon: 'warning' },
          info:    { color: 'var(--zm-accent)',  soft: 'var(--zm-accent-soft)',  icon: 'message' },
        };
        const c = TONES[tone] || TONES.success;
        return (
          <div className="zm-toast" role="status" aria-live="polite" style={{
            position: 'fixed', bottom: 26, left: '50%', zIndex: 300, maxWidth: 'min(92vw, 460px)',
          }}>
            <div style={{
              position: 'relative', overflow: 'hidden',
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 12px 13px 13px', borderRadius: 14,
              background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
              boxShadow: 'var(--zm-shadow-pop)',
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            }}>
              <span style={{
                flex: '0 0 auto', width: 30, height: 30, borderRadius: 9,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: c.soft, color: c.color,
              }}><Icon name={c.icon} size={16}/></span>
              <span style={{
                fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 550,
                lineHeight: 1.4, color: 'var(--zm-fg)', paddingRight: 2,
              }}>{toast.msg}</span>
              <button className="zm-toast-close" type="button" aria-label="Dismiss" onClick={() => setToast(null)} style={{
                flex: '0 0 auto', width: 24, height: 24, marginLeft: 2, padding: 0, cursor: 'pointer',
                border: 'none', borderRadius: 7, background: 'transparent', color: 'var(--zm-fg-3)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}><Icon name="x" size={13}/></button>
              <span className="zm-toast-bar" aria-hidden="true" style={{
                position: 'absolute', left: 0, bottom: 0, height: 3, width: '100%',
                transformOrigin: 'left', background: c.color, opacity: 0.9, borderRadius: '0 2px 2px 0',
                animation: 'zm-toast-progress 3400ms linear forwards',
              }}/>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// PageContext: provides showToast and onOpenSite to page components without prop drilling.
export const PageContext = React.createContext({ showToast: () => {}, onOpenSite: () => {} });
export function usePageContext() { return React.useContext(PageContext); }

// NewPipelineModal — captures pipeline-stage Model · Google pin · Expected rent.
// Same fields stay editable at shortlist (AddDetailsPage prefills from these values);
// edits at shortlist are diff-logged into the site Activity tab.
const PIPELINE_MODELS = ['BTC Cafe', 'BTC Cafe+', 'Blue Tokai Origins', 'Roastries', 'Micro-Cafes & Express Outlets', 'GotTea', 'Others'];
const PIPELINE_RENT_TYPES = [
  { id: 'revshare', label: 'Revenue share', sub: '% of monthly sales' },
  { id: 'fixed', label: 'Fixed + escalation', sub: 'monthly fixed + % per year' },
  { id: 'mg_revshare', label: 'MG + Revenue share', sub: 'minimum guarantee + escalation + % of sales' },
  { id: 'staggered', label: 'Staggered Rent with Escalation', sub: 'base rent + yearly stepped schedule' },
];
function NewPipelineModal({ onClose, onSubmit, dark }) {
  const idSite = useId();
  const idVisitDate = useId();
  const idCity = useId();
  const idModel = useId();
  const idGooglePin = useId();
  const idExpectedRent = useId();
  const idEscalation = useId();
  const idRevshare = useId();
  const idMgRent = useId();
  const idMgRevshare = useId();
  const idMgEscalation = useId();
  const idAreaSqft = useId();
  const [form, setForm] = useState({ name: '', visitDate: '', city: '', model: '', googlePin: '', googleMapsUrl: '', rentType: '', expectedRent: '', expectedEscalation: '', expectedEscalationYears: '', expectedRevshare: '', areaSqft: '', staggeredEscalation: [{ year: 1, percent: '' }] });
  const [pinStatus, setPinStatus] = useState(null); // { tone: 'info'|'ok'|'err', msg: string }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  // Rent-type-specific essentials. Mirrors AddDetailsPage so the data captured
  // upfront matches what the shortlist form expects to prefill from.
  const rentReady =
    form.rentType === 'revshare' ? !!form.expectedRevshare
    : form.rentType === 'fixed' ? !!form.expectedRent && !!form.expectedEscalation && !!form.expectedEscalationYears
    : form.rentType === 'mg_revshare' ? !!form.expectedRent && !!form.expectedRevshare && !!form.expectedEscalation && !!form.expectedEscalationYears
    : form.rentType === 'staggered' ? !!form.expectedRent && form.staggeredEscalation.every(e => e.percent !== '' && e.percent != null) && form.staggeredEscalation.length > 0
    : false;
  const ready = form.name && form.visitDate && form.city && form.model && form.googlePin && form.rentType && rentReady;

  // Resolve a pasted/typed Maps URL into coords, but keep the original URL too.
  // Both end up persisted: googlePin = "lat, lng", googleMapsUrl = the link.
  const resolveFromUrl = async (url) => {
    if (!url) { setPinStatus(null); return; }
    if (!looksLikeMapsUrl(url)) { setPinStatus(null); return; }
    setPinStatus({ tone: 'info', msg: 'Resolving Google Maps link…' });
    const { coords, error } = await extractGoogleMapsCoords(url);
    if (coords) {
      setForm(prev => ({ ...prev, googlePin: coords, googleMapsUrl: url }));
      setPinStatus({ tone: 'ok', msg: `Pin set · ${coords}` });
    } else {
      setForm(prev => ({ ...prev, googleMapsUrl: url }));
      setPinStatus({ tone: 'err', msg: error || 'Could not extract coordinates from that link.' });
    }
  };
  const onPinPaste = (e) => {
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if (looksLikeMapsUrl(pasted)) {
      e.preventDefault();
      resolveFromUrl(pasted);
    }
  };
  const onPinChange = (e) => {
    const value = e.target.value;
    if (looksLikeMapsUrl(value)) {
      // User typed/pasted a URL into the pin field; treat it as a link, not coords.
      setForm(prev => ({ ...prev, googleMapsUrl: value }));
    } else {
      setForm(prev => ({ ...prev, googlePin: value }));
    }
  };
  const onPinBlur = () => {
    if (form.googleMapsUrl && !form.googlePin) resolveFromUrl(form.googleMapsUrl);
  };
  const clearMapsLink = () => {
    setForm(prev => ({ ...prev, googleMapsUrl: '' }));
    setPinStatus(null);
  };
  const handleSubmit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setSubmitError(err?.detail || err?.message || 'Could not create pipeline.');
      setSubmitting(false);
    }
  };
  const inputBase = { height: 38, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg)', outline: 'none', colorScheme: dark ? 'dark' : 'light' };
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label htmlFor={idSite} style={labelBase}>Site</label><input id={idSite} value={form.name} onChange={set('name')} placeholder="e.g. Powai · Lake Homes" style={inputBase}/></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label htmlFor={idVisitDate} style={labelBase}>Visit date</label><input id={idVisitDate} type="date" value={form.visitDate} onChange={set('visitDate')} style={{ ...inputBase, fontFamily: 'var(--zm-font-mono)', fontSize: 13 }}/></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label htmlFor={idCity} style={labelBase}>City</label><CitySelect id={idCity} value={form.city} onChange={(c) => setForm(prev => ({ ...prev, city: c }))} options={INDIAN_CITIES_DATA}/></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label htmlFor={idModel} style={labelBase}>Model</label><select id={idModel} value={form.model} onChange={set('model')} style={inputBase}><option value="">Select model…</option>{PIPELINE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor={idAreaSqft} style={labelBase}>Area (sqft)</label>
              <input id={idAreaSqft} type="number" min="0" step="any" value={form.areaSqft} onChange={set('areaSqft')} placeholder="e.g. 1500" style={{ ...inputBase, fontFamily: 'var(--zm-font-mono)', fontSize: 13 }}/>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor={idGooglePin} style={labelBase}>Google pin</label>
              <input id={idGooglePin} value={form.googlePin || form.googleMapsUrl} onChange={onPinChange} onPaste={onPinPaste} onBlur={onPinBlur} placeholder="Paste Google Maps link or 19.1183, 72.9089" style={{ ...inputBase, fontFamily: 'var(--zm-font-mono)', fontSize: 13 }}/>
              {pinStatus && (
                <span style={{
                  fontFamily: 'var(--zm-font-body)', fontSize: 11.5,
                  color: pinStatus.tone === 'ok' ? 'var(--zm-success)'
                       : pinStatus.tone === 'err' ? 'var(--zm-danger)'
                       : 'var(--zm-fg-3)',
                }}>{pinStatus.msg}</span>
              )}
              {form.googleMapsUrl && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>
                  <span>Link saved:</span>
                  {safeHref(form.googleMapsUrl) ? (
                    <a href={safeHref(form.googleMapsUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--zm-accent)', textDecoration: 'underline', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.googleMapsUrl}</a>
                  ) : (
                    <span style={{ color: 'var(--zm-fg-3)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.googleMapsUrl}</span>
                  )}
                  <button type="button" onClick={clearMapsLink} title="Clear link" style={{ background: 'transparent', border: 'none', color: 'var(--zm-fg-3)', cursor: 'pointer', padding: 0, fontSize: 12 }}>×</button>
                </span>
              )}
            </div>
          </div>
          <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <legend style={{ ...labelBase, padding: 0, marginBottom: 6 }}>Rent type</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {PIPELINE_RENT_TYPES.map(rt => (
                <button
                  type="button"
                  key={rt.id}
                  onClick={() => setForm(prev => ({ ...prev, rentType: rt.id }))}
                  className="zm-btn"
                  aria-pressed={form.rentType === rt.id}
                  style={{
                    textAlign: 'left', padding: 12, borderRadius: 8,
                    border: '1px solid ' + (form.rentType === rt.id ? 'var(--zm-accent)' : 'var(--zm-line)'),
                    background: form.rentType === rt.id ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
                    cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10, fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 999, marginTop: 1,
                    border: '1.5px solid ' + (form.rentType === rt.id ? 'var(--zm-accent)' : 'var(--zm-line-strong)'),
                    background: form.rentType === rt.id ? 'var(--zm-accent)' : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 16px',
                  }}>{form.rentType === rt.id && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }}/>}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--zm-fg)' }}>{rt.label}</span>
                    <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{rt.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          {form.rentType === 'fixed' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor={idExpectedRent} style={labelBase}>Expected rent</label>
                  <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                    <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderRight: '1px solid var(--zm-line)' }}>₹</span>
                    <input id={idExpectedRent} type="number" min="0" step="any" value={form.expectedRent} onChange={set('expectedRent')} placeholder="120000" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)' }}/>
                    <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>/mo</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor={idEscalation} style={labelBase}>Escalation</label>
                  <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                    <input id={idEscalation} type="number" min="0" step="any" value={form.expectedEscalation} onChange={set('expectedEscalation')} placeholder="e.g. 4.5" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)' }}/>
                    <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>%</span>
                  </div>
                </div>
              </div>
              <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <legend style={{ ...labelBase, padding: 0, marginBottom: 6 }}>Escalation cadence</legend>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { years: 1, label: 'Yearly' },
                    { years: 3, label: 'Every 3 yrs' },
                    { years: 5, label: 'Every 5 yrs' },
                  ].map(opt => {
                    const selected = String(form.expectedEscalationYears) === String(opt.years);
                    return (
                      <button
                        type="button"
                        key={opt.years}
                        onClick={() => setForm(prev => ({ ...prev, expectedEscalationYears: String(opt.years) }))}
                        style={{
                          flex: 1, height: 38, borderRadius: 6,
                          border: '1px solid ' + (selected ? 'var(--zm-accent)' : 'var(--zm-line)'),
                          background: selected ? 'var(--zm-accent-soft)' : 'var(--zm-bg)',
                          color: selected ? 'var(--zm-accent)' : 'var(--zm-fg)',
                          fontFamily: 'var(--zm-font-body)',
                          fontWeight: 600, fontSize: 13, cursor: 'pointer',
                        }}
                      >{opt.label}</button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}
          {form.rentType === 'revshare' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor={idRevshare} style={labelBase}>Revenue share</label>
              <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                <input id={idRevshare} type="number" min="0" step="any" value={form.expectedRevshare} onChange={set('expectedRevshare')} placeholder="e.g. 12.5" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)' }}/>
                <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>% of sales</span>
              </div>
            </div>
          )}
          {form.rentType === 'mg_revshare' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor={idMgRent} style={labelBase}>Minimum guarantee</label>
                  <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                    <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderRight: '1px solid var(--zm-line)' }}>₹</span>
                    <input id={idMgRent} type="number" min="0" step="any" value={form.expectedRent} onChange={set('expectedRent')} placeholder="80000" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)', minWidth: 0 }}/>
                    <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>/mo</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor={idMgRevshare} style={labelBase}>Revenue share</label>
                  <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                    <input id={idMgRevshare} type="number" min="0" step="any" value={form.expectedRevshare} onChange={set('expectedRevshare')} placeholder="e.g. 12.5" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)', minWidth: 0 }}/>
                    <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)', whiteSpace: 'nowrap' }}>% above MG</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor={idMgEscalation} style={labelBase}>Escalation</label>
                  <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                    <input id={idMgEscalation} type="number" min="0" step="any" value={form.expectedEscalation} onChange={set('expectedEscalation')} placeholder="e.g. 4.5" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)', minWidth: 0 }}/>
                    <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>%</span>
                  </div>
                </div>
                <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <legend style={{ ...labelBase, padding: 0, marginBottom: 6 }}>Escalation cadence</legend>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { years: 1, label: 'Yearly' },
                      { years: 3, label: 'Every 3 yrs' },
                      { years: 5, label: 'Every 5 yrs' },
                    ].map(opt => {
                      const selected = String(form.expectedEscalationYears) === String(opt.years);
                      return (
                        <button
                          type="button"
                          key={opt.years}
                          onClick={() => setForm(prev => ({ ...prev, expectedEscalationYears: String(opt.years) }))}
                          style={{
                            flex: 1, height: 38, borderRadius: 6,
                            border: '1px solid ' + (selected ? 'var(--zm-accent)' : 'var(--zm-line)'),
                            background: selected ? 'var(--zm-accent-soft)' : 'var(--zm-bg)',
                            color: selected ? 'var(--zm-accent)' : 'var(--zm-fg)',
                            fontFamily: 'var(--zm-font-body)',
                            fontWeight: 600, fontSize: 13, cursor: 'pointer',
                          }}
                        >{opt.label}</button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            </div>
          )}
          {form.rentType === 'staggered' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor={idExpectedRent} style={labelBase}>Base rent</label>
                <div style={{ display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                  <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderRight: '1px solid var(--zm-line)' }}>₹</span>
                  <input id={idExpectedRent} type="number" min="0" step="any" value={form.expectedRent} onChange={set('expectedRent')} placeholder="Base monthly rent" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)' }}/>
                  <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>/mo</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={labelBase}>Escalation schedule</span>
                  {form.staggeredEscalation.length < 5 && (
                    <button type="button" onClick={() => setForm(prev => ({ ...prev, staggeredEscalation: [...prev.staggeredEscalation, { year: prev.staggeredEscalation.length + 1, percent: '' }] }))} style={{ background: 'transparent', border: 'none', color: 'var(--zm-accent)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="plus" size={14}/> Add year</button>
                  )}
                </div>
                {form.staggeredEscalation.map((esc, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: '0 0 100px', display: 'flex', alignItems: 'center', height: 38, padding: '0 10px', background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>Year {idx + 1}</div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', height: 38, border: '1px solid var(--zm-line)', borderRadius: 6, background: 'var(--zm-bg)', overflow: 'hidden' }}>
                      <input type="number" min="0" step="any" value={esc.percent} onChange={(e) => {
                        const next = [...form.staggeredEscalation];
                        next[idx].percent = e.target.value;
                        setForm(prev => ({ ...prev, staggeredEscalation: next }));
                      }} placeholder="Escalation %" style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: 'var(--zm-fg)' }}/>
                      <span style={{ padding: '0 10px', display: 'flex', alignItems: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 12, background: 'var(--zm-surface-2)', borderLeft: '1px solid var(--zm-line)' }}>%</span>
                    </div>
                    {idx > 0 && idx === form.staggeredEscalation.length - 1 && (
                      <button type="button" onClick={() => setForm(prev => ({ ...prev, staggeredEscalation: prev.staggeredEscalation.slice(0, -1) }))} title="Remove" style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', color: 'var(--zm-danger)', cursor: 'pointer', flexShrink: 0 }}><Icon name="x" size={16}/></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {!form.rentType && (
            <div style={{ padding: 14, background: 'var(--zm-surface-2)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)', textAlign: 'center' }}>Pick a rent type above to reveal the rent fields.</div>
          )}
        </div>
        <div style={{ padding: 12, background: 'var(--zm-accent-soft)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}><span style={{ color: 'var(--zm-accent)', display: 'inline-flex', marginTop: 1 }}><Icon name="alert" size={14}/></span>Once submitted, your supervisor reviews the shortlist (Yes / No). All seven fields stay editable until then; edits at shortlist are logged into the site Activity feed.</div>
        {submitError && (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(185,28,28,0.08)', border: '1px solid var(--zm-danger)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12 }}>
            {submitError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={submitting} className="zm-btn" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: submitting ? 'var(--zm-fg-4)' : 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1 }}>Cancel</button>
          <button disabled={!ready || submitting} onClick={handleSubmit} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: ready && !submitting ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)', color: ready && !submitting ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: ready && !submitting ? 'pointer' : 'not-allowed', boxShadow: ready && !submitting ? 'var(--zm-shadow-1)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{submitting ? 'Submitting...' : 'Submit for shortlist'} <Icon name="arrow" size={14}/></button>
        </div>
      </div>
    </div>
  );
}
