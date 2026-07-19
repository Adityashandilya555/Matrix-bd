import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import { getSiteActivity, labelForEntry, humanizeAuditDetail } from '../../services/api/audit.js';
import { getLegalReview, listLegalHistory } from '../../services/api/legalApi.js';
import { getDesignReview, listDesignHistory } from '../../services/api/designApi.js';
import { getProjectHistoryDetail, listProjectHistory } from '../../services/api/projectApi.js';
import { getNsoHistoryDetail, listNsoHistory } from '../../services/api/nsoApi.js';
import {
  legalHistorySiteRoute,
  designHistorySiteRoute,
  projectHistorySiteRoute,
  nsoHistorySiteRoute,
  ROUTES,
} from '../../router/routes.js';
import ViewMoreButton from '../shared/primitives/ViewMoreButton.jsx';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { usePagedList } from '../../hooks/usePagedList.js';
import { useFocusSite } from '../../hooks/useFocusSite.js';

const FILTERS = [
  { key: 'all', label: 'All', color: null },
  { key: 'active', label: 'Active', color: 'var(--zm-accent)' },
  { key: 'approved', label: 'Approved', color: 'var(--zm-success)' },
  { key: 'rejected', label: 'Rejected', color: 'var(--zm-danger)' },
  { key: 'completed', label: 'Completed', color: 'var(--zm-success)' },
];

const CONFIG = {
  legal: {
    icon: 'shield',
    eyebrow: 'Legal module',
    title: 'History',
    lede: 'Every site that entered Legal, including active, approved, and rejected decisions.',
    list: listLegalHistory,
    detail: getLegalReview,
    listRoute: ROUTES.LEGAL_HISTORY,
    detailRoute: legalHistorySiteRoute,
    backLabel: 'Back to Legal history',
  },
  design: {
    icon: 'box',
    eyebrow: 'Design module',
    title: 'History',
    lede: 'Design handoffs, submitted packages, GFC decisions, and completed design folders.',
    list: listDesignHistory,
    detail: getDesignReview,
    listRoute: ROUTES.DESIGN_HISTORY,
    detailRoute: designHistorySiteRoute,
    backLabel: 'Back to Design history',
  },
  project: {
    icon: 'box',
    eyebrow: 'Project module',
    title: 'History',
    lede: 'Project allocations, budget gates, execution milestones, and completed sites.',
    list: listProjectHistory,
    detail: getProjectHistoryDetail,
    listRoute: ROUTES.PROJECT_HISTORY,
    detailRoute: projectHistorySiteRoute,
    backLabel: 'Back to Project history',
  },
  nso: {
    icon: 'home',
    eyebrow: 'NSO module',
    title: 'History',
    lede: 'New Store Opening readiness from CA handoff through launch approval.',
    list: listNsoHistory,
    detail: getNsoHistoryDetail,
    listRoute: ROUTES.NSO_HISTORY,
    detailRoute: nsoHistorySiteRoute,
    backLabel: 'Back to NSO history',
  },
};

const STATUS_COLOR = {
  approved: 'var(--zm-success)',
  complete: 'var(--zm-success)',
  completed: 'var(--zm-success)',
  done: 'var(--zm-success)',
  positive: 'var(--zm-success)',
  registered: 'var(--zm-success)',
  rejected: 'var(--zm-danger)',
  negative: 'var(--zm-danger)',
  submitted: 'var(--zm-copper)',
  pending_admin: 'var(--zm-copper)',
  pending_supervisor: 'var(--zm-copper)',
  gfc_pending: 'var(--zm-copper)',
  in_progress: 'var(--zm-accent)',
  in_review: 'var(--zm-accent)',
  allocated: 'var(--zm-accent)',
};

