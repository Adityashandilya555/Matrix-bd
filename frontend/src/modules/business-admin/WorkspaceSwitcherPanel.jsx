// skipcq: JS-0833
import React, { useState } from 'react';
import { activateOverride, deactivateOverride, getStoredOverride } from '../../services/api/adminOverride.js';
import { WORKSPACE_MODULES as MODULES, workspaceModule } from '../shared/workspaceModules.js';
import { T, Icon } from './ui/kit.jsx';

const ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'executive', label: 'Executive' },
];

const sel = {
  width: '100%', height: 34, padding: '0 8px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.surface,
  color: T.text, fontSize: 13, fontFamily: 'inherit',
};

const label = {
  fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: T.textFaint, marginBottom: 5, display: 'block',
};

// The panel is shared by the business admin and the observer, and the two need
// different copy for the same controls. The admin's says the guards are bypassed
// — true for them, and flatly wrong (and alarming) for an observer, whose every
// write is refused at get_current_user no matter which role it enters as.
const COPY = {
  business_admin: {
    blurb: 'Simulate a supervisor or executive of any module to see the workspace as they would. '
         + 'Their usual role and module limits are bypassed for you, so you still see every site.',
    enter: 'Enter Workspace',
    activeLabel: 'Active simulation',
  },
  observer: {
    blurb: 'Open a module in the main workspace, read-only. Choosing a role decides which view you '
         + 'get — a supervisor sees the whole module, an executive sees an executive’s slice. '
         + 'Neither can change anything: every edit, approval and deletion is refused for this account.',
    enter: 'Open module',
    activeLabel: 'Viewing',
  },
};

export default function WorkspaceSwitcherPanel({ variant = 'business_admin' }) {
  const copy = COPY[variant] || COPY.business_admin;
  const existing = getStoredOverride();
  const [selectedRole, setSelectedRole] = useState(existing?.role || 'supervisor');
  const [selectedModule, setSelectedModule] = useState(existing?.module || 'bd');
  const [active, setActive] = useState(existing);

  const handleEnter = () => {
    const mod = workspaceModule(selectedModule);
    const override = { role: selectedRole, module: selectedModule };
    activateOverride(override);
    setActive(override);
    // A full page load, not a client-side navigate. activateOverride() above
    // writes the module-level store that the axios interceptors read, but
    // SessionContext copies it into React state only at mount — so a soft
    // navigation would reach the workspace with the old role still in context.
    window.location.href = mod?.route || '/';
  };

  const handleExit = () => {
    deactivateOverride();
    setActive(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 520 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 720, color: T.text }}>Workspace Access</h2>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
          {copy.blurb}
        </p>
      </div>

      {active && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 10,
          background: T.accentSoft, border: `1px solid ${T.accent}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: T.accent, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.accentText }}>
              {copy.activeLabel}: {active.role} · {active.module}
            </span>
          </div>
          <button onClick={handleExit} style={{
            padding: '5px 14px', borderRadius: 8,
            border: 'none', background: 'var(--zm-danger)',
            color: 'var(--zm-accent-on)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            ✕ Exit Simulation
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <span style={label}>Role</span>
          <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)} style={sel}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Module</span>
          <select value={selectedModule} onChange={e => setSelectedModule(e.target.value)} style={sel}>
            {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <button onClick={handleEnter} style={{
        alignSelf: 'flex-start', height: 40, padding: '0 24px', borderRadius: 10, border: 'none',
        background: 'var(--zm-success)', color: 'var(--zm-accent-on)', fontSize: 13.5, fontWeight: 700,
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        boxShadow: 'var(--zm-shadow-1, none)',
        transition: 'background 160ms ease, box-shadow 160ms ease',
      }}
        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.filter = ''; }}
      >
        {copy.enter}
        <Icon.caret size={14} style={{ transform: 'rotate(-90deg)' }} />
      </button>
    </div>
  );
}
