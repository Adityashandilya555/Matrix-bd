// skipcq: JS-0833
// The persistent read-only strip, shown to an observer viewing a module.
//
// It has to be persistent rather than a toast because an observer is not
// visiting briefly — it is the whole session. Every module page around it is
// rendering in its supervisor's shape, buttons included, and this is the only
// thing on screen that says why pressing one won't do anything.
//
// Deliberately part of the chrome, not the scrolling content: it sits between
// the TopBar and the main column so it survives navigation and scroll.
//
// It also carries the module switcher. Without one, changing module meant
// leaving to the portal and re-entering through Workspace Access — three steps
// and a lost place in the app, every single time. The control sits here rather
// than in the TopBar because this strip already names the module being viewed,
// and a control belongs next to the label it changes.
import React from 'react';
import { useSession } from '../../../state/SessionContext.jsx';
import { activateOverride } from '../../../services/api/adminOverride.js';
import { WORKSPACE_MODULES, workspaceModuleLabel, workspaceModuleRoute } from '../workspaceModules.js';
import Icon from '../primitives/Icon.jsx';

export default function ReadOnlyBanner({ onLeave }) {
  const { isReadOnly, effectiveModule, role } = useSession();
  if (!isReadOnly) return null;

  const where = workspaceModuleLabel(effectiveModule);
  const as = role === 'executive' ? 'an executive' : 'a supervisor';

  // A full page load, not a client-side navigate — the same reason the
  // Workspace Access panel reloads. activateOverride() writes the module-level
  // store the axios interceptors read, but SessionContext copies it into React
  // state only at mount, so a soft navigation would arrive at the new module
  // with the old one still in context and every query scoped to the wrong
  // module. Reloading is what makes the switch atomic.
  //
  // The role carries over rather than resetting to supervisor: an observer
  // reading as an executive is deliberately looking at an executive's slice,
  // and silently promoting them on every module change would undo that.
  const switchModule = (next) => {
    if (!next || next === effectiveModule) return;
    activateOverride({ role: role === 'executive' ? 'executive' : 'supervisor', module: next });
    window.location.href = workspaceModuleRoute(next);
  };

  return (
    <div
      role="status"
      data-testid="read-only-banner"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '7px 20px', flexShrink: 0,
        background: 'color-mix(in srgb, var(--zm-accent) 12%, var(--zm-surface))',
        borderBottom: '1px solid color-mix(in srgb, var(--zm-accent) 30%, transparent)',
        color: 'var(--zm-fg)', fontSize: 12.5, fontWeight: 600,
      }}
    >
      <Icon name="lock" size={14} style={{ color: 'var(--zm-accent)', flexShrink: 0 }} />
      <span>
        Read-only — signed in as Observer
        {where ? `, viewing ${where} as ${as}` : ''}. Nothing here can be edited,
        approved or deleted.
      </span>
      <span style={{ flex: 1 }} />

      {/* aria-label rather than a visible <label>: the strip is one sentence,
          and a second "Module:" caption beside it would read as noise. */}
      <select
        aria-label="Switch module"
        data-testid="read-only-module-switch"
        value={effectiveModule || ''}
        onChange={(e) => switchModule(e.target.value)}
        style={{
          height: 26, padding: '0 8px', borderRadius: 8, cursor: 'pointer',
          border: '1px solid color-mix(in srgb, var(--zm-accent) 45%, transparent)',
          background: 'var(--zm-surface)', color: 'var(--zm-fg)',
          fontSize: 12, fontWeight: 650, fontFamily: 'inherit', flexShrink: 0,
        }}
      >
        {/* An observer always arrives with a module, so this is a placeholder
            for the impossible case rather than a choice worth offering. */}
        {!effectiveModule && <option value="">Choose a module…</option>}
        {WORKSPACE_MODULES.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>

      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          style={{
            border: '1px solid color-mix(in srgb, var(--zm-accent) 45%, transparent)',
            background: 'transparent', color: 'var(--zm-accent)',
            borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}
        >
          Leave module
        </button>
      )}
    </div>
  );
}
