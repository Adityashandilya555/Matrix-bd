import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import {
  listLegalHistory,
} from '../../services/api/legalApi.js';
import { listDesignHistory } from '../../services/api/designApi.js';
import { listProjectHistory } from '../../services/api/projectApi.js';
import { listNsoHistory } from '../../services/api/nsoApi.js';
import { getSiteTrackerView } from '../../services/api/siteTrackerApi.js';
import {
  ROUTES,
  legalProcessFlowSiteRoute,
  designProcessFlowSiteRoute,
  projectProcessFlowSiteRoute,
  nsoProcessFlowSiteRoute,
} from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';

const CONFIG = {
  legal: {
    icon: 'legalShield',
    eyebrow: 'Legal module',
    title: 'Process flow',
    lede: 'Read-only state diagram for sites that entered Legal. Finance details remain in the BD process flow.',
    list: listLegalHistory,
    listRoute: ROUTES.LEGAL_PROCESS_FLOW,
    detailRoute: legalProcessFlowSiteRoute,
  },
  design: {
    icon: 'box',
    eyebrow: 'Design module',
    title: 'Process flow',
    lede: 'Read-only state diagram for design handoffs and downstream progress.',
    list: listDesignHistory,
    listRoute: ROUTES.DESIGN_PROCESS_FLOW,
    detailRoute: designProcessFlowSiteRoute,
  },
  project: {
    icon: 'route',
    eyebrow: 'Project module',
    title: 'Process flow',
    lede: 'Read-only state diagram for project-stage sites and completion state.',
    list: listProjectHistory,
    listRoute: ROUTES.PROJECT_PROCESS_FLOW,
    detailRoute: projectProcessFlowSiteRoute,
  },
  nso: {
    icon: 'home',
    eyebrow: 'NSO module',
    title: 'Process flow',
    lede: 'Read-only state diagram for NSO-stage sites from project handoff through site launch.',
    list: listNsoHistory,
    listRoute: ROUTES.NSO_PROCESS_FLOW,
    detailRoute: nsoProcessFlowSiteRoute,
  },
};

// Peach-skyline node states. Color carries meaning, but the DONE/PENDING/QUEUED
// label is the redundant non-color cue so states stay legible without relying on
// hue alone (AA + colorblind-safe):
//   complete → mint/teal (keeps "green = done")
//   active   → peach + amber (warm "in-progress", the yellow replacement)
//   queued   → white/neutral (not started)
const STAGE_COPY = {
  complete: {
    label: 'DONE',
    border: 'rgba(21, 135, 107, 0.55)',
    background: 'rgba(21, 135, 107, 0.10)',
    color: 'var(--zm-success)',
  },
  active: {
    label: 'PENDING',
    border: 'rgba(154, 99, 33, 0.45)',
    background: 'rgba(255, 219, 187, 0.45)',
    color: 'var(--zm-copper)',
  },
  queued: {
    label: 'QUEUED',
    // Theme-aware so the queued node stays legible in dark mode (a hardcoded
    // white fill read as a low-contrast mid-grey panel there).
    border: 'var(--zm-line)',
    background: 'var(--zm-surface-2)',
    color: 'var(--zm-fg-3)',
  },
};

const STAGE_ICONS = {
  loi: 'document',
  legal: 'legalShield',
  ca: 'paymentCard',
  design: 'box',
  excellence: 'trend',
  project: 'route',
  nso: 'home',
  launch: 'flag',
};

