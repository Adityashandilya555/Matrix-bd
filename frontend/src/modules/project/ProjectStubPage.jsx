import React from 'react';
import { useSession } from '../../state/SessionContext.jsx';
import Icon from '../shared/primitives/Icon.jsx';

export default function ProjectStubPage() {
  const { role } = useSession();
  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="box" size={22}/>
        <div>
          <div style={{
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
            letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            Project module · {role === 'supervisor' ? 'Supervisor' : 'Executive'}
          </div>
          <h1 style={{ margin: '4px 0 0', fontFamily: 'var(--zm-font-display)', fontSize: 28 }}>
            Project <em>Execution</em>
          </h1>
        </div>
      </div>

      <div className="zm-glass" style={{
        padding: 24, borderRadius: 12,
        border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
        display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520,
      }}>
        <div style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 11,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
        }}>Coming soon</div>
        <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 14, color: 'var(--zm-fg-2)', lineHeight: 1.6 }}>
          The Project module handles build tracking, BOQ approvals, contractor
          coordination, and quality audits from fit-out kick-off to handover.
          Feature pages are actively being built.
        </p>
        <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
          In the meantime you can manage your team in the <strong>Team</strong> section.
        </p>
      </div>
    </div>
  );
}
