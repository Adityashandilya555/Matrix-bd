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

function SidebarItem({ icon, label, count, active, onClick, collapsed = false }) {
  return (
    <div
      onClick={onClick}
      className="zm-sb-item"
      title={collapsed ? label : undefined}
      aria-label={label}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      style={{
      display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: collapsed ? 0 : 10,
      minHeight: collapsed ? 40 : 'auto',
      padding: collapsed ? '8px 0' : '7px 10px', borderRadius: collapsed ? 14 : 7, cursor: 'pointer',
      background: active ? 'var(--zm-accent-soft)' : 'transparent',
      color: active ? 'var(--zm-fg)' : 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: active ? 600 : 500,
      position: 'relative',
      transition: 'background 160ms var(--zm-ease), color 160ms var(--zm-ease), border-radius 160ms var(--zm-ease)',
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <span style={{ position: 'absolute', left: collapsed ? 5 : 0, top: 8, bottom: 8, width: 2, background: 'var(--zm-accent)', borderRadius: 2 }}/>}
      <span style={{ color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)', display: 'inline-flex' }}>
        <Icon name={icon} size={collapsed ? 19 : 16} stroke={collapsed ? 1.8 : 1.5}/>
      </span>
      {!collapsed && label}
      {count != null && !collapsed && (
        <span style={{
          marginLeft: 'auto', fontFamily: 'var(--zm-font-mono)', fontSize: 11,
          color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)', fontWeight: 500,
        }}>{count}</span>
      )}
      {count != null && collapsed && (
        <span style={{
          position: 'absolute', top: 4, right: 5,
          minWidth: 15, height: 15, padding: '0 3px', borderRadius: 999,
          background: active ? 'var(--zm-accent)' : 'var(--zm-surface-2)',
          border: '1px solid var(--zm-line)',
          color: active ? '#fff' : 'var(--zm-fg-3)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--zm-font-mono)', fontSize: 9, fontWeight: 700,
          lineHeight: 1,
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

export default function Sidebar({ counts, role, onRole, collapsed = false }) {
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
    path.startsWith('/staging-flow') || path.startsWith('/site-tracker') || path === ROUTES.DASHBOARD_MINIMAL_PREVIEW ? 'site-tracker' :
    path.startsWith('/staging')                          ? 'staging'   :
    path === ROUTES.ARCHIVE                              ? 'archive'   :
    path === ROUTES.DD_FAILED                            ? 'dd-failed' :
    path === ROUTES.TEAM                                 ? 'team'      :
    path === ROUTES.LEGAL_CHANGE_REQUESTS                ? 'legal-change-requests' :
    path === ROUTES.LEGAL_REJECTED                       ? 'legal-rejected' :
    path.startsWith('/legal')                            ? 'legal-ddr' :
    path.startsWith('/payment')                          ? 'payment-licensing' :
    'overview';

  const go = (route) => navigate(route);
  const canSeeTeam = role === 'supervisor' || role === 'executive' || role === 'exec';
  const executiveLabel = isModuleSurface ? 'Executive' : 'BD exec';

  return (
    <aside className="zm-sidebar" style={{
      width: collapsed ? 72 : 232, flex: `0 0 ${collapsed ? 72 : 232}px`, padding: collapsed ? '14px 10px' : '14px 12px',
      background: 'var(--zm-surface)', borderRight: '1px solid var(--zm-line)',
      display: 'flex', flexDirection: 'column', gap: 2,
      overflowY: 'auto',
      transition: 'width 220ms var(--zm-ease), flex-basis 220ms var(--zm-ease), padding 220ms var(--zm-ease)',
    }}>
      {!isModuleSurface && (
        <>
          {!collapsed && <div style={{ ...SECTION_HEADING_STYLE, padding: '4px 10px 6px' }}>Overview</div>}
          <SidebarItem icon="dashboard" label="Sites" active={activeView === 'overview'} onClick={() => go(ROUTES.OVERVIEW)} collapsed={collapsed}/>
          {!collapsed && <div style={SECTION_HEADING_STYLE}>Workflow</div>}
          <SidebarItem icon="document" label="Pipeline" count={counts.pipeline} active={activeView === 'pipeline'} onClick={() => go(ROUTES.PIPELINE)} collapsed={collapsed}/>
          <SidebarItem icon="bookmark" label="Shortlisted sites" count={counts.shortlist} active={activeView === 'shortlist'} onClick={() => go(ROUTES.SHORTLIST)} collapsed={collapsed}/>
          <SidebarItem icon="layers" label="Sites in process" count={counts.staging} active={activeView === 'staging'} onClick={() => go(ROUTES.STAGING)} collapsed={collapsed}/>
          {role === 'supervisor' && (
            <SidebarItem icon="archiveBox" label="Archive" count={counts.archive} active={activeView === 'archive'} onClick={() => go(ROUTES.ARCHIVE)} collapsed={collapsed}/>
          )}
          <SidebarItem icon="warning" label="DD failed" active={activeView === 'dd-failed'} onClick={() => go(ROUTES.DD_FAILED)} collapsed={collapsed}/>
          <SidebarItem icon="route" label="Sites in process flow" active={activeView === 'site-tracker'} onClick={() => go(ROUTES.SITE_TRACKER)} collapsed={collapsed}/>
        </>
      )}

      {userModule === 'legal' && (
        <>
          {!collapsed && <div style={{ ...SECTION_HEADING_STYLE, padding: '4px 10px 6px' }}>Legal</div>}
          <SidebarItem
            icon="legalShield"
            label="Legal queue"
            active={activeView === 'legal-ddr'}
            onClick={() => go(ROUTES.LEGAL)}
            collapsed={collapsed}
          />
          <SidebarItem
            icon="warning"
            label="Change requests"
            active={activeView === 'legal-change-requests'}
            onClick={() => go(ROUTES.LEGAL_CHANGE_REQUESTS)}
            collapsed={collapsed}
          />
          <SidebarItem
            icon="archiveBox"
            label="Rejected sites"
            active={activeView === 'legal-rejected'}
            onClick={() => go(ROUTES.LEGAL_REJECTED)}
            collapsed={collapsed}
          />
        </>
      )}

      {userModule === 'payment' && (
        <>
          {!collapsed && <div style={{ ...SECTION_HEADING_STYLE, padding: '4px 10px 6px' }}>Payment</div>}
          <SidebarItem
            icon="paymentCard"
            label="Payment"
            active={activeView === 'payment-licensing'}
            onClick={() => go(ROUTES.PAYMENT)}
            collapsed={collapsed}
          />
        </>
      )}

      {canSeeTeam && (
        <>
          {!collapsed && <div style={SECTION_HEADING_STYLE}>Workspace</div>}
          <SidebarItem
            icon="users"
            label="Team"
            count={counts.pendingUsers}
            active={activeView === 'team'}
            onClick={() => go(ROUTES.TEAM)}
            collapsed={collapsed}
          />
        </>
      )}

      <div style={{ flex: 1 }}/>

      {/* Role switcher — mock only; uses <select> to stay within 232px column */}
      {onRole && !collapsed && (
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

      {collapsed ? (
        <div
          title="Ask Matrix"
          aria-label="Ask Matrix"
          style={{
            height: 42,
            margin: '0 2px',
            border: '1px solid var(--zm-line)',
            borderRadius: 14,
            background: 'var(--zm-surface-2)',
            color: 'var(--zm-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="chat" size={18}/>
        </div>
      ) : (
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
          "Sites in process overdue &gt; 14 days" — answer in the desktop workspace.
        </p>
        </div>
      )}
    </aside>
  );
}
