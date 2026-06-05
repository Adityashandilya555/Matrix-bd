import React from 'react';
import { T, Icon, Card, Drawer, Skeleton, EmptyState, ErrorState, Avatar, TABULAR } from '../ui/kit.jsx';
import { MODULE_META, moduleForAction, labelForEntry, dotColor } from './historyMeta.js';

// A compilation of every site as a BD-style pipeline (LOI → Legal → Design →
// Payment → Project), coloured by each module's status. Click a site for its
// full cross-module history (the /sites/{id}/activity audit feed).

const NODES = [
  { key: 'loi', label: 'LOI' },
  { key: 'legal', label: 'Legal' },
  { key: 'design', label: 'Design' },
  { key: 'payment', label: 'Pay' },
  { key: 'project', label: 'Project' },
];

const TONE = {
  done:     { dot: T.success, ring: 'transparent', line: T.success },
  active:   { dot: T.warn, ring: 'rgba(224,162,60,0.22)', line: 'rgba(255,255,255,0.12)' },
  rejected: { dot: T.danger, ring: 'transparent', line: 'rgba(255,255,255,0.12)' },
  pending:  { dot: 'rgba(255,255,255,0.20)', ring: 'transparent', line: 'rgba(255,255,255,0.10)' },
};

const LOI_DONE = new Set(['loi_uploaded', 'legal_review', 'legal_approved', 'pushed_to_payments']);
const REJECTED = new Set(['legal_rejected', 'rejected', 'archived']);
const pick = (v, done, active, reject) =>
  (reject.includes(v) ? 'rejected' : done.includes(v) ? 'done' : active.includes(v) ? 'active' : 'pending');

function toneFor(site, key) {
  switch (key) {
    case 'loi':
      return REJECTED.has(site.status) ? 'rejected' : LOI_DONE.has(site.status) ? 'done' : 'active';
    case 'legal':
      if (['legal_approved', 'pushed_to_payments'].includes(site.status)) return 'done';
      if (site.status === 'legal_rejected' || site.legalDdStatus === 'negative') return 'rejected';
      if (site.legalDdStatus === 'positive') return site.status === 'legal_review' ? 'active' : 'done';
      if (site.legalDdStatus === 'in_review' || site.status === 'legal_review') return 'active';
      return 'pending';
    case 'design':  return pick(site.designStatus, ['approved'], ['allocated', 'in_progress', 'gfc_pending'], ['rejected']);
    case 'payment': return pick(site.financeStatus, ['approved'], ['awaiting_supervisor', 'awaiting_admin'], []);
    case 'project': return pick(site.projectStatus, ['done', 'completed'], ['allocated', 'budgeting', 'in_progress'], []);
    default: return 'pending';
  }
}

