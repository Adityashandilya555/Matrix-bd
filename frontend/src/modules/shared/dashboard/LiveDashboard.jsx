// skipcq: JS-0833
import React from 'react';
import RoleDashboard from './RoleDashboard.jsx';
import { toViewModel } from './toViewModel.js';
import { Card } from './kit.jsx';
import { useDashboard } from '../../../hooks/useDashboard.js';

const SCOPE_KEY = 'zm:dashboard-scope';

function readScope() {
  try { return window.localStorage.getItem(SCOPE_KEY) === 'team' ? 'team' : 'module'; } catch { return 'module'; }
}

// The live role dashboard: loads the caller's summary, refreshes it when the
// server's version moves, and draws it with RoleDashboard. `nso` reads the NSO
// supervisor view from /nso/summary (for executives with NSO access).
export default function LiveDashboard({ nso = false, deps }) {
  const [scope, setScopeState] = React.useState(readScope);
  const setScope = (s) => {
    setScopeState(s);
    try { window.localStorage.setItem(SCOPE_KEY, s); } catch { /* per-viewer convenience only */ }
  };
  const { data, status, error, lastUpdatedAt, refresh } = useDashboard({ scope, nso }, deps);
  const vm = React.useMemo(() => toViewModel(data), [data]);

  if (status === 'loading' && !vm) {
    return (
      <div className="dash" aria-busy="true">
        <div className="dash-hero" style={{ minHeight: 320, background: 'var(--zm-surface-sunken)' }} />
        <p className="dash-sub">Loading your dashboard…</p>
      </div>
    );
  }
  if (status === 'error' && !vm) {
    return (
      <Card>
        <div className="dash-empty">
          <h2 className="dash-title">The dashboard didn’t load</h2>
          <p className="dash-sub">{error?.message || 'Something went wrong.'}</p>
          <button type="button" className="dash-chip" aria-pressed="true" onClick={refresh}>Try again</button>
        </div>
      </Card>
    );
  }
  return <RoleDashboard data={vm} updatedAt={lastUpdatedAt} scope={data?.scope === 'team' ? 'team' : scope} onScope={setScope} />;
}
