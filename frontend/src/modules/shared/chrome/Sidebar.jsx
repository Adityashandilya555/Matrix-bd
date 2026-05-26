import React from 'react';
import { useNavigate, useLocation, NavLink } from 'react-router-dom';
import Icon from '../primitives/Icon.jsx';
import Avatar from '../primitives/Avatar.jsx';
import { ROUTES } from '../../../router/routes.js';
import { useSession } from '../../../state/SessionContext.jsx';

// Render bodies preserved exactly from Chrome.jsx Sidebar + SidebarItem components.
// Only changes:
//   - SidebarItem.onClick now calls navigate(); active derives from useLocation()
//   - Role switcher uses <select> for the role dropdown.

function SidebarItem({ icon, label, count, active, onClick }) {
  return (
    <div onClick={onClick} className="zm-sb-item" style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
      background: active ? 'var(--zm-accent-soft)' : 'transparent',
      color: active ? 'var(--zm-fg)' : 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: active ? 600 : 500,
      position: 'relative',
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, background: 'var(--zm-accent)', borderRadius: 2 }}/>}
      <span style={{ color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)', display: 'inline-flex' }}>
        <Icon name={icon} size={16}/>
      </span>
      {label}
      {count != null && (
        <span style={{
          marginLeft: 'auto', fontFamily: 'var(--zm-font-mono)', fontSize: 11,
          color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)', fontWeight: 500,
        }}>{count}</span>
      )}
    </div>
  );
}

// Role display labels for the <select>
const ROLE_LABELS = {
  supervisor: 'Supervisor',
  business_admin: 'Business Admin',
  exec: 'BD exec',
};

const SECTION_HEADING_STYLE = {
  fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10,
  letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-4)',
  padding: '14px 10px 6px',
};

export default function Sidebar({ counts, role, onRole }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSession();
  // Prefer the JWT-borne module claim when it exists — that's the authoritative
  // signal of which module a user actually belongs to. Only fall back to the
  // current URL when the session has no module claim (mock-mode previews, where
  // we still want the right menu to render based on where the user clicked).
  const path = location.pathname;
  const routeModule = path.startsWith('/legal') ? 'legal' : path.startsWith('/payment') ? 'payment' : 'bd';
  const userModule = session?.module || routeModule;
  const isModuleSurface = userModule === 'legal' || userModule === 'payment';

  // Active view derived from current URL path
  const activeView =
    path === ROUTES.OVERVIEW                              ? 'overview'  :
    path === ROUTES.PIPELINE                             ? 'pipeline'  :
    path === ROUTES.SHORTLIST || path.startsWith('/shortlist/') ? 'shortlist' :
    path.startsWith('/staging')                          ? 'staging'   :
    path === ROUTES.ARCHIVE                              ? 'archive'   :
    path === ROUTES.DD_FAILED                            ? 'dd-failed' :
    path === ROUTES.TEAM                                 ? 'team'      :
    path === ROUTES.LEGAL_CHANGE_REQUESTS                ? 'legal-change-requests' :
    path.startsWith('/legal')                            ? 'legal-ddr' :
    path.startsWith('/payment')                          ? 'payment-licensing' :
    'overview';

  const go = (route) => navigate(route);
  const canSeeTeam = role === 'supervisor' || role === 'executive' || role === 'exec';
  const executiveLabel = isModuleSurface ? 'Executive' : 'BD exec';

  return (
    <aside className="zm-sidebar" style={{
      width: 232, flex: '0 0 232px', padding: '14px 12px',
      background: 'var(--zm-surface)', borderRight: '1px solid var(--zm-line)',
      display: 'flex', flexDirection: 'column', gap: 2,
      overflowY: 'auto',
    }}>
      {!isModuleSurface && (
        <>
          <div style={{ ...SECTION_HEADING_STYLE, padding: '4px 10px 6px' }}>Overview</div>
          <SidebarItem icon="trend" label="Sites" active={activeView === 'overview'} onClick={() => go(ROUTES.OVERVIEW)}/>
          <div style={SECTION_HEADING_STYLE}>Workflow</div>
          <SidebarItem icon="file"   label="Pipeline"        count={counts.pipeline}  active={activeView === 'pipeline'}  onClick={() => go(ROUTES.PIPELINE)}/>
          <SidebarItem icon="shield" label="Shortlist queue" count={counts.shortlist} active={activeView === 'shortlist'} onClick={() => go(ROUTES.SHORTLIST)}/>
          <SidebarItem icon="box"    label="Staging"         count={counts.staging}   active={activeView === 'staging'}   onClick={() => go(ROUTES.STAGING)}/>
          {role === 'supervisor' && (
            <SidebarItem icon="folder" label="Archive" count={counts.archive} active={activeView === 'archive'} onClick={() => go(ROUTES.ARCHIVE)}/>
          )}
          <SidebarItem icon="alert" label="DD failed" active={activeView === 'dd-failed'} onClick={() => go(ROUTES.DD_FAILED)}/>
        </>
      )}

      {userModule === 'legal' && (
        <>
          <div style={{ ...SECTION_HEADING_STYLE, padding: '4px 10px 6px' }}>Legal</div>
          <SidebarItem
            icon="shield"
            label="Legal queue"
            active={activeView === 'legal-ddr'}
            onClick={() => go(ROUTES.LEGAL)}
          />
          <SidebarItem
            icon="alert"
            label="Change requests"
            active={activeView === 'legal-change-requests'}
            onClick={() => go(ROUTES.LEGAL_CHANGE_REQUESTS)}
          />
        </>
      )}

      {userModule === 'payment' && (
        <>
          <div style={{ ...SECTION_HEADING_STYLE, padding: '4px 10px 6px' }}>Payment</div>
          <SidebarItem
            icon="card"
            label="Payment"
            active={activeView === 'payment-licensing'}
            onClick={() => go(ROUTES.PAYMENT)}
          />
        </>
      )}

      {canSeeTeam && (
        <>
          <div style={SECTION_HEADING_STYLE}>Workspace</div>
          <SidebarItem
            icon="user"
            label="Team"
            count={counts.pendingUsers}
            active={activeView === 'team'}
            onClick={() => go(ROUTES.TEAM)}
          />
        </>
      )}

      <div style={{ flex: 1 }}/>

      {/* Role switcher — mock only; uses <select> to stay within 232px column */}
      {onRole && (
        <div style={{
          padding: 10, margin: '0 4px 8px',
          border: '1px solid var(--zm-line)', borderRadius: 10,
          background: 'var(--zm-surface-2)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>View as</span>
          <select
            value={role}
            onChange={(e) => onRole(e.target.value)}
            style={{
              height: 32, padding: '0 10px',
              border: '1px solid var(--zm-line)', borderRadius: 7,
              background: 'var(--zm-surface)', color: 'var(--zm-fg)',
              fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', outline: 'none', width: '100%',
            }}
          >
            <option value="supervisor">Supervisor</option>
            <option value="exec">{executiveLabel}</option>
          </select>
        </div>
      )}

      <div style={{
        padding: 12, margin: '0 4px',
        border: '1px solid var(--zm-line)', borderRadius: 10,
        background: 'var(--zm-surface-2)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--zm-accent)' }}>
          <Icon name="chat" size={14}/>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ask Matrix</span>
        </div>
        <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-2)', lineHeight: 1.45 }}>
          "Staging sites overdue &gt; 14 days" — answer in the desktop workspace.
        </p>
      </div>
    </aside>
  );
}
