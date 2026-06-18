import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import MetricCard from '../shared/primitives/MetricCard.jsx';
import { getPEQueue } from '../../services/api/projectExcellenceApi.js';
import { ROUTES } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

// Project Excellence overview — four KPIs over the PE queue. Each card
// deep-links into the Pipeline (queue) tab, where the matching status filter
// can be applied. Mirrors the Project module's overview pattern.

export default function ProjectExcellenceOverviewPage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  // Monotonic request id: useSiteDataRefresh calls load() directly (not via the
  // effect's cleanup), so a per-call `cancelled` flag can't stop an older,
  // slower getPEQueue() response from clobbering a newer one. Only the latest
  // request's result is allowed to write state.
  const reqIdRef = React.useRef(0);

  const load = React.useCallback(() => {
    const reqId = ++reqIdRef.current;
    setState((prev) => ({ ...prev, status: prev.items.length ? prev.status : 'loading', error: null }));
    getPEQueue()
      .then((data) => {
        if (reqId === reqIdRef.current) setState({ status: 'ready', items: data.items, total: data.total ?? 0, error: null });
      })
      .catch((err) => {
        if (reqId === reqIdRef.current) {
          setState((prev) => ({
            ...prev,
            status: prev.items.length ? 'ready' : 'error',
            error: err?.detail || err?.message || 'Failed to load project excellence queue',
          }));
        }
      });
    return undefined;
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['project_excellence', 'businessAdmin', 'project'] });

  const items = state.items;
  const loading = state.status === 'loading';

  const pending = items.filter((r) => r.excellenceStatus === 'pending').length;
  const budgeting = items.filter((r) => r.excellenceStatus === 'allocated' || r.excellenceStatus === 'budgeting').length;
  const approved = items.filter((r) => r.excellenceStatus === 'approved' || r.excellenceStatus === 'done').length;
  const adminReview = items.filter((r) => r.budgetStatus === 'pending_admin').length;
  const cityCount = new Set(items.map((r) => r.city).filter(Boolean)).size;

  const pad = (n) => String(n).padStart(2, '0');
  const val = (n) => (loading ? '··' : pad(n));

  const metrics = {
    all: {
      no: 'Ⅰ', eyebrow: 'In Project Excellence', rule: 'var(--zm-accent)', tone: 'peach',
      // Headline uses the server COUNT(*); the other KPIs stay per-status over
      // the loaded items.
      value: val(state.total), delta: 'Pipeline', deltaTone: 'neutral',
      sub: loading ? 'Loading queue…' : `Across ${cityCount} cit${cityCount === 1 ? 'y' : 'ies'}`,
    },
    pending: {
      no: 'Ⅱ', eyebrow: 'Awaiting allocation', rule: 'var(--zm-warning)', tone: 'blue',
      value: val(pending), delta: 'Needs a supervisor', deltaTone: 'neutral',
      sub: 'Unallocated sites',
    },
    budgeting: {
      no: 'Ⅲ', eyebrow: 'Budgeting', rule: 'var(--zm-copper)', tone: 'mint',
      value: val(budgeting), delta: 'Allocated · in progress', deltaTone: 'neutral',
      sub: loading ? 'Loading queue…' : `${adminReview} awaiting admin review`,
    },
    approved: {
      no: 'Ⅳ', eyebrow: 'Approved', rule: 'var(--zm-success)', tone: 'slate',
      value: val(approved), delta: 'Budget approved', deltaTone: 'pos',
      sub: 'Open the History tab →',
    },
  };

  const openQueue = () => navigate(ROUTES.PROJECT_EXCELLENCE);
  const openHistory = () => navigate(ROUTES.PROJECT_EXCELLENCE_HISTORY);

  const lede = loading
    ? 'Loading the project excellence queue…'
    : `${state.total} site${state.total === 1 ? '' : 's'} in the project excellence queue`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow="Project Excellence module"
        title="Overview"
        lede={lede}
        right={<HeaderTag icon="box" label="DESIGN → PROJECT"/>}
      />

      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>
      )}

      {state.status !== 'error' && (
        <div className="zm-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <MetricCard {...metrics.all} onClick={openQueue}/>
          <MetricCard {...metrics.pending} onClick={openQueue}/>
          <MetricCard {...metrics.budgeting} onClick={openQueue}/>
          <MetricCard {...metrics.approved} onClick={openHistory}/>
        </div>
      )}
    </div>
  );
}