function pretty(value) {
  if (value == null || value === '') return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function isLegalComplete(data) {
  return data?.siteStatus === 'legal_approved'
    || data?.siteStatus === 'pushed_to_payments'
    || (
      data?.legalDdStatus === 'positive'
      && ['registered', 'signed', 'executed'].includes(data?.agreementStatus)
      && data?.licensingStatus === 'complete'
    );
}

function isLegalActive(data) {
  return data?.siteStatus === 'legal_review'
    || data?.legalDdStatus === 'positive'
    || data?.legalDdStatus === 'pending'
    || ['signed', 'executed', 'registered'].includes(data?.agreementStatus)
    || ['partial', 'complete'].includes(data?.licensingStatus);
}

function isDesignReady(data) {
  return data?.legalDdStatus === 'positive' && data?.financeStatus === 'approved';
}

function buildStages(data) {
  const loiComplete = Boolean(data?.siteStatus);
  const legalComplete = isLegalComplete(data);
  const financeComplete = data?.financeStatus === 'approved' || data?.siteStatus === 'pushed_to_payments';
  const financeActive = loiComplete && !financeComplete;
  const designComplete = data?.designStatus === 'approved';
  const designActive = !designComplete && isDesignReady(data);
  const projectComplete = data?.projectStatus === 'done';
  // Project Excellence = the budgeting phase between GFC and execution. A done
  // execution implies the budget cleared even if the row predates the budget
  // workflow (no project_budget_status).
  const excellenceComplete = data?.projectBudgetStatus === 'approved' || projectComplete;
  const excellenceActive = !excellenceComplete && designComplete;
  const projectActive = !projectComplete && (excellenceComplete || data?.projectStatus === 'in_progress');
  const nsoComplete = data?.nsoStatus === 'complete';
  const nsoActive = !nsoComplete && projectComplete;
  const launchedComplete = Boolean(data?.isLaunched) || data?.launchStatus === 'launched';
  const launchedActive = !launchedComplete && nsoComplete;

  return [
    {
      id: 'loi',
      label: 'BD LOI Signed',
      state: loiComplete ? 'complete' : 'queued',
      note: 'BD handoff received',
    },
    {
      id: 'legal',
      label: 'Legal & Compliance',
      state: legalComplete ? 'complete' : isLegalActive(data) ? 'active' : 'queued',
      note: data?.legalDdStatus === 'negative' ? 'Rejected' : pretty(data?.legalDdStatus),
    },
    {
      id: 'ca',
      label: 'CA / Commercial Code',
      state: financeComplete ? 'complete' : financeActive ? 'active' : 'queued',
      note: pretty(data?.financeStatus),
    },
    {
      id: 'design',
      label: 'Design / Technical',
      state: designComplete ? 'complete' : designActive ? 'active' : 'queued',
      note: pretty(data?.designStatus),
    },
    {
      id: 'excellence',
      label: 'Project Excellence',
      state: excellenceComplete ? 'complete' : excellenceActive ? 'active' : 'queued',
      note: pretty(data?.projectBudgetStatus),
    },
    {
      id: 'project',
      label: 'Project Execution',
      state: projectComplete ? 'complete' : projectActive ? 'active' : 'queued',
      note: pretty(data?.projectStatus || data?.projectCurrentStage),
    },
    {
      id: 'nso',
      label: 'NSO',
      state: nsoComplete ? 'complete' : nsoActive ? 'active' : 'queued',
      note: pretty(data?.nsoStatus || data?.nsoCurrentStage),
    },
    {
      id: 'launch',
      label: 'Site Launched',
      state: launchedComplete ? 'complete' : launchedActive ? 'active' : 'queued',
      note: launchedComplete ? 'Launched' : launchedActive ? 'Launch pending' : 'Queued',
    },
  ];
}

function stageStyle(state) {
  return STAGE_COPY[state] || STAGE_COPY.queued;
}

function StageDiagram({ stages }) {
  return (
    <div
      className="zm-glass"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stages.length}, minmax(128px, 1fr))`,
        gap: 14,
        alignItems: 'stretch',
        padding: 18,
        borderRadius: 12,
        overflowX: 'auto',
      }}
    >
      {stages.map((stage, index) => {
        const colors = stageStyle(stage.state);
        // Connector inherits the upstream stage's completion: a green thread
        // traces how far the site has travelled through the pipeline.
        const upstreamDone = index > 0 && stages[index - 1].state === 'complete';
        return (
          <div key={stage.id} style={{ position: 'relative', minWidth: 128 }}>
            {index > 0 && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: -14,
                  right: 'calc(100% - 1px)',
                  top: '50%',
                  height: upstreamDone ? 2 : 1,
                  borderRadius: 999,
                  background: upstreamDone ? 'var(--zm-success)' : 'var(--zm-line)',
                  opacity: upstreamDone ? 0.55 : 1,
                  transform: 'translateY(-50%)',
                  zIndex: 0,
                }}
              />
            )}
            <div
              title={`${stage.label}: ${colors.label}`}
              style={{
                minHeight: 112,
                position: 'relative',
                zIndex: 1,
                border: `1px solid ${colors.border}`,
                background: colors.background,
                borderRadius: 12,
                padding: 14,
                display: 'grid',
                alignContent: 'center',
                gap: 8,
                textAlign: 'center',
                color: stage.state === 'queued' ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
                boxShadow: stage.state === 'active' ? '0 12px 28px rgba(154, 99, 33, 0.12)' : 'none',
              }}
            >
              <span style={{ display: 'inline-flex', justifyContent: 'center', color: colors.color }}>
                <Icon name={STAGE_ICONS[stage.id]} size={22} stroke={1.8} />
              </span>
              <strong style={{
                fontSize: 13,
                lineHeight: 1.25,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                textDecoration: 'none',
              }}>
                {stage.label}
              </strong>
              <span style={{
                color: colors.color,
                fontFamily: 'var(--zm-font-body)',
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}>
                {stage.state === 'active' && stage.id === 'legal' ? 'OPEN' : colors.label}
              </span>
              {stage.state !== 'queued'
                && stage.note
                && stage.note.toLowerCase() !== colors.label.toLowerCase() && (
                <span style={{
                  color: 'var(--zm-fg-3)',
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 10.5,
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {stage.note}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlowLegend() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {[
        ['complete', 'Complete'],
        ['active', 'Active / pending'],
        ['queued', 'Queued'],
      ].map(([state, label]) => {
        const colors = stageStyle(state);
        return (
          <span key={state} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 9px',
            borderRadius: 999,
            border: `1px solid ${colors.border}`,
            background: colors.background,
            color: 'var(--zm-fg-2)',
            fontSize: 11,
            fontWeight: 800,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: colors.color }} />
            {label}
          </span>
        );
      })}
    </div>
  );
}

function StatusChip({ value }) {
  return (
    <span style={{
      display: 'inline-flex',
      height: 22,
      alignItems: 'center',
      padding: '0 8px',
      borderRadius: 999,
      border: '1px solid var(--zm-line)',
      color: 'var(--zm-fg-2)',
      background: 'var(--zm-surface-2)',
      fontSize: 10,
      fontWeight: 850,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {pretty(value)}
    </span>
  );
}

function summaryFor(moduleKey, item) {
  if (moduleKey === 'legal') return [item.legalDdStatus, item.agreementStatus, item.licensingStatus];
  if (moduleKey === 'design') return [item.designStatus, item.currentStage, item.gfcStatus];
  if (moduleKey === 'project') return [item.projectStatus, item.currentStage, item.budgetStatus];
  return [item.nsoStatus, item.currentStage, item.projectStatus, item.launchStatus, item.isLaunched];
}

export default function ModuleProcessFlowPage({ moduleKey }) {
  const config = CONFIG[moduleKey] || CONFIG.legal;
  const { siteId } = useParams();
  const navigate = useNavigate();
  useFocusSite();

  const [query, setQuery] = React.useState('');
  const [listState, setListState] = React.useState({ status: 'loading', items: [], error: null });
  const [detailState, setDetailState] = React.useState({ status: 'idle', detail: null, error: null });
  const listRequestRef = React.useRef(0);

  const loadList = React.useCallback(() => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setListState((prev) => ({ ...prev, status: 'loading', error: null }));
    config.list('all')
      .then((data) => {
        if (requestId !== listRequestRef.current) return;
        setListState({ status: 'ready', items: data.items || [], error: null });
      })
      .catch((err) => {
        if (requestId !== listRequestRef.current) return;
        setListState({ status: 'error', items: [], error: err?.detail || err?.message || 'Process flow failed to load.' });
      });
  }, [config]);

  const loadDetail = React.useCallback(() => {
    if (!siteId) {
      setDetailState({ status: 'idle', detail: null, error: null });
      return;
    }
    setDetailState((prev) => ({ ...prev, status: 'loading', error: null }));
    getSiteTrackerView(siteId)
      .then((detail) => setDetailState({ status: 'ready', detail, error: null }))
      .catch((err) => setDetailState({ status: 'error', detail: null, error: err?.detail || err?.message || 'Could not load this process flow.' }));
  }, [siteId]);

  React.useEffect(() => { loadList(); }, [loadList]);
  React.useEffect(() => { loadDetail(); }, [loadDetail]);
  useSiteDataRefresh(loadList);
  useSiteDataRefresh(loadDetail, { enabled: Boolean(siteId), siteId });

  const filtered = listState.items.filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [item.siteCode, item.siteName, item.city, item.submittedByName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  const stages = buildStages(detailState.detail);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. F"
        eyebrow={config.eyebrow}
        title={config.title}
        lede={config.lede}
        right={<HeaderTag icon={config.icon} label="STATE DIAGRAM" />}
      />

      <div className="zm-glass" style={{ padding: 14, borderRadius: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 280px', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--zm-fg-3)' }}>
            <Icon name="search" size={14} />
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search site, code, city, or owner..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              height: 38,
              padding: '0 12px 0 36px',
              borderRadius: 9,
              border: '1px solid var(--zm-line)',
              background: 'var(--zm-surface)',
              fontFamily: 'var(--zm-font-body)',
            }}
          />
        </div>
        <FlowLegend />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: siteId ? 'minmax(300px, 0.62fr) minmax(0, 1.38fr)' : '1fr',
        gap: 16,
        alignItems: 'start',
      }}>
        <section className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--zm-line)' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Sites</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--zm-fg-3)', fontSize: 12.5 }}>
              {listState.status === 'loading' ? 'Loading process flow...' : `${filtered.length} site${filtered.length === 1 ? '' : 's'} in this module`}
            </p>
          </div>
          {listState.error && (
            <div style={{ padding: 16, color: 'var(--zm-danger)' }}>
              {listState.error}
              <button type="button" onClick={loadList} style={{ marginLeft: 12 }}>Retry</button>
            </div>
          )}
          {!listState.error && filtered.length === 0 && (
            <div style={{ padding: 24, color: 'var(--zm-fg-3)' }}>
              No sites have entered this module yet.
            </div>
          )}
          {!listState.error && filtered.map((item) => {
            const active = item.siteId === siteId;
            return (
              <button
                key={item.siteId}
                type="button"
                onClick={() => navigate(config.detailRoute(item.siteId))}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 0,
                  borderBottom: '1px solid var(--zm-line)',
                  background: active ? 'var(--zm-accent-weak)' : 'transparent',
                  padding: 16,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--zm-font-mono)', color: 'var(--zm-fg-3)', fontSize: 12 }}>
                      {item.siteCode || 'No code'}
                    </div>
                    <strong style={{ display: 'block', marginTop: 4, fontSize: 15 }}>{item.siteName || 'Untitled site'}</strong>
                    <div style={{ marginTop: 4, color: 'var(--zm-fg-3)', fontSize: 12.5 }}>
                      {[item.city, item.submittedByName].filter(Boolean).join(' · ') || 'No location'}
                    </div>
                  </div>
                  <StatusChip value={summaryFor(moduleKey, item)[0] || 'pending'} />
                </div>
              </button>
            );
          })}
        </section>

        <section className="zm-glass" style={{ borderRadius: 12, padding: 18, minHeight: 260 }}>
          {!siteId && (
            <div style={{ color: 'var(--zm-fg-3)' }}>
              Select a site to inspect the read-only process flow.
            </div>
          )}
          {siteId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <button
                type="button"
                onClick={() => navigate(config.listRoute)}
                style={{
                  alignSelf: 'flex-start',
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: '1px solid var(--zm-line)',
                  background: 'var(--zm-surface)',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ← Back to process flow
              </button>

              {detailState.status === 'loading' && <div style={{ color: 'var(--zm-fg-3)' }}>Loading process flow...</div>}
              {detailState.error && (
                <div style={{ color: 'var(--zm-danger)' }}>
                  {detailState.error}
                  <button type="button" onClick={loadDetail} style={{ marginLeft: 12 }}>Retry</button>
                </div>
              )}
              {detailState.detail && (
                <>
                  <div>
                    <div style={{ fontFamily: 'var(--zm-font-mono)', color: 'var(--zm-fg-3)', fontSize: 12 }}>
                      {detailState.detail.siteCode || 'No code'} · {detailState.detail.city || 'No city'}
                    </div>
                    <h2 style={{ margin: '4px 0 0', fontSize: 26 }}>{detailState.detail.siteName || 'Untitled site'} flow</h2>
                    <p style={{ margin: '6px 0 0', color: 'var(--zm-fg-3)' }}>
                      Read-only state diagram. Open BD Process flow for Finance / CA actions.
                    </p>
                  </div>
                  <StageDiagram stages={stages} />
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
