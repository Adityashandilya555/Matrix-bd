import React, { useState } from 'react';
import { activateOverride, deactivateOverride, getStoredOverride } from '../../services/api/adminOverride.js';
import { T, Icon } from './ui/kit.jsx';

const ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'executive', label: 'Executive' },
];

const MODULES = [
  { value: 'bd',                  label: 'BD',                  route: '/' },
  { value: 'legal',               label: 'Legal',               route: '/legal' },
  { value: 'design',              label: 'Design',              route: '/design' },
  { value: 'project_excellence',  label: 'Project Excellence',  route: '/project-excellence' },
  { value: 'project',             label: 'Project',             route: '/project' },
  { value: 'nso',                 label: 'NSO',                 route: '/nso' },
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

export default function WorkspaceSwitcherPanel() {
  const existing = getStoredOverride();
  const [selectedRole, setSelectedRole] = useState(existing?.role || 'supervisor');
  const [selectedModule, setSelectedModule] = useState(existing?.module || 'bd');
  const [active, setActive] = useState(existing);

  const handleEnter = () => {
    const mod = MODULES.find(m => m.value === selectedModule);
    const override = { role: selectedRole, module: selectedModule };
    activateOverride(override);
    setActive(override);
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
          Simulate a role in the main workspace. All API calls will carry your override context
          and the backend will bypass its normal role and module guards — you always see all sites.
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
              Active simulation: {active.role} · {active.module}
            </span>
          </div>
          <button onClick={handleExit} style={{
            padding: '4px 12px', borderRadius: 8,
            border: `1px solid ${T.accent}`, background: 'transparent',
            color: T.accentText, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Exit
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
        alignSelf: 'flex-start', height: 38, padding: '0 20px', borderRadius: 10, border: 'none',
        background: T.accent, color: T.accentText, fontSize: 13, fontWeight: 700,
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}>
        Enter Workspace
        <Icon.caret size={14} style={{ transform: 'rotate(-90deg)' }} />
      </button>
    </div>
  );
}
