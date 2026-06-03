import React from 'react';
import { getDeptCodes, rotateDeptCode } from '../../services/api/adapters/httpAdapter.js';

// Recce is part of the Design module (Recce → 2D → 3D → BOQ), not a standalone
// department.
const MODULES = [
  { key: 'bd',      label: 'BD' },
  { key: 'legal',   label: 'Legal' },
  { key: 'payment', label: 'Finance / CA' },
  { key: 'design',  label: 'Design' },
  { key: 'project', label: 'Project' },
];

export default function DeptCodeManager() {
  const [codesByModule, setCodesByModule] = React.useState({});
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [rotatingModule, setRotatingModule] = React.useState(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const codes = await getDeptCodes();
      const byModule = {};
      for (const c of codes) byModule[c.module] = c;
      setCodesByModule(byModule);
    } catch (err) {
      setError(err.message || 'Failed to load department codes');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function rotate(moduleKey) {
    setRotatingModule(moduleKey);
    setError(null);
    try {
      await rotateDeptCode(moduleKey);
      await load();
    } catch (err) {
      setError(err.message || 'Rotate failed');
    } finally {
      setRotatingModule(null);
    }
  }

  return (
    <div>
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.18)', color: '#FCA5A5', marginBottom: 16, fontSize: 13 }}>{error}</div>}
      <div className="ba-code-grid">
        {MODULES.map(({ key, label }) => {
          const entry = codesByModule[key];
          const isRotating = rotatingModule === key;
          return (
            <div key={key} className="ba-code-card">
              <div className="ba-label">{label}</div>
              <code className={`ba-code-value ${entry?.code ? '' : 'empty'}`}>
                {loading ? '…' : (entry?.code || 'No code yet')}
              </code>
              <div className="ba-code-footer">
                <span className="ba-code-date">
                  {entry?.rotatedAt ? `Rotated ${new Date(entry.rotatedAt).toLocaleDateString()}` : (entry?.createdAt ? `Created ${new Date(entry.createdAt).toLocaleDateString()}` : '')}
                </span>
                <button className="ba-button ba-code-action" type="button" onClick={() => rotate(key)} disabled={isRotating || loading}>
                  {isRotating ? 'Rotating…' : 'Rotate'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