function pretty(value) {
  if (value == null || value === '') return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusColor(value) {
  return STATUS_COLOR[String(value || '').toLowerCase()] || 'var(--zm-fg-3)';
}

function StatusChip({ value }) {
  const color = statusColor(value);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 22,
      padding: '0 9px',
      borderRadius: 6,
      border: `1px solid ${color}`,
      color,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 10,
      fontWeight: 850,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {pretty(value)}
    </span>
  );
}

function stageStatus(stage) {
  const value = String(stage.status || '').toLowerCase();
  const done = ['yes', 'na', 'positive', 'signed', 'registered', 'complete', 'approved', 'done', 'recorded'].includes(value);
  const bad = ['no', 'negative', 'rejected'].includes(value);
  return bad ? 'rejected' : done ? 'done' : value || 'pending';
}

function StageRail({ stages }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {stages.map((stage, index) => {
        const state = stageStatus(stage);
        const color = state === 'done'
          ? 'var(--zm-success)'
          : state === 'rejected'
            ? 'var(--zm-danger)'
            : state === 'pending' ? 'var(--zm-fg-3)' : 'var(--zm-copper)';
        return (
          <div
            key={stage.id || stage.key || `${stage.label}-${index}`}
            className="zm-glass"
            style={{
              display: 'grid',
              gridTemplateColumns: '44px minmax(0, 1fr) auto',
              gap: 12,
              alignItems: 'center',
              padding: 14,
              borderRadius: 10,
              borderColor: state === 'done' ? 'rgba(47, 125, 82, 0.35)' : state === 'rejected' ? 'rgba(160, 48, 48, 0.35)' : 'var(--zm-line)',
            }}
          >
            <div style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              color,
              border: `1px solid ${color}`,
              fontFamily: 'var(--zm-font-mono)',
              fontWeight: 900,
              fontSize: 11,
            }}>
              {String(index + 1).padStart(2, '0')}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 900, color: 'var(--zm-fg)' }}>{stage.label}</div>
              {stage.detail && (
                <div style={{ marginTop: 3, color: 'var(--zm-fg-3)', fontSize: 12.5, lineHeight: 1.45 }}>
                  {stage.detail}
                </div>
              )}
            </div>
            <StatusChip value={stage.status || 'pending'} />
          </div>
        );
      })}
    </div>
  );
}

function legalStages(detail) {
  const dd = detail?.dd;
  return [
    { label: 'DDR', status: detail?.legalDdStatus || dd?.final_verdict, detail: dd?.rejection_reason || `Stage: ${pretty(dd?.stage || 'pending')}` },
    { label: 'Agreement', status: detail?.agreementStatus, detail: detail?.agreement?.registered ? 'Registered agreement on file.' : detail?.agreement?.signed ? 'Agreement executed.' : 'Awaiting agreement execution.' },
    { label: 'Licensing', status: detail?.licensingStatus, detail: detail?.licensing ? 'Licensing checklist captured.' : 'Licensing has not started.' },
    { label: 'Outcome', status: detail?.siteStatus, detail: `Current site status: ${pretty(detail?.siteStatus)}` },
  ];
}

function designStages(detail) {
  const byKind = Object.fromEntries((detail?.deliverables || []).map((d) => [d.kind, d]));
  return [
    { label: 'Recce', status: byKind.recce?.status, detail: byKind.recce?.fileName || 'No recce artifact yet.' },
    { label: '2D', status: byKind['2d']?.adminStatus === 'approved' ? 'approved' : byKind['2d']?.status, detail: byKind['2d']?.fileName || 'No 2D file yet.' },
    { label: '3D', status: byKind['3d']?.adminStatus === 'approved' ? 'approved' : byKind['3d']?.status, detail: byKind['3d']?.fileName || 'No 3D file yet.' },
    { label: 'BOQ', status: byKind.boq?.status, detail: byKind.boq?.estimatedAmount != null ? `Estimate: ₹${Number(byKind.boq.estimatedAmount).toLocaleString('en-IN')}` : 'No BOQ estimate yet.' },
    { label: 'GFC', status: detail?.gfcStatus, detail: detail?.gfcComments || `Design status: ${pretty(detail?.designStatus)}` },
  ];
}

