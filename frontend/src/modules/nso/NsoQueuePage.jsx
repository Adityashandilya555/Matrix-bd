import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { getNsoQueue } from '../../services/api/nsoApi.js';
import { nsoSiteRoute } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

const STATUS_LABELS = {
  pending: 'Pending',
  stage_one: 'Property',
  stage_two: 'Licenses',
  stage_three: 'Launch',
  final_review: 'Final review',
  complete: 'Complete',
};

function pretty(value) {
  if (value == null || value === '') return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function StatusPill({ value, tone = 'var(--zm-accent)' }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 22,
      padding: '0 10px',
      borderRadius: 4,
      border: `1px solid ${tone}`,
      color: tone,
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 800,
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {pretty(value)}
    </span>
  );
}

function metricCard(label, value, detail, icon, tone = 'var(--zm-accent)') {
  return (
    <div className="zm-glass" style={{
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: 16,
      borderRadius: 12,
    }}>
      <span style={{
        width: 36,
        height: 36,
        borderRadius: 9,
        display: 'grid',
        placeItems: 'center',
        color: tone,
        background: 'var(--zm-surface-2)',
        border: '1px solid var(--zm-line)',
      }}>
        <Icon name={icon} size={17}/>
      </span>
      <span>
        <strong style={{
          display: 'block',
          fontFamily: 'var(--zm-font-mono)',
          fontSize: 24,
          lineHeight: 1,
          color: 'var(--zm-fg)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {String(value).padStart(2, '0')}
        </strong>
        <span style={{
          display: 'block',
          marginTop: 4,
          color: 'var(--zm-fg)',
          fontWeight: 850,
          fontSize: 12.5,
        }}>
          {label}
        </span>
        <span style={{
          display: 'block',
          marginTop: 2,
          color: 'var(--zm-fg-3)',
          fontSize: 12,
        }}>
          {detail}
        </span>
      </span>
    </div>
  );
}

export default function NsoQueuePage() {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', items: [], total: 0, error: null });

  const load = React.useCallback(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    getNsoQueue()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items, total: data.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: 'error',
            items: [],
            total: 0,
            error: err?.detail || err?.message || 'Failed to load NSO queue',
          });
        }
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(load, { sources: ['nso', 'project', 'businessAdmin', 'payment', 'siteTrackerApi'] });

  const open = (row) => navigate(nsoSiteRoute(row.siteId));
  const stageOne = state.items.filter((item) => item.currentStage === 'stage_one').length;
  const stageTwo = state.items.filter((item) => item.currentStage === 'stage_two').length;
  const stageThree = state.items.filter((item) => item.currentStage === 'stage_three').length;
  const complete = state.items.filter((item) => item.nsoStatus === 'complete').length;
  const COLS = '120px minmax(220px, 1fr) 130px 150px 150px 160px 110px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow="NSO module"
        title="Sites"
        lede="Finance-approved openings move through property readiness, licenses, launch checks, and final sign-off."
        right={<HeaderTag icon="home" label="OPENING READINESS"/>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        {metricCard('In NSO', state.total, 'Finance / CA ready', 'home')}
        {metricCard('Property', stageOne, 'Stage 1 open', 'file', 'var(--zm-accent)')}
        {metricCard('Licenses / launch', stageTwo + stageThree, 'Active downstream checks', 'shield', 'var(--zm-copper)')}
        {metricCard('Completed', complete, 'Final sign-off done', 'check', 'var(--zm-success)')}
      </div>

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading NSO queue...
        </div>
      )}

      {state.status === 'error' && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          <Icon name="home" size={22}/>
          <p style={{ margin: '12px 0 0' }}>
            No Finance / CA approved sites have reached NSO yet.
          </p>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            gap: 12,
            padding: '12px 16px',
            background: 'var(--zm-surface-2)',
            borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)',
            fontWeight: 800,
            fontSize: 10.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--zm-fg-3)',
          }}>
            <span>Code</span>
            <span>Site</span>
            <span>City</span>
            <span>CA code</span>
            <span>Project</span>
            <span>NSO stage</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>

          {state.items.map((row) => (
            <div
              key={row.siteId}
              onClick={() => open(row)}
              style={{
                display: 'grid',
                gridTemplateColumns: COLS,
                gap: 12,
                padding: '14px 16px',
                borderBottom: '1px solid var(--zm-line-faint)',
                cursor: 'pointer',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--zm-surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg-2)' }}>
                {row.siteCode}
              </span>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 800, color: 'var(--zm-fg)' }}>
                {row.siteName}
                <span style={{ display: 'block', marginTop: 3, color: 'var(--zm-fg-3)', fontWeight: 600, fontSize: 12 }}>
                  {row.nextAction}
                </span>
              </span>
              <span style={{ color: 'var(--zm-fg-2)' }}>{row.city}</span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', color: 'var(--zm-fg)' }}>{row.caCode || '—'}</span>
              <StatusPill value={row.projectStatus} tone={row.projectStatus === 'done' ? 'var(--zm-success)' : 'var(--zm-copper)'}/>
              <StatusPill value={STATUS_LABELS[row.currentStage] || row.currentStage} tone={row.nsoStatus === 'complete' ? 'var(--zm-success)' : 'var(--zm-accent)'}/>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open(row); }}
                style={{
                  justifySelf: 'end',
                  height: 32,
                  padding: '0 14px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'var(--zm-accent)',
                  color: '#fff',
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Open<Icon name="arrow" size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
