import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import SubFilterPill from '../shared/primitives/SubFilterPill.jsx';
import { useFocusSite } from '../../hooks/useFocusSite.js';
import { useSession } from '../../state/SessionContext.jsx';
import { getLegalQueue } from '../../services/api/legalApi.js';
import { listLegalDelegationsForSite } from '../../services/api/legalDelegationApi.js';
import { legalSiteAgreementRoute, legalSiteDdrRoute, legalSiteLicensingRoute } from '../../router/routes.js';
import { agreementAllowsLicensing, normalizeAgreementStatus } from '../../lib/agreementStatus.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { keyActivate } from '../../lib/a11y.js';

const STATUS_LABELS = {
  pending:   { label: 'Awaiting review',    tone: 'var(--zm-fg-3)' },
  in_review: { label: 'In review',           tone: 'var(--zm-accent)' },
  positive:  { label: 'DD positive',         tone: 'var(--zm-success)' },
  negative:  { label: 'DD negative',         tone: 'var(--zm-danger)' },
};

// Stage badge surfaces the checklist staging gate (U3) — drives supervisor
// awareness that an executive has submitted a draft for review.
const STAGE_LABELS = {
  draft:          { label: 'Draft',          tone: 'var(--zm-fg-3)' },
  pending_review: { label: 'Pending review', tone: 'var(--zm-warning, #E0A659)' },
  published:      null, // don't render anything in the steady state
};

function StatusPill({ value }) {
  const meta = STATUS_LABELS[value] || { label: value || 'unknown', tone: 'var(--zm-fg-3)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${meta.tone}`, color: meta.tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }}>
      {meta.label}
    </span>
  );
}

function StagePill({ value }) {
  const meta = STAGE_LABELS[value];
  if (!meta) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
      borderRadius: 4, border: `1px solid ${meta.tone}`, color: meta.tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
      letterSpacing: '0.14em', textTransform: 'uppercase',
      background: 'transparent',
    }}>
      {meta.label}
    </span>
  );
}

const DD_FILTERS = ['pending', 'in_review', 'positive', 'negative'];

const FILTER_PILLS = {
  pending:   { label: 'DD Pending', color: 'var(--zm-fg-3)' },
  in_review: { label: 'In review',  color: 'var(--zm-accent)' },
  positive:  { label: 'Positive',   color: 'var(--zm-success)' },
  negative:  { label: 'Negative',   color: 'var(--zm-danger)' },
};

