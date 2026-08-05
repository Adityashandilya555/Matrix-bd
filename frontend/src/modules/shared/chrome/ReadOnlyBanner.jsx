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
import React from 'react';
import { useSession } from '../../../state/SessionContext.jsx';
import Icon from '../primitives/Icon.jsx';

const MODULE_LABELS = {
  bd: 'BD',
  legal: 'Legal',
  design: 'Design',
  project: 'Project',
  project_excellence: 'Project Excellence',
  nso: 'NSO',
};

export default function ReadOnlyBanner({ onLeave }) {
  const { isReadOnly, effectiveModule, role } = useSession();
  if (!isReadOnly) return null;

  const where = MODULE_LABELS[effectiveModule] || null;
  const as = role === 'executive' ? 'an executive' : 'a supervisor';

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