function Pipeline({ site }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
      {NODES.map((n, i) => {
        const tone = toneFor(site, n.key);
        const c = TONE[tone];
        return (
          <React.Fragment key={n.key}>
            {i > 0 && (
              <div style={{ width: 22, height: 11, display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1, height: 2, borderRadius: 2, background: TONE[toneFor(site, NODES[i - 1].key)].line }} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 52 }}>
              <span className="ac-node" style={{ width: 11, height: 11, borderRadius: 999, background: c.dot,
                boxShadow: c.ring !== 'transparent' ? `0 0 0 4px ${c.ring}` : 'none',
                border: tone === 'pending' ? `1px solid rgba(255,255,255,0.25)` : 'none' }} />
              <span style={{ fontSize: 9.5, letterSpacing: '0.02em', color: tone === 'pending' ? T.textFaint : T.textMuted,
                whiteSpace: 'nowrap' }}>{n.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── History drawer ────────────────────────────────────────────────────────────

const fmt = (d) => { try { return new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

function HistoryDrawer({ site, fetchHistory, onClose }) {
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [mod, setMod] = React.useState('all');

  React.useEffect(() => {
    if (!site) return undefined;
    let live = true;
    setState({ status: 'loading', items: [], error: null });
    setMod('all');
    fetchHistory(site.siteId)
      .then((d) => { if (live) setState({ status: 'ready', items: d.items || [], error: null }); })
      .catch((e) => { if (live) setState({ status: 'error', items: [], error: e?.detail || e?.message || 'Failed to load history' }); });
    return () => { live = false; };
  }, [site, fetchHistory]);

  const counts = React.useMemo(() => {
    const c = { all: state.items.length };
    for (const e of state.items) { const m = moduleForAction(e.action); c[m] = (c[m] || 0) + 1; }
    return c;
  }, [state.items]);

  const visible = mod === 'all' ? state.items : state.items.filter((e) => moduleForAction(e.action) === mod);
  const FILTERS = [{ key: 'all', label: 'All' }, ...Object.entries(MODULE_META).map(([k, v]) => ({ key: k, label: v.label }))];

  return (
    <Drawer open={!!site} onClose={onClose}
      subtitle={site ? `${site.siteCode} · ${site.city}` : ''} title={site ? site.siteName : ''}
      headerRight={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: T.textMuted, marginTop: 6 }}>
        <Icon.clock size={14} /> Full history</span>}>

      <div role="tablist" style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 18, flexWrap: 'wrap',
        background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.line}`, borderRadius: T.radiusPill }}>
        {FILTERS.map(({ key, label }) => {
          const active = mod === key; const n = counts[key] || 0;
          return (
            <button key={key} onClick={() => setMod(key)} className={`ac-tab${active ? ' is-active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 999,
                border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 650,
                background: active ? '#F4F5F7' : 'transparent', color: active ? '#0B0C10' : T.textMuted }}>
              {label}<span style={{ ...TABULAR, fontSize: 10.5, opacity: 0.8 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {state.status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} style={{ display: 'flex', gap: 12 }}><Skeleton w={10} h={10} r={999} /><div style={{ flex: 1 }}><Skeleton h={13} w="70%" style={{ marginBottom: 6 }} /><Skeleton h={11} w="40%" /></div></div>)}
        </div>
      )}
      {state.status === 'error' && <ErrorState message={state.error} />}
      {state.status === 'ready' && visible.length === 0 && (
        <EmptyState icon={Icon.clock} title="No history yet" hint="Activity across all modules will appear here as the site progresses." />
      )}

      {state.status === 'ready' && visible.length > 0 && (
        <div style={{ position: 'relative', paddingLeft: 6 }}>
          <div style={{ position: 'absolute', left: 11, top: 6, bottom: 6, width: 2, background: T.line }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {visible.map((e) => {
              const m = moduleForAction(e.action);
              return (
                <div key={e.id} style={{ position: 'relative', display: 'flex', gap: 14, padding: '9px 0 9px 0' }}>
                  <span style={{ width: 12, height: 12, borderRadius: 999, background: dotColor(e.action), marginLeft: 5, marginTop: 3,
                    flexShrink: 0, boxShadow: `0 0 0 4px #0E0F15`, zIndex: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                        color: MODULE_META[m].color }}>{MODULE_META[m].label}</span>
                      <span style={{ fontSize: 13, color: T.text }}>{labelForEntry(e)}</span>
                    </div>
                    <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: T.textFaint }}>
                      {e.actor && <><Avatar name={e.actor} size={18} /><span>{e.actor}</span><span>·</span></>}
                      <span style={{ ...TABULAR }}>{fmt(e.createdAt)}</span>
                    </div>
                    {e.detail && !e.detail.startsWith('kind=') && (
                      <div style={{ marginTop: 3, fontSize: 12, color: T.textMuted }}>{e.detail}</div>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function SitesTab({ data, fetchHistory, onRetry }) {
  const [query, setQuery] = React.useState('');
  const [openSite, setOpenSite] = React.useState(null);

  const sites = data.items || [];
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) => `${s.siteCode} ${s.siteName} ${s.city}`.toLowerCase().includes(q));
  }, [sites, query]);

  if (data.status === 'error') return <ErrorState message={data.error} onRetry={() => onRetry(false)} />;

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 16, maxWidth: 380 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textFaint }}><Icon.search size={16} /></span>
        <input className="ac-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites by name, code, or city"
          style={{ width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px 0 36px', borderRadius: T.radiusSm,
            border: `1px solid ${T.lineStrong}`, background: T.surfaceInset, color: T.text, fontSize: 13, outline: 'none' }} />
      </div>

      {data.status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={64} r={14} />)}
        </div>
      )}

      {data.status === 'ready' && visible.length === 0 && (
        <EmptyState icon={Icon.pin} title={query ? 'No sites match your search' : 'No sites yet'}
          hint={query ? 'Try a different name, code, or city.' : 'Sites created in BD will appear here with their full cross-module pipeline.'} />
      )}

      {data.status === 'ready' && visible.length > 0 && (
        <div className="ac-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map((s) => (
            <Card key={s.siteId} interactive raised className="ac-pipeline-row" onClick={() => setOpenSite(s)}
              style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textMuted }}>{s.siteCode}</span>
                  <strong style={{ fontSize: 14, color: T.text, letterSpacing: '-0.01em' }}>{s.siteName}</strong>
                  <span style={{ fontSize: 12, color: T.textFaint }}>{s.city}</span>
                </div>
              </div>
              <Pipeline site={s} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: T.textFaint }}>
                <Icon.clock size={14} /> History <Icon.caret size={14} />
              </span>
            </Card>
          ))}
        </div>
      )}

      <HistoryDrawer site={openSite} fetchHistory={fetchHistory} onClose={() => setOpenSite(null)} />
    </div>
  );
}