function projectStages(detail) {
  return [
    { label: 'Allocation', status: detail?.allocatedToName ? 'approved' : 'pending', detail: detail?.allocatedToName || 'Not allocated yet.' },
    { label: 'Budget', status: detail?.budgetStatus, detail: detail?.budgetTotal != null ? `Budget total: ₹${Number(detail.budgetTotal).toLocaleString('en-IN')}` : 'Budget not submitted.' },
    { label: 'Initialization date', status: detail?.initializationStatus, detail: detail?.initializationDate || 'Not recorded.' },
    { label: 'Expected completion', status: detail?.expectedCompletionStatus, detail: detail?.expectedCompletionDate || 'Not recorded.' },
    { label: 'Inspection date', status: detail?.inspectionDate ? 'recorded' : 'pending', detail: detail?.inspectionDate || 'Not recorded.' },
    { label: 'Quality audit', status: detail?.qualityAuditStatus, detail: detail?.qualityAuditComments || 'Awaiting audit.' },
    { label: 'Final completion', status: detail?.finalCompletionDate ? 'done' : 'pending', detail: detail?.finalCompletionDate || 'Not completed.' },
  ];
}

function nsoStages(detail) {
  const triggerByKey = Object.fromEntries((detail?.triggers || []).map((item) => [item.key, item]));
  return [
    {
      label: 'CA / Payment trigger',
      status: triggerByKey.finance_ca?.unlocked ? 'done' : 'pending',
      detail: detail?.caCode ? `CA code active: ${detail.caCode}` : 'Waiting for approved Finance / CA code.',
    },
    {
      label: 'Property + communication',
      status: detail?.stageOneCompletedAt ? 'done' : 'pending',
      detail: detail?.communicationFloated == null ? 'Communication not marked yet.' : `Communication floated: ${detail.communicationFloated ? 'Yes' : 'No'}`,
    },
    {
      label: 'License status',
      status: detail?.stageTwoCompletedAt ? 'done' : 'pending',
      detail: ['FSSAI', 'Health Trade', 'Shops & Establishment', 'Fire NOC', 'Storage License']
        .map((label, index) => {
          const keys = ['fssaiStatus', 'healthTradeStatus', 'shopsEstabStatus', 'fireNocStatus', 'storageLicenseStatus'];
          return `${label}: ${pretty(detail?.[keys[index]])}`;
        })
        .join(' · '),
    },
    {
      label: 'Launch readiness',
      status: detail?.stageThreeCompletedAt ? 'done' : 'pending',
      detail: detail?.launchDate ? `Launch date: ${detail.launchDate}` : 'Awaiting Project completion and launch checklist.',
    },
    {
      label: 'Final approval',
      status: detail?.finalApprovedAt ? 'done' : 'pending',
      detail: detail?.finalApprovedAt ? 'NSO completed.' : 'Two sign-offs required before Site Launched.',
    },
  ];
}

function stagesFor(moduleKey, detail) {
  if (moduleKey === 'legal') return legalStages(detail);
  if (moduleKey === 'design') return designStages(detail);
  if (moduleKey === 'nso') return nsoStages(detail);
  return projectStages(detail);
}

function summaryFor(moduleKey, item) {
  if (moduleKey === 'legal') return [item.legalDdStatus, item.agreementStatus, item.licensingStatus];
  if (moduleKey === 'design') return [item.designStatus, item.currentStage, item.gfcStatus];
  if (moduleKey === 'nso') return [item.nsoStatus, item.currentStage, item.projectStatus];
  return [item.projectStatus, item.currentStage, item.budgetStatus];
}

