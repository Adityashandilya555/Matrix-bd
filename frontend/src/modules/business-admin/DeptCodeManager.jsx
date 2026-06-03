import React from 'react';
import { getDeptCodes, rotateDeptCode } from '../../services/api/adapters/httpAdapter.js';

const MODULES = [
  { key: 'bd',      label: 'BD' },
  { key: 'legal',   label: 'Legal' },
  { key: 'payment', label: 'Payment' },
  { key: 'recce',   label: 'Recce' },
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        {MODULES.map(({ key, label }) => {
          const entry = codesByModule[key];
          const isRotating = rotatingModule === key;
          return (
            <div key={key} style={{ padding: 18, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 10, background: '#13141B', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>{label}</div>
              <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 16, fontWeight: 700, letterSpacing: '0.06em', padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.4)', color: entry?.code ? '#fff' : 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {loading ? '…' : (entry?.code || 'No code yet')}
              </code>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
                  {entry?.rotatedAt ? `Rotated ${new Date(entry.rotatedAt).toLocaleDateString()}` : (entry?.createdAt ? `Created ${new Date(entry.createdAt).toLocaleDateString()}` : '')}
                </span>
                <button onClick={() => rotate(key)} disabled={isRotating || loading} style={{ height: 30, padding: '0 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: isRotating ? 'wait' : 'pointer' }}>
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
