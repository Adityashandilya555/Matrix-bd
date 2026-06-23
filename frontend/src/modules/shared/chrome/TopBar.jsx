import React, { useEffect, useRef, useState } from 'react';
import Icon from '../primitives/Icon.jsx';
import Avatar from '../primitives/Avatar.jsx';
import { useSession } from '../../../state/SessionContext.jsx';
import { PRODUCT_NAME } from '../../../router/routes.js';
import { requestExecutiveAccess } from '../../../services/api/adapters/httpAdapter.js';

// Render body preserved exactly from Chrome.jsx TopBar component.
export default function TopBar({ user, role, dark, onToggleDark, onNewPipeline, sidebarCollapsed = false, onToggleSidebar }) {
  const { signOut, session, effectiveModule, switchAs } = useSession();
  // BD-only action — legal and payment supervisors don't open pipeline drafts.
  // "New pipeline" creates a BD site draft — only the BD surface (or mock/no-module) shows it.
  // effectiveModule reflects any admin role simulation, falling back to the JWT module claim.
  const showNewPipeline = !effectiveModule || effectiveModule === 'bd';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Click-outside to close the account menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    if (signOut) await signOut();
    // SessionContext clears the token, which RequireAuth picks up and routes
    // back to /welcome automatically — no explicit navigate needed.
  };

  return (
    <header style={{
      height: 64, padding: 0,
      display: 'flex', alignItems: 'stretch',
      background: 'var(--zm-surface)', borderBottom: '1px solid var(--zm-line)',
      flex: '0 0 auto',
    }}>
      <div className="zm-brand-plate" style={{
        width: sidebarCollapsed ? 72 : 232, flex: `0 0 ${sidebarCollapsed ? 72 : 232}px`,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
        gap: 10, padding: sidebarCollapsed ? '0 8px 0 12px' : '0 12px',
        color: 'var(--zm-sidebar-fg)',
        borderRight: '1px solid var(--zm-line)',
        position: 'relative',
        transition: 'width 220ms var(--zm-ease), flex-basis 220ms var(--zm-ease), padding 220ms var(--zm-ease)',
      }}>
        <svg className="zm-brand-cube" width={sidebarCollapsed ? 28 : 34} height={sidebarCollapsed ? 28 : 34} viewBox="0 0 64 64" fill="none" style={{ display: 'block', flex: '0 0 auto', position: 'relative', zIndex: 1 }}>
          <defs>
            <linearGradient id="re-logo-g" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
              <stop offset="0%" stopColor="#D040C8"/>
              <stop offset="20%" stopColor="#F04090"/>
              <stop offset="38%" stopColor="#FF6020"/>
              <stop offset="55%" stopColor="#FFB020"/>
              <stop offset="72%" stopColor="#3060F8"/>
              <stop offset="88%" stopColor="#20D0F8"/>
              <stop offset="100%" stopColor="#7030D8"/>
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="12" fill="#150920"/>
          <path
            d="M32 4C40 4 42 14 42 22C42 30 52 32 60 32C52 32 42 34 42 42C42 50 40 60 32 60C24 60 22 50 22 42C22 34 12 32 4 32C12 32 22 30 22 22C22 14 24 4 32 4Z"
            fill="url(#re-logo-g)"
          />
          <path d="M32 22L42 32L32 42L22 32Z" fill="#150920"/>
        </svg>
        <span className="zm-brand-word" style={{
          fontFamily: 'var(--zm-font-display)', fontStyle: 'normal', fontWeight: 800,
          fontSize: 12, color: 'var(--zm-sidebar-fg)', letterSpacing: '0.06em', lineHeight: 1,
          whiteSpace: 'nowrap', position: 'relative', zIndex: 1,
          display: sidebarCollapsed ? 'none' : 'inline',
          textShadow: '0 1px 0 rgba(0,0,0,0.35), 0 0 24px rgba(122,231,218,0.15)',
        }}>{PRODUCT_NAME}</span>
        <span style={{
          position: 'absolute', top: 12, right: 12,
          width: 5, height: 5, borderRadius: 999,
          background: 'var(--zm-sidebar-accent)', boxShadow: '0 0 8px var(--zm-sidebar-accent)',
          zIndex: 1,
        }}/>
        {onToggleSidebar && (
          <button
            type="button"
            className="zm-sidebar-toggle"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleSidebar}
            style={{
              position: 'absolute',
              right: sidebarCollapsed ? 6 : 8,
              bottom: 12,
              width: sidebarCollapsed ? 22 : 24,
              height: sidebarCollapsed ? 22 : 24,
              borderRadius: 8,
              border: '1px solid var(--zm-sidebar-line)',
              background: 'var(--zm-sidebar-hover-bg)',
              color: 'var(--zm-sidebar-fg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 3,
              boxShadow: '0 8px 18px rgba(0,0,0,0.18)',
              transition: 'right 220ms var(--zm-ease), transform 160ms var(--zm-ease), background 160ms var(--zm-ease)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-sidebar-active-bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--zm-sidebar-hover-bg)'; }}
          >
            <Icon name="chevron" size={14} style={{ transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}/>
          </button>
        )}
      </div>

      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px', minWidth: 0,
      }}>
        <span style={{ flex: 1 }}/>

        <button onClick={onToggleDark} title={dark ? 'Switch to light' : 'Switch to dark'} className="zm-tb-btn" style={{
          width: 34, height: 34, padding: 0, borderRadius: 8,
          border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
          color: 'var(--zm-fg-2)', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flex: '0 0 auto',
        }}>
          {dark ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v1M12 20v1M3 12h1M20 12h1M5.6 5.6l.7.7M17.7 17.7l.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7"/></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
          )}
        </button>

        {showNewPipeline && (
          <button onClick={onNewPipeline} className="zm-tb-cta" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            height: 34, padding: '0 14px', borderRadius: 8,
            background: 'var(--zm-cta-bg)', color: 'var(--zm-cta-fg)', border: 'none',
            fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer', boxShadow: 'var(--zm-shadow-1)',
            whiteSpace: 'nowrap', lineHeight: 1, flex: '0 0 auto',
          }}>
            <Icon name="plus" size={13}/>
            <span>New pipeline</span>
          </button>
        )}

        <span style={{ width: 1, height: 24, background: 'var(--zm-line)', marginLeft: 2, flex: '0 0 auto' }}/>

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            title="Account"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              height: 40, padding: '0 10px 0 4px', borderRadius: 999,
              background: menuOpen ? 'var(--zm-surface-hover)' : 'transparent',
              border: '1px solid ' + (menuOpen ? 'var(--zm-line)' : 'transparent'),
              cursor: 'pointer', flex: '0 0 auto',
            }}
            onMouseEnter={(e) => { if (!menuOpen) { e.currentTarget.style.background = 'var(--zm-surface-hover)'; e.currentTarget.style.borderColor = 'var(--zm-line)'; } }}
            onMouseLeave={(e) => { if (!menuOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; } }}
          >
            <Avatar name={user.name} size={30}/>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, whiteSpace: 'nowrap', alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, color: 'var(--zm-fg)' }}>{user.name}</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--zm-font-body)', fontSize: 10.5, fontWeight: 600,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: role === 'supervisor' ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
                marginTop: 2,
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: 999,
                  background: role === 'supervisor' ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
                }}/>
                {role === 'supervisor' ? 'Supervisor' :
                 role === 'exec' || role === 'executive' ? 'Executive' :
                 (role || 'Executive')}
              </span>
            </div>
            <Icon name="chevronDown" size={12} style={{ color: 'var(--zm-fg-3)' }}/>
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                minWidth: 220,
                padding: 6,
                borderRadius: 12,
                border: '1px solid var(--zm-line)',
                background: 'var(--zm-surface)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
                zIndex: 50,
              }}
            >
              <div style={{
                padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2,
                borderBottom: '1px solid var(--zm-line)', marginBottom: 4,
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--zm-fg)' }}>{user.name}</span>
                <span style={{ fontSize: 11, color: 'var(--zm-fg-3)' }}>{user.email}</span>
              </div>
              
              {session.realRole === 'supervisor' && (
                <>
                  {session.hasExecutiveAccess ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (session.role === 'executive') {
                          switchAs(null, null);
                        } else {
                          switchAs('executive', session.module);
                        }
                      }}
                      style={{
                        width: '100%', textAlign: 'left',
                        padding: '8px 10px', borderRadius: 8,
                        border: 'none', background: 'transparent',
                        color: 'var(--zm-fg)', fontSize: 13, fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                        marginBottom: 4,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Icon name={session.role === 'executive' ? "arrow" : "document"} size={14} style={{ color: 'var(--zm-fg-3)' }}/>
                      {session.role === 'executive' ? 'Switch to Supervisor' : 'Switch to Executive'}
                    </button>
                  ) : session.pendingExecutiveRequest ? (
                    <div
                      style={{
                        width: '100%', textAlign: 'left',
                        padding: '8px 10px', borderRadius: 8,
                        color: 'var(--zm-fg-3)', fontSize: 13, fontWeight: 500,
                        display: 'flex', alignItems: 'center', gap: 8,
                        marginBottom: 4,
                        opacity: 0.7,
                      }}
                    >
                      <Icon name="clock" size={14} style={{ color: 'var(--zm-fg-3)' }}/>
                      Executive Access (Pending)
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await requestExecutiveAccess();
                          window.location.reload();
                        } catch (e) { console.error(e); }
                      }}
                      style={{
                        width: '100%', textAlign: 'left',
                        padding: '8px 10px', borderRadius: 8,
                        border: 'none', background: 'transparent',
                        color: 'var(--zm-accent)', fontSize: 13, fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                        marginBottom: 4,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Icon name="document" size={14} style={{ color: 'var(--zm-accent)' }}/>
                      Request Executive Access
                    </button>
                  )}
                  <div style={{ height: 1, background: 'var(--zm-line)', margin: '4px 0' }} />
                </>
              )}

              <button
                type="button"
                onClick={handleSignOut}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '8px 10px', borderRadius: 8,
                  border: 'none', background: 'transparent',
                  color: 'var(--zm-fg)', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon name="arrow" size={14} style={{ color: 'var(--zm-fg-3)', transform: 'rotate(180deg)' }}/>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
