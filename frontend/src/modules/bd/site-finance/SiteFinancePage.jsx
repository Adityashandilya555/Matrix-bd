// skipcq: JS-0833
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import { getSiteTrackerView } from '../../../services/api/siteTrackerApi.js';
import { siteTrackerDetailRoute } from '../../../router/routes.js';
import { useSession } from '../../../state/SessionContext.jsx';
import { useSiteDataRefresh } from '../../../hooks/useSiteDataRefresh.js';
import FinancePanel from './FinancePanel.jsx';

// Focused full-page CA / Commercial-code finance workflow. Reached from the
// site-tracker CA node — the content column swaps to this page (with a back
// button) the same way the Legal node opens the Site status page, rather than
// popping a squeezed side panel.

const FINANCE_TAG = {
  approved:            { icon: 'check', label: 'APPROVED' },
  awaiting_admin:      { icon: 'clock', label: 'AWAITING ADMIN' },
  awaiting_supervisor: { icon: 'clock', label: 'AWAITING SUPERVISOR' },
  pending:             { icon: 'clock', label: 'NOT STARTED' },
};

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32, padding: '0 14px', border: '1px solid var(--zm-line)',
        borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg)',
        fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
        cursor: 'pointer', alignSelf: 'flex-start',
      }}
    >
      ← Back to flow
    </button>
  );
}

export default function SiteFinancePage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { role } = useSession();
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const cancelledRef = React.useRef(false);

  const load = React.useCallback((silent = false) => {
    if (!siteId) return;
    if (!silent) setState((s) => ({ ...s, status: 'loading' }));
    getSiteTrackerView(siteId)
      .then((data) => { if (!cancelledRef.current) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelledRef.current) setState({
        status: 'error', data: null,
        error: err?.detail || err?.message || 'Failed to load finance status',
      }); });
  }, [siteId]);

  React.useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => { cancelledRef.current = true; };
  }, [load]);
  useSiteDataRefresh(React.useCallback(() => load(true), [load]), { siteId });

  if (state.status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading…</div>;
  }
  if (state.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger, #B91C1C)' }}>{state.error}</div>
        <BackButton onClick={() => navigate(siteTrackerDetailRoute(siteId))}/>
      </div>
    );
  }

  const data = state.data;
  const displayCode = data.caCode || data.siteCode || data.siteId;
  const tag = FINANCE_TAG[data.financeStatus] || FINANCE_TAG.pending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <BackButton onClick={() => navigate(siteTrackerDetailRoute(siteId))}/>
      <PageHeader
        file="No. 08"
        eyebrow={`Site · ${displayCode}`}
        title={<>CA / <em>Commercial code</em></>}
        lede={`${data.siteName}${data.city ? ' · ' + data.city : ''} — KYC, CA code & token approval`}
        right={<HeaderTag icon={tag.icon} label={tag.label}/>}
      />
      <FinancePanel
        data={data}
        role={role}
        mode="page"
        onUpdate={() => load(true)}
      />
    </div>
  );
}
