import React from 'react';
import { T, Icon, Card, Drawer, Skeleton, EmptyState, ErrorState, TABULAR } from '../ui/kit.jsx';
import SiteApprovalPanel from './SiteApprovalPanel.jsx';

// Site-centric approval queue. Every site with ANY pending approval shows once,
// with chips for what's pending. Filters narrow to a single approval type.
// Click a site → drawer with all its pending approvals (SiteApprovalPanel).
// When a site's approvals all clear, it drops off the list and the drawer closes.

const TYPE_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'design',  label: 'Design',  icon: Icon.layers },
  { key: 'payment', label: 'Payment', icon: Icon.wallet },
  { key: 'project', label: 'Budget',  icon: Icon.wrench },
];

const designCount = (s) => (s.design?.deliverables?.length || 0) + (s.design?.gfcPending ? 1 : 0);
const hasType = (s, t) => (t === 'design' ? designCount(s) > 0 : t === 'payment' ? !!s.payment : t === 'project' ? !!s.project : true);

function Chip({ icon: CIcon, label, tone }) {
  const tones = { design: [T.accentSoft, T.accentText], payment: [T.warnSoft, T.warnText], project: ['rgba(160,120,220,0.16)', '#C9A6F2'] };
  const [bg, fg] = tones[tone] || ['rgba(255,255,255,0.07)', T.textMuted];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 650, background: bg, color: fg }}>
      <CIcon size={12} />{label}
    </span>
  );
}

export default function ApprovalCenter({ data, handlers, onRetry }) {
  const [filter, setFilter] = React.useState('all');
  const [openId, setOpenId] = React.useState(null);

  const sites = data.sites || [];
  const counts = React.useMemo(() => ({
    all: sites.length,
    design: sites.filter((s) => hasType(s, 'design')).length,
    payment: sites.filter((s) => hasType(s, 'payment')).length,
    project: sites.filter((s) => hasType(s, 'project')).length,
  }), [sites]);

  const visible = filter === 'all' ? sites : sites.filter((s) => hasType(s, filter));
  const openSite = sites.find((s) => s.siteId === openId) || null;
  React.useEffect(() => { if (openId && !openSite) setOpenId(null); }, [openId, openSite]);

  if (data.status === 'error') return <ErrorState message={data.error} onRetry={onRetry} />;

  return (
    <div>
      {/* filters */}
      <div role="tablist" style={{ display: 'inline-flex', gap: 4, padding: 4, marginBottom: 18, flexWrap: 'wrap',
        background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.line}`, borderRadius: T.radiusPill }}>
        {TYPE_FILTERS.map(({ key, label, icon: FIcon }) => {
          const isActive = filter === key;
          const n = counts[key] || 0;
          return (
            <button key={key} role="tab" aria-selected={isActive} onClick={() => setFilter(key)}
              className={`ac-tab${isActive ? ' is-active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px',
                borderRadius: T.radiusPill, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 650,
                background: isActive ? '#F4F5F7' : 'transparent', color: isActive ? '#0B0C10' : T.textMuted }}>
              {FIcon && <FIcon size={14} />}{label}
              <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...TABULAR,
                background: isActive ? 'rgba(11,12,16,0.12)' : (n > 0 ? T.warnSoft : 'rgba(255,255,255,0.08)'),
                color: isActive ? '#0B0C10' : (n > 0 ? T.warnText : T.textFaint) }}>{n}</span>
            </button>
          );
        })}
      </div>

      {data.status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Card key={i} style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Skeleton w={190} h={15} /><span style={{ flex: 1 }} /><Skeleton w={70} h={22} r={999} /><Skeleton w={70} h={22} r={999} />
            </Card>
          ))}
        </div>
      )}

      {data.status === 'ready' && visible.length === 0 && (
        <EmptyState icon={Icon.check}
          title={filter === 'all' ? 'No sites awaiting approval' : `No sites with pending ${filter} approvals`}
          hint="Sites appear here the moment any department sends work up for your sign-off." />
      )}

      {data.status === 'ready' && visible.length > 0 && (
        <div className="ac-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map((s) => {
            const dCount = designCount(s);
            const total = dCount + (s.payment ? 1 : 0) + (s.project ? 1 : 0);
            return (
              <Card key={s.siteId} interactive raised onClick={() => setOpenId(s.siteId)}
                style={{ padding: '15px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textMuted }}>{s.siteCode}</span>
                    <strong style={{ fontSize: 14.5, color: T.text, letterSpacing: '-0.01em' }}>{s.siteName}</strong>
                    <span style={{ fontSize: 12, color: T.textFaint }}>{s.city}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                  {dCount > 0 && <Chip icon={Icon.layers} label={`Design · ${dCount}`} tone="design" />}
                  {s.payment && <Chip icon={Icon.wallet} label="Payment" tone="payment" />}
                  {s.project && <Chip icon={Icon.wrench} label="Budget" tone="project" />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: T.textFaint, ...TABULAR }}>{total} pending</span>
                  <Icon.caret size={16} style={{ color: T.textFaint }} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Drawer
        open={!!openSite}
        onClose={() => setOpenId(null)}
        subtitle={openSite ? `${openSite.siteCode} · ${openSite.city}` : ''}
        title={openSite ? openSite.siteName : ''}
      >
        {openSite && <SiteApprovalPanel site={openSite} handlers={handlers} />}
      </Drawer>
    </div>
  );
}
