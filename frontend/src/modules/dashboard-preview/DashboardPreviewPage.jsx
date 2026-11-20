// skipcq: JS-0833
import React from 'react';
import RoleDashboard from '../shared/dashboard/RoleDashboard.jsx';
import { Ico } from '../shared/dashboard/kit.jsx';
import { ADMIN, BD_EXECUTIVE, EMPTY_EXECUTIVE, bdSupervisor, legalSupervisor } from '../shared/dashboard/sampleSummaries.js';

// Dev-only preview of the role dashboards with sample payloads: no backend and
// no sign-in. Pick a view in the top bar; the sidebar shows that role's menu.

const VIEWS = [
  { key: 'admin', label: 'Business admin', who: 'Business admin', nav: ['Overview', 'Approval Center', 'Launch Approvals', 'Financial Closure', 'Departments', 'Sites', 'Workspace Access'] },
  { key: 'bd-sup', label: 'BD supervisor', who: 'ritwick.r · Supervisor', nav: ['Overview', 'Pipeline', 'Shortlisted sites', 'Sites in process', 'Archived / Rejected', 'DDR negative', 'Payment', 'Launch', 'Team'] },
  { key: 'legal-sup', label: 'Legal supervisor', who: 'asha · Legal supervisor', nav: ['Overview', 'Legal queue', 'Change requests', 'Process flow', 'History', 'Team'] },
  { key: 'bd-exec', label: 'BD executive', who: 'santoshtiwari · Executive', nav: ['My work', 'Pipeline', 'Shortlisted sites', 'Sites in process', 'Payment', 'Module access'] },
  { key: 'new-exec', label: 'New executive', who: 'ritwick.r · Executive', nav: ['My work', 'Pipeline', 'Shortlisted sites', 'Sites in process', 'Module access'] },
];

const NAV_ICON = {
  Overview: 'grid', 'My work': 'grid', 'Approval Center': 'check', 'Launch Approvals': 'flag', Launch: 'flag', 'Financial Closure': 'rupee',
  Payment: 'rupee', Departments: 'users', Team: 'users', Sites: 'pin', 'Workspace Access': 'layers', 'Module access': 'layers',
  Pipeline: 'doc', 'Shortlisted sites': 'flag', 'Sites in process': 'layers', 'Archived / Rejected': 'doc', 'DDR negative': 'shield',
  'Legal queue': 'shield', 'Change requests': 'doc', 'Process flow': 'pulse', History: 'clock',
};

export default function DashboardPreviewPage() {
  const [view, setView] = React.useState('admin');
  const [dark, setDark] = React.useState(false);
  const [scope, setScope] = React.useState('module');
  const [updatedAt, setUpdatedAt] = React.useState(Date.now());

  // Mimics the planned 15s version check: the badge resets as if new data arrived.
  React.useEffect(() => {
    const id = window.setInterval(() => setUpdatedAt(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const v = VIEWS.find((x) => x.key === view);
  const data = view === 'admin' ? ADMIN
    : view === 'bd-sup' ? bdSupervisor(scope)
      : view === 'legal-sup' ? legalSupervisor(scope)
        : view === 'bd-exec' ? BD_EXECUTIVE : EMPTY_EXECUTIVE;

  return (
    <div data-theme={dark ? 'dark' : 'light'} style={{ height: '100vh', overflow: 'hidden', display: 'flex', background: 'var(--zm-bg)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)' }}>
      <nav aria-label="Main" style={{ flex: '1 1 240px', maxWidth: 280, background: 'var(--zm-sidebar-bg)', padding: '22px 14px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 4, height: '100vh', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 8px 22px' }}>
          <img src="/brand-logo.jpeg" alt="RetailExpansion" width="42" height="42" style={{ borderRadius: 12, objectFit: 'cover' }} />
          <div className="dash-col">
            <span style={{ fontFamily: 'var(--zm-font-display)', fontWeight: 700, color: 'var(--zm-sidebar-fg)', fontSize: 16 }}>RetailExpansion</span>
            <span className="dash-eyebrow" style={{ color: 'var(--zm-sidebar-fg-faint)', fontSize: 10 }}>{v.label}</span>
          </div>
        </div>
        {v.nav.map((item, i) => (
          <a key={item} href="#top" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 14, textDecoration: 'none', fontWeight: 600, fontSize: 14.5, color: i === 0 ? '#24170F' : 'var(--zm-sidebar-fg-muted)', background: i === 0 ? '#F3E3CF' : 'transparent' }}>
            <Ico name={NAV_ICON[item] || 'doc'} />{item}
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ borderRadius: 16, overflow: 'hidden', position: 'relative', minHeight: 140, display: 'flex', alignItems: 'flex-end' }}>
          <img src="/dashboard/beans-cup.jpg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} />
          <div style={{ position: 'relative', padding: 14, width: '100%', boxSizing: 'border-box', background: 'linear-gradient(to top, rgba(36,23,15,.95), rgba(36,23,15,0))' }}>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 700, color: '#FFF6EC', fontSize: 15 }}>8 cafés open soon</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#E9DCCB' }}>Next opening: 4 Nov</p>
          </div>
        </div>
      </nav>

      <main id="top" style={{ flex: '999 1 560px', minWidth: 0, boxSizing: 'border-box', height: '100vh', overflowY: 'auto' }}>
        <header style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '16px 28px', borderBottom: '1px solid var(--zm-line)', background: 'var(--zm-surface)' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Preview view">
            {VIEWS.map((x) => (
              <button key={x.key} type="button" className="dash-chip" aria-pressed={x.key === view} onClick={() => { setView(x.key); setScope('module'); }}>{x.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="dash-pill" style={{ background: 'var(--zm-copper-soft)', color: 'var(--zm-copper)' }}>Preview · sample data</span>
            <button type="button" className="dash-chip" aria-pressed={dark} onClick={() => setDark((d) => !d)} aria-label="Dark mode">
              <Ico name="moon" size={16} />{dark ? 'Roast (dark)' : 'Café (light)'}
            </button>
            <span className="dash-sub">{v.who}</span>
          </div>
        </header>
        <div style={{ padding: '26px 28px 60px', maxWidth: 1320, margin: '0 auto' }}>
          <RoleDashboard key={view} data={data} updatedAt={updatedAt} scope={scope} onScope={setScope} />
          <p className="dash-sub" style={{ marginTop: 28, fontSize: 11.5 }}>Photos: Unsplash (Di Bella Coffee, rawkkim and others), used under the Unsplash License.</p>
        </div>
      </main>
    </div>
  );
}