export default function LegalQueuePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  useFocusSite();
  // Optional ?filter= deep link (HashRouter — query lives inside the hash, so
  // read it from react-router's location, never window.location.search).
  const filterParam = new URLSearchParams(location.search).get('filter');
  const [ddFilter, setDdFilter] = React.useState(() => (
    DD_FILTERS.includes(filterParam) ? filterParam : 'all'
  ));
  // Re-apply when an in-page navigation changes the param (no remount on
  // same-route navigations).
  React.useEffect(() => {
    if (DD_FILTERS.includes(filterParam)) setDdFilter(filterParam);
  }, [filterParam]);
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
  // siteId -> delegate name string (supervisor view only)
  const [delegateNames, setDelegateNames] = React.useState({});

  const load = React.useCallback(() => {
    let cancelled = false;
    // Keep previously loaded rows visible during background refreshes —
    // wiping them blanked the table on every tab refocus.
    setState((s) => ({ ...s, status: s.items.length ? s.status : 'loading', error: null }));
    getLegalQueue()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        // A failed background refresh must not destroy good data — keep the
        // stale rows and surface the error as a banner.
        setState((s) => ({
          ...s,
          status: s.items.length ? 'ready' : 'error',
          error: err?.detail || err?.message || 'Failed to load legal queue',
        }));
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load);

  // Supervisor view: best-effort hydration of delegate names per visible row.
  // Failures degrade silently — the row just won't show a delegated badge.
  // Keyed on a stable id signature (state.items is a new array identity on
  // every refresh) and skips already-hydrated ids, so a tab refocus doesn't
  // re-issue N delegation requests for unchanged rows.
  const itemIdKey = state.items.map((r) => r.siteId).join('|');
  const delegateNamesRef = React.useRef(delegateNames);
  delegateNamesRef.current = delegateNames;
  React.useEffect(() => {
    if (!isSupervisor || !itemIdKey) return;
    const pendingIds = itemIdKey.split('|').filter((id) => !(id in delegateNamesRef.current));
    if (pendingIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      await Promise.all(pendingIds.map(async (siteId) => {
        try {
          const r = await listLegalDelegationsForSite(siteId);
          // Cache negative results too (null) so unchanged rows are never re-queried.
          updates[siteId] = r.items?.length
            ? (r.items[0].delegateName || r.items[0].delegateEmail)
            : null;
        } catch { /* silent */ }
      }));
      if (!cancelled && Object.keys(updates).length) {
        setDelegateNames((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [isSupervisor, itemIdKey]);

  const open = (row) => {
    const agreementStatus = normalizeAgreementStatus(row.agreementStatus);
    const target = row.legalDdStatus !== 'positive'
      ? legalSiteDdrRoute(row.siteId)
      : agreementAllowsLicensing(agreementStatus)
        ? legalSiteLicensingRoute(row.siteId)
        : legalSiteAgreementRoute(row.siteId);
    navigate(target);
  };

  const actionLabel = (row) => {
    if (row.legalDdStatus !== 'positive') return 'Open DDR';
    return agreementAllowsLicensing(row.agreementStatus) ? 'Open licensing' : 'Open agreement';
  };

  const filterCounts = React.useMemo(() => {
    const counts = { pending: 0, in_review: 0, positive: 0, negative: 0 };
    for (const row of state.items) {
      if (counts[row.legalDdStatus] != null) counts[row.legalDdStatus] += 1;
    }
    return counts;
  }, [state.items]);

  const visibleItems = ddFilter === 'all'
    ? state.items
    : state.items.filter((row) => row.legalDdStatus === ddFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 05"
        eyebrow="Legal module"
        title="Sites"
        right={<HeaderTag icon="shield" label="LEGAL_REVIEW"/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading queue…
        </div>
      )}

      {/* Error banner — also shown above stale rows when a background
          refresh fails (status stays 'ready' so the table survives). */}
      {state.error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="shield" size={20}/>
          <p style={{ margin: '12px 0 0' }}>No sites are awaiting legal review right now.</p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {DD_FILTERS.map((status) => (
            <SubFilterPill
              key={status}
              label={FILTER_PILLS[status].label}
              count={filterCounts[status]}
              color={FILTER_PILLS[status].color}
              active={ddFilter === status}
              onClick={() => setDdFilter((f) => (f === status ? 'all' : status))}
            />
          ))}
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px 140px',
            gap: 12, padding: '12px 16px',
            background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Site</span>
            <span>City</span>
            <span>DD status</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          {visibleItems.map((row) => (
            <div
              key={row.siteId}
              data-site-id={row.siteId}
              className="zm-row"
              role="button"
              tabIndex={0}
              onClick={() => open(row)}
              onKeyDown={keyActivate(() => open(row))}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(220px, 1fr) 140px 160px 140px',
                gap: 12, padding: '14px 16px',
                borderBottom: '1px solid var(--zm-line-faint)', cursor: 'pointer',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                {row.siteCode}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 700, color: 'var(--zm-fg)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{row.siteName}</span>
                  {isSupervisor && delegateNames[row.siteId] && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      height: 18, padding: '0 8px', borderRadius: 4,
                      border: '1px solid var(--zm-accent)', color: 'var(--zm-accent)',
                      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
                      letterSpacing: '0.12em', textTransform: 'uppercase',
                    }}>
                      Delegated · {delegateNames[row.siteId]}
                    </span>
                  )}
                </span>
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>
                {row.city}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <StatusPill value={row.legalDdStatus}/>
                <StagePill value={row.ddStage}/>
              </span>
              <button
                type="button"
                className="zm-btn-primary"
                onClick={(e) => { e.stopPropagation(); open(row); }}
                style={{
                  justifySelf: 'end',
                  height: 32, padding: '0 14px',
                  border: 'none', borderRadius: 7,
                  background: 'var(--zm-accent)', color: '#fff',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {actionLabel(row)}
                <Icon name="arrow-right" size={12}/>
              </button>
            </div>
          ))}
          {visibleItems.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
              No sites match this DD status filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