export default function ModuleHistoryPage({ moduleKey, defaultFilter = 'all' }) {
  const config = CONFIG[moduleKey];
  const { siteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  useFocusSite();
  const filterParam = new URLSearchParams(location.search).get('filter');
  const [filter, setFilter] = React.useState(() => (
    FILTERS.some((item) => item.key === filterParam) ? filterParam : defaultFilter
  ));

  // Keep the active filter in sync when a deep link changes ?filter= in place
  // (e.g. navigating /legal/history?filter=rejected while already mounted).
  React.useEffect(() => {
    if (filterParam && FILTERS.some((item) => item.key === filterParam)) {
      setFilter(filterParam);
    }
  }, [filterParam]);
  const [query, setQuery] = React.useState('');
  const [detailState, setDetailState] = React.useState({ status: 'idle', detail: null, audit: [], error: null });

  // History list — "View more" batch pager. `total` is the server COUNT(*) of
  // the filtered history set; `items` are the rows loaded so far (the search box
  // narrows over the accumulated rows). Reloads whenever the status filter
  // changes (config is stable per module).
  const {
    items: listItems,
    total: listTotal,
    status: listStatus,
    error: listError,
    hasMore: listHasMore,
    loadingMore: listLoadingMore,
    loadMore: loadMoreList,
    reload: loadList,
  } = usePagedList(
    ({ limit, offset }) => config.list(filter, { limit, offset }),
    { deps: [config, filter] },
  );

  useSiteDataRefresh(loadList);

  React.useEffect(() => {
    if (!siteId) {
      setDetailState({ status: 'idle', detail: null, audit: [], error: null });
      return undefined;
    }
    let cancelled = false;
    setDetailState({ status: 'loading', detail: null, audit: [], error: null });
    Promise.allSettled([config.detail(siteId), getSiteActivity(siteId, { module: moduleKey })])
      .then(([detailRes, auditRes]) => {
        if (cancelled) return;
        if (detailRes.status === 'rejected') {
          setDetailState({
            status: 'error',
            detail: null,
            audit: [],
            error: detailRes.reason?.detail || detailRes.reason?.message || 'Could not load this history item.',
          });
          return;
        }
        const audit = auditRes.status === 'fulfilled' ? (auditRes.value?.items || []) : [];
        // Distinguish "audit fetch failed" from "genuinely no activity" — a
        // swallowed failure used to render the misleading empty-state copy.
        const auditError = auditRes.status === 'rejected'
          ? (auditRes.reason?.detail || auditRes.reason?.message || 'Audit trail unavailable.')
          : null;
        setDetailState({ status: 'ready', detail: detailRes.value, audit, auditError, error: null });
      });
    return () => { cancelled = true; };
  }, [config, siteId]);

  const filtered = listItems.filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [item.siteCode, item.caCode, item.siteName, item.city, item.submittedByName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. H"
        eyebrow={config.eyebrow}
        title={config.title}
        lede={config.lede}
        right={<HeaderTag icon={config.icon} label="READ ONLY" />}
      />

      <div className="zm-glass" style={{ padding: 16, borderRadius: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 260px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--zm-fg-3)' }}>
              <Icon name="search" size={14} />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search site, code, city, or owner..."
              style={{
                width: '100%',
                boxSizing: 'border-box', // no global reset — without this the 48px padding overflows the flex wrapper onto the pills
                height: 38,
                padding: '0 12px 0 36px',
                borderRadius: 9,
                border: '1px solid var(--zm-line)',
                background: 'var(--zm-surface)',
                fontFamily: 'var(--zm-font-body)',
              }}
            />
          </div>
          {FILTERS.map((item) => (
            <SubFilterPill
              key={item.key}
              label={item.label}
              color={item.color}
              count={item.key === filter && listStatus === 'ready' ? listTotal : undefined}
              active={filter === item.key}
              onClick={() => setFilter(item.key)}
            />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: siteId ? 'minmax(320px, 0.75fr) minmax(0, 1.25fr)' : '1fr', gap: 16 }}>
        <section className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--zm-line)' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Sites</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--zm-fg-3)', fontSize: 12.5 }}>
              {listStatus === 'loading' ? 'Loading history...' : `${filtered.length} site${filtered.length === 1 ? '' : 's'} in this view`}
            </p>
          </div>
          {listError && (
            <div style={{ padding: 16, color: 'var(--zm-danger)' }}>
              {listError}
              <button type="button" onClick={loadList} style={{ marginLeft: 12 }}>Retry</button>
            </div>
          )}
          {!listError && filtered.length === 0 && (
            <div style={{ padding: 24, color: 'var(--zm-fg-3)' }}>No history items found.</div>
          )}
          {!listError && filtered.map((item) => {
            const active = item.siteId === siteId;
            return (
              <button
                key={item.siteId}
                type="button"
                data-site-id={item.siteId}
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
                <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--zm-font-mono)', color: 'var(--zm-fg-3)', fontSize: 12 }}>{item.siteCode || 'No code'}</div>
                    <strong style={{ display: 'block', marginTop: 4, fontSize: 15 }}>{item.siteName}</strong>
                    <div style={{ marginTop: 4, color: 'var(--zm-fg-3)', fontSize: 12.5 }}>{item.city} · {item.submittedByName || 'Unassigned'}</div>
                  </div>
                  <StatusChip value={summaryFor(moduleKey, item)[0]} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {summaryFor(moduleKey, item).map((value, index) => <StatusChip key={`${value}-${index}`} value={value || 'pending'} />)}
                </div>
              </button>
            );
          })}
          {!listError && listStatus === 'ready' && (
            <div style={{ padding: '12px 16px' }}>
              <ViewMoreButton
                hasMore={listHasMore}
                loadingMore={listLoadingMore}
                loaded={listItems.length}
                total={listTotal}
                onClick={loadMoreList}
              />
            </div>
          )}
        </section>

        {siteId && (
          <section className="zm-glass" style={{ borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
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
              ← {config.backLabel}
            </button>

            {detailState.status === 'loading' && <div style={{ color: 'var(--zm-fg-3)' }}>Loading site history...</div>}
            {detailState.error && <div style={{ color: 'var(--zm-danger)' }}>{detailState.error}</div>}
            {detailState.detail && (
              <>
                <div>
                  <div style={{ fontFamily: 'var(--zm-font-mono)', color: 'var(--zm-fg-3)', fontSize: 12 }}>{detailState.detail.siteCode}</div>
                  <h2 style={{ margin: '4px 0 0', fontSize: 24 }}>{detailState.detail.siteName}</h2>
                  <p style={{ margin: '6px 0 0', color: 'var(--zm-fg-3)' }}>
                    {detailState.detail.city} · {detailState.detail.submittedByName || 'No owner name'}
                  </p>
                </div>
                <StageRail stages={stagesFor(moduleKey, detailState.detail)} />
                <div>
                  <h3 style={{ margin: '0 0 10px', fontSize: 15, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Audit trail</h3>
                  {detailState.audit.length === 0 ? (
                    <div style={{ color: detailState.auditError ? 'var(--zm-danger)' : 'var(--zm-fg-3)' }}>
                      {detailState.auditError || 'No audit activity found for this site.'}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {detailState.audit.slice(0, 18).map((entry) => {
                        const detailNote = humanizeAuditDetail(entry.detail);
                        return (
                          <div key={entry.id} style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(160px, 0.35fr) minmax(0, 1fr)',
                            gap: 12,
                            padding: '10px 0',
                            borderTop: '1px solid var(--zm-line)',
                          }}>
                            <span style={{ fontFamily: 'var(--zm-font-mono)', color: 'var(--zm-fg-3)', fontSize: 11 }}>
                              {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'No timestamp'}
                            </span>
                            <span>
                              <strong>{entry.actor || 'System'}</strong> {labelForEntry(entry)}
                              {detailNote ? <span style={{ color: 'var(--zm-fg-3)' }}> · {detailNote}</span> : null}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
