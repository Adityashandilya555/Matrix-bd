// The strip a supervisor sees while working inside a module they borrowed under
// an approved grant (migration 20260930).
//
// Modelled on ReadOnlyBanner rather than App.jsx's floating "Simulating" chip:
// that chip is gated on isBusinessAdmin and reads as an admin debugging tool,
// while this is the same kind of statement the observer strip makes — you are
// inside someone else's module, and here is the way out.
//
// Unlike ReadOnlyBanner this navigates softly. That banner hard-reloads because
// SessionContext seeds the override store only at mount; here switchAs updates
// the provider synchronously before navigate() runs, which is the same reason
// App.jsx's chip gets away with a soft navigation.
//
// A 60s poll is what corrects a live session when a grant is revoked while the
// user sits on a page. The boundary itself is immediate — deps.py re-reads the
// grant on every request — and a reload self-corrects through whoami; this only
// covers the "still sitting there, clicking nothing" case. A structured error
// code on the 403 would remove the poll, but ApiError.code is populated from
// axios's err.code rather than the response detail, so both interceptors and the
// shared error shape would have to change to carry it. Not worth two shared
// files to save one small poll.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../state/SessionContext.jsx';
import { ROLE } from '../../../rbac/roles.js';
import { workspaceModuleLabel, workspaceModuleRoute } from '../workspaceModules.js';
import { listMyModuleAccess } from '../../../services/api/adapters/httpAdapter.js';
import Icon from '../primitives/Icon.jsx';

const POLL_MS = 60_000;

export default function BorrowedAccessBanner() {
  const {
    session, borrowedModule, switchAs,
    workspaceAccessRevoked, clearWorkspaceAccessRevoked,
  } = useSession();
  const navigate = useNavigate();
  const [granted, setGranted] = useState([]);

  const goHome = useCallback(() => {
    switchAs(null, null);
    navigate(workspaceModuleRoute(session?.module));
  }, [switchAs, navigate, session?.module]);

  // Poll only while borrowing, and only while the tab is visible — the same
  // rule the business-admin queues follow.
  useEffect(() => {
    if (!borrowedModule) return undefined;
    let alive = true;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const rows = await listMyModuleAccess();
        if (!alive) return;
        setGranted(rows.filter((r) => r.state === 'granted').map((r) => r.module));
        if (!rows.some((r) => r.module === borrowedModule && r.state === 'granted')) {
          goHome();
        }
      } catch {
        // A transient failure must not eject someone mid-task; the backend is
        // the boundary and will refuse anything that actually matters.
      }
    };
    check();
    const id = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [borrowedModule, goHome]);

  if (workspaceAccessRevoked && !borrowedModule) {
    const lost = workspaceModuleLabel(workspaceAccessRevoked) || workspaceAccessRevoked;
    return (
      <Strip tone="warn" testId="borrowed-access-revoked">
        <Icon name="warning" size={14} style={{ color: 'var(--zm-warning, #b45309)', flexShrink: 0 }} />
        <span>
          Your access to {lost} was withdrawn. You are back in{' '}
          {workspaceModuleLabel(session?.module) || 'your module'}.
        </span>
        <span style={{ flex: 1 }} />
        <BannerButton onClick={clearWorkspaceAccessRevoked}>Dismiss</BannerButton>
      </Strip>
    );
  }

  if (!borrowedModule) return null;

  const here = workspaceModuleLabel(borrowedModule) || borrowedModule;
  const home = workspaceModuleLabel(session?.module) || 'your own module';
  const others = granted.filter((m) => m !== borrowedModule);

  return (
    <Strip tone="accent" testId="borrowed-access-banner">
      <Icon name="layers" size={14} style={{ color: 'var(--zm-accent)', flexShrink: 0 }} />
      <span>Supervising {here} under approved workspace access. Your own module is {home}.</span>
      <span style={{ flex: 1 }} />
      {others.length > 0 && (
        <select
          aria-label="Switch borrowed module"
          data-testid="borrowed-module-switch"
          value={borrowedModule}
          onChange={(e) => {
            const next = e.target.value;
            if (!next || next === borrowedModule) return;
            switchAs(ROLE.SUPERVISOR, next);
            navigate(workspaceModuleRoute(next));
          }}
          style={{
            height: 26, padding: '0 8px', borderRadius: 8, cursor: 'pointer',
            border: '1px solid color-mix(in srgb, var(--zm-accent) 45%, transparent)',
            background: 'var(--zm-surface)', color: 'var(--zm-fg)',
            fontSize: 12, fontWeight: 650, fontFamily: 'inherit', flexShrink: 0,
          }}
        >
          {[borrowedModule, ...others].map((m) => (
            <option key={m} value={m}>{workspaceModuleLabel(m) || m}</option>
          ))}
        </select>
      )}
      <BannerButton onClick={goHome}>Exit workspace</BannerButton>
    </Strip>
  );
}

function Strip({ tone, testId, children }) {
  const colour = tone === 'warn' ? 'var(--zm-warning, #b45309)' : 'var(--zm-accent)';
  return (
    <div
      role="status"
      data-testid={testId}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        // Matches <main>'s gutter so it reads as the top of the page.
        padding: '8px 32px', flexShrink: 0,
        background: `color-mix(in srgb, ${colour} 12%, var(--zm-surface))`,
        borderBottom: `1px solid color-mix(in srgb, ${colour} 30%, transparent)`,
        color: 'var(--zm-fg)', fontSize: 12.5, fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function BannerButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: '1px solid color-mix(in srgb, var(--zm-accent) 45%, transparent)',
        background: 'transparent', color: 'var(--zm-accent)',
        borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700,
        cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
