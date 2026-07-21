import React from 'react';
import { T, Icon, Card, Drawer, Skeleton, EmptyState, ErrorState, Avatar, TABULAR } from '../ui/kit.jsx';
import { MODULE_META, moduleForAction, labelForEntry, dotColor } from './historyMeta.js';
import { humanizeAuditDetail } from '../../../services/api/audit.js';
import { getAdminSiteDocuments } from '../../../services/api/businessAdminApi.js';
import { reviveSite } from '../../../services/api/adapters/httpAdapter.js';
import { usePageContext } from '../../../App.jsx';
// Every site rendered as a BD-style pipeline card (LOI → Legal → CA → Design →
// Excellence → Project → NSO → Launch), each node coloured + labelled by that
// module's status. Click a site for its full cross-module history (the
// /sites/{id}/activity audit feed) and uploaded documents.

function ReviveDialog({ site, onCancel, onConfirm, busy }) {
  const [note, setNote] = React.useState('');
  const noteId = React.useId();
  if (!site) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 520, padding: 26, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Reviving · {site.siteCode || site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Pull this back into pipeline?</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>The site will return to the active pipeline. Add an optional note for the audit trail.</p>
          </div>
          <button onClick={onCancel} className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer' }}><Icon.x size={14}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor={noteId} style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' }}>Revive note <span style={{ color: 'var(--zm-fg-3)', fontWeight: 500 }}>(optional)</span></label>
          <textarea id={noteId} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. landlord called back with revised rent…" style={{ width: '100%', minHeight: 80, padding: 10, resize: 'vertical', border: '1px solid var(--zm-line)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none', background: 'var(--zm-bg)' }}/>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={busy} className="zm-btn" style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={() => onConfirm(site, note.trim())} disabled={busy} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'Reviving…' : 'Revive site'}</button>
        </div>
      </div>
    </div>
  );
}

// Pipeline nodes mirror the BD supervisor process-flow cards (icon + stage +
// status label) so the admin reads the same visual language end-to-end:
// LOI → Legal → CA → Design → Excellence → Project → NSO → Launch.
const NODES = [
  { key: 'loi',        short: 'LOI',        label: 'BD LOI Signed',        icon: 'doc' },
  { key: 'legal',      short: 'Legal',      label: 'Legal & Compliance',   icon: 'shield' },
  { key: 'payment',    short: 'CA Code',    label: 'CA / Commercial Code', icon: 'rupee' },
  { key: 'design',     short: 'Design',     label: 'Design / Technical',   icon: 'grid' },
  { key: 'excellence', short: 'Excellence', label: 'Project Excellence',   icon: 'trend' },
  { key: 'project',    short: 'Project',    label: 'Project Execution',    icon: 'box' },
  { key: 'nso',        short: 'NSO',        label: 'NSO',                  icon: 'home' },
  { key: 'launch',     short: 'Launch',     label: 'Site Launched',        icon: 'flag' },
];

// Theme-safe alpha over the zm-* custom properties (works in both portal themes).
const cm = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const NODE_TONES = {
  done:     { color: T.success,   bg: T.successSoft, borderPct: 55 },
  active:   { color: T.warn,      bg: T.warnSoft,    borderPct: 60 },
  rejected: { color: T.danger,    bg: T.dangerSoft,  borderPct: 60 },
  pending:  { color: T.textFaint, bg: 'transparent', borderPct: 0 },
};

const LOI_DONE = new Set(['loi_uploaded', 'legal_review', 'legal_approved', 'pushed_to_payments']);
const REJECTED = new Set(['legal_rejected', 'rejected', 'archived']);
const pick = (v, done, active, reject) =>
  (reject.includes(v) ? 'rejected' : done.includes(v) ? 'done' : active.includes(v) ? 'active' : 'pending');

// ── Site lifecycle classification (single source of truth) ──────────────────
// Exported so the TeamDashboard "Completed sites" KPI tile counts sites with the
// EXACT same rule the "Completed" tab filters by — otherwise the tile and the
// tab report different numbers for the same set.
export function isSiteRejected(s) {
  if (REJECTED.has(s.status)) return true;
  if (s.status === 'legal_rejected' || s.legalDdStatus === 'negative') return true;
  if (s.designStatus === 'rejected') return true;
  return false;
}

export function isSiteCompleted(s) {
  return s.isLaunched || s.launchStatus === 'launched' || s.status === 'launched';
}

export function isSiteLaunching(s) {
  return s.nsoStatus === 'complete' && !isSiteCompleted(s) && !isSiteRejected(s);
}

export function isSiteActive(s) {
  return !isSiteRejected(s) && !isSiteCompleted(s) && !isSiteLaunching(s);
}

// Bucket a list of sites into the four tab counts. Rejected wins over completed
// wins over launching (first match in this order), mirroring the tab filters.
export function classifyCounts(sites) {
  const c = { active: 0, launching: 0, completed: 0, rejected: 0 };
  for (const s of sites) {
    if (isSiteRejected(s)) c.rejected++;
    else if (isSiteCompleted(s)) c.completed++;
    else if (isSiteLaunching(s)) c.launching++;
    else c.active++;
  }
  return c;
}

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
    case 'excellence':
      // Budgeting (post-GFC). Same approximation as the BD supervisor tracker:
      // opens once design is approved, cleared once execution is done.
      if (['done', 'completed'].includes(site.projectStatus)) return 'done';
      return site.designStatus === 'approved' ? 'active' : 'pending';
    case 'project': return pick(site.projectStatus, ['done', 'completed'], ['allocated', 'budgeting', 'in_progress'], []);
    case 'nso':     return pick(site.nsoStatus, ['complete'], ['pending', 'in_progress'], []);
    case 'launch':
      if (site.isLaunched || site.launchStatus === 'launched') return 'done';
      return site.nsoStatus === 'complete' ? 'active' : 'pending';
    default: return 'pending';
  }
}

function PipelineNode({ site, node }) {
  let tone = toneFor(site, node.key);
  if (isSiteRejected(site)) {
    tone = 'rejected';
  }
  const c = NODE_TONES[tone];
  const NodeIcon = Icon[node.icon] || Icon.doc;
  const statusLabel =
    tone === 'done' ? (node.key === 'loi' ? 'Done' : 'Complete')
      : tone === 'active' ? (node.key === 'legal' ? 'Open' : 'Pending')
        : tone === 'rejected' ? 'Rejected'
          : 'Queued';
  return (
    <div
      className={`ac-node${tone === 'active' ? ' ac-node-active' : ''}`}
      title={`${node.label}: ${statusLabel}`}
      style={{
        minWidth: 142, height: 74, padding: '10px 12px', borderRadius: 12, boxSizing: 'border-box',
        border: `1px solid ${tone === 'pending' ? T.line : cm(c.color, c.borderPct)}`,
        background: c.bg,
        opacity: tone === 'pending' ? 0.72 : 1,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, maxWidth: '100%' }}>
        <span style={{ color: tone === 'pending' ? T.textFaint : c.color, display: 'inline-flex', flexShrink: 0 }}>
          <NodeIcon size={14} />
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
          color: tone === 'pending' ? T.textFaint : T.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.short}
        </span>
      </span>
      <span style={{ maxWidth: '100%', fontSize: 11.5, fontWeight: 650, lineHeight: 1.2,
        color: tone === 'pending' ? T.textFaint : T.textMuted,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {node.label}
      </span>
      <span style={{ fontFamily: T.mono, fontSize: 9.5, letterSpacing: '0.07em', textTransform: 'uppercase',
        color: tone === 'pending' ? T.textFaint : c.color }}>
        {statusLabel}
      </span>
    </div>
  );
}

function Pipeline({ site }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', minWidth: '100%' }}>
      {NODES.map((n, i) => {
        const prevDone = i > 0 && toneFor(site, NODES[i - 1].key) === 'done';
        return (
          <React.Fragment key={n.key}>
            {i > 0 && (
              <span aria-hidden="true" style={{ flex: '0 0 18px', height: 2, borderRadius: 999,
                background: prevDone ? T.success : (isSiteRejected(site) ? cm(T.danger, 25) : T.line), opacity: prevDone ? 0.6 : 1 }} />
            )}
            <PipelineNode site={site} node={n} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// One-line narrative for the row header: where the site currently sits.
function stageNarrative(site) {
  const rejected = NODES.find((n) => toneFor(site, n.key) === 'rejected');
  if (rejected) return `Rejected at ${rejected.label}`;
  const active = NODES.find((n) => toneFor(site, n.key) === 'active');
  if (active) return `At ${active.label}`;
  if (NODES.every((n) => toneFor(site, n.key) === 'done')) return 'Launched';
  return null;
}

// ── History drawer ────────────────────────────────────────────────────────────

const fmt = (d) => { try { return new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const fmtDay = (d) => { try { return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };
const fmtTime = (d) => { try { return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// All documents uploaded across the site lifecycle (LOI, photos, quality-audit,
// design deliverables) — available even after the site is closed, so the admin
// can review the paperwork later.
function DocumentsSection({ siteId }) {
  const [st, setSt] = React.useState({ status: 'loading', docs: [], error: null });

  React.useEffect(() => {
    if (!siteId) return undefined;
    let live = true;
    setSt({ status: 'loading', docs: [], error: null });
    getAdminSiteDocuments(siteId)
      .then((d) => { if (live) setSt({ status: 'ready', docs: d.documents || [], error: null }); })
      .catch((e) => { if (live) setSt({ status: 'error', docs: [], error: e?.detail || e?.message || 'Failed to load documents' }); });
    return () => { live = false; };
  }, [siteId]);

  return (
    <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${T.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon.doc size={14} />
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted }}>
          Documents{st.status === 'ready' ? ` · ${st.docs.length}` : ''}
        </span>
      </div>
      {st.status === 'loading' && <Skeleton h={40} r={10} />}
      {st.status === 'error' && <ErrorState message={st.error} />}
      {st.status === 'ready' && st.docs.length === 0 && (
        <div style={{ fontSize: 12, color: T.textFaint, padding: '2px 0' }}>No documents uploaded for this site.</div>
      )}
      {st.status === 'ready' && st.docs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {st.docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              border: `1px solid ${T.line}`, borderRadius: T.radiusSm, background: T.surfaceInset }}>
              <Icon.doc size={15} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {d.fileName}
                </div>
                <div style={{ fontSize: 10.5, color: T.textFaint, ...TABULAR }}>
                  {d.module} · {d.fileType}{d.uploadedAt ? ` · ${fmt(d.uploadedAt)}` : ''}
                </div>
              </div>
              {d.url
                ? <a href={d.url} target="_blank" rel="noopener noreferrer"
                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5,
                      fontWeight: 650, color: T.accent, textDecoration: 'none' }}>
                    Open <Icon.external size={12} />
                  </a>
                : <span style={{ flexShrink: 0, fontSize: 11, color: T.textFaint }}>—</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

      {site && <DocumentsSection siteId={site.siteId} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon.clock size={14} />
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted }}>
          Timeline{state.status === 'ready' ? ` · ${state.items.length}` : ''}
        </span>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 18, flexWrap: 'wrap',
        background: T.chip, border: `1px solid ${T.line}`, borderRadius: T.radiusPill }}>
        {FILTERS.map(({ key, label }) => {
          const active = mod === key; const n = counts[key] || 0;
          return (
            <button key={key} onClick={() => setMod(key)} className={`ac-tab${active ? ' is-active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 999,
                border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 650,
                background: active ? T.invBg : 'transparent', color: active ? T.invText : T.textMuted }}>
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

      {state.status === 'ready' && visible.length > 0 && (() => {
        // Group by calendar day so long histories stay scannable; each entry
        // keeps a ring marker + module pill on a shared rail.
        const groups = [];
        for (const e of visible) {
          const day = fmtDay(e.createdAt);
          const last = groups[groups.length - 1];
          if (!last || last.day !== day) groups.push({ day, items: [e] });
          else last.items.push(e);
        }
        return (
          <div style={{ position: 'relative', paddingLeft: 6 }}>
            <div style={{ position: 'absolute', left: 11, top: 12, bottom: 12, width: 2, borderRadius: 2, background: T.line }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {groups.map((g) => (
                <div key={g.day}>
                  <div style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center',
                    margin: '6px 0 4px', padding: '3px 10px', borderRadius: 999, border: `1px solid ${T.line}`,
                    background: T.chip, boxShadow: `0 0 0 4px ${T.drawerBg}`, fontSize: 9.5, fontWeight: 750,
                    letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted, ...TABULAR }}>
                    {g.day}
                  </div>
                  {g.items.map((e) => {
                    const m = moduleForAction(e.action);
                    const mColor = MODULE_META[m].color;
                    const detailNote = humanizeAuditDetail(e.detail);
                    return (
                      <div key={e.id} style={{ position: 'relative', display: 'flex', gap: 14, padding: '9px 0' }}>
                        <span style={{ width: 12, height: 12, borderRadius: 999, marginLeft: 5, marginTop: 3, flexShrink: 0,
                          background: T.drawerBg, border: `2.5px solid ${dotColor(e.action)}`, boxSizing: 'border-box',
                          boxShadow: `0 0 0 4px ${T.drawerBg}`, zIndex: 1 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
                              color: mColor, background: cm(mColor, 13), border: `1px solid ${cm(mColor, 32)}`,
                              padding: '2px 8px', borderRadius: 999 }}>{MODULE_META[m].label}</span>
                            <span style={{ fontSize: 13, color: T.text }}>{labelForEntry(e)}</span>
                          </div>
                          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: T.textFaint }}>
                            {e.actor && <><Avatar name={e.actor} size={17} /><span>{e.actor}</span><span aria-hidden="true">·</span></>}
                            <span style={{ ...TABULAR }}>{fmtTime(e.createdAt)}</span>
                          </div>
                          {detailNote && (
                            <div style={{ marginTop: 6, padding: '7px 10px', borderLeft: `2px solid ${cm(mColor, 45)}`,
                              borderRadius: '4px 10px 10px 4px', background: T.surfaceInset, fontSize: 12,
                              lineHeight: 1.45, color: T.textMuted, wordBreak: 'break-word' }}>{detailNote}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </Drawer>
  );
}

export default function SitesTab({ data, fetchHistory, onRetry, filter: filterProp, onFilterChange }) {
  // Filter is controllable by the parent (so the "Completed sites" KPI tile can
  // deep-link to the Completed tab) but falls back to internal state when used
  // standalone. 'active' | 'launching' | 'completed' | 'rejected'.
  const [filterState, setFilterState] = React.useState('active');
  const filter = filterProp ?? filterState;
  const setFilter = onFilterChange ?? setFilterState;
  const [query, setQuery] = React.useState('');
  const [openSite, setOpenSite] = React.useState(null);

  const [reviving, setReviving] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const { showToast } = usePageContext() || {};

  const sites = data.items || [];

  const counts = React.useMemo(() => classifyCounts(sites), [sites]);

  const visible = React.useMemo(() => {
    let filtered = sites.filter((s) => {
      if (filter === 'rejected') return isSiteRejected(s);
      if (filter === 'completed') return isSiteCompleted(s) && !isSiteRejected(s);
      if (filter === 'launching') return isSiteLaunching(s);
      return isSiteActive(s);
    });
    const q = query.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((s) => `${s.siteCode} ${s.siteName} ${s.city}`.toLowerCase().includes(q));
    }
    return filtered;
  }, [sites, filter, query]);

  const onReviveConfirm = async (site, note) => {
    setBusy(true);
    try {
      await reviveSite(site.siteId, note);
      setReviving(null);
      showToast?.(`Revived · ${site.siteName} is back in pipeline`);
      onRetry?.(true); // reload sites
    } catch (err) {
      showToast?.(err?.message || 'Could not revive site', 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (data.status === 'error') return <ErrorState message={data.error} onRetry={() => onRetry(false)} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div role="tablist" style={{ display: 'inline-flex', gap: 4, padding: 4, background: T.chip, border: `1px solid ${T.line}`, borderRadius: T.radiusPill }}>
          {['active', 'launching', 'completed', 'rejected'].map((key) => {
            const isActive = filter === key;
            const label = key === 'active' ? 'Active' : key === 'launching' ? 'Launching' : key === 'completed' ? 'Completed' : 'Rejected';
            const n = counts[key] || 0;
            return (
              <button key={key} role="tab" aria-selected={isActive} onClick={() => setFilter(key)}
                className={`ac-tab${isActive ? ' is-active' : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px',
                  borderRadius: T.radiusPill, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 650,
                  background: isActive ? T.invBg : 'transparent', color: isActive ? T.invText : T.textMuted }}>
                {label}
                <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...TABULAR,
                  background: isActive ? T.invSoft : (n > 0 ? T.warnSoft : T.chip),
                  color: isActive ? T.invText : (n > 0 ? T.warnText : T.textFaint) }}>{n}</span>
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative', flex: 1, maxWidth: 380 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textFaint }}><Icon.search size={16} /></span>
          <input className="ac-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites by name, code, or city"
            style={{ width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px 0 36px', borderRadius: T.radiusSm,
              border: `1px solid ${T.lineStrong}`, background: T.surfaceInset, color: T.text, fontSize: 13, outline: 'none' }} />
        </div>
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
        <div className="ac-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visible.map((s) => {
            const narrative = stageNarrative(s);
            return (
              <Card key={s.siteId} interactive raised className="ac-pipeline-row" role="button" tabIndex={0}
                onClick={() => setOpenSite(s)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenSite(s); } }}
                style={{ 
                  padding: 0, 
                  overflow: 'hidden', 
                  cursor: 'pointer',
                  ...(isSiteRejected(s) ? { background: cm(T.danger, 10), border: `1px solid ${cm(T.danger, 30)}` } : {})
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px 2px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10.5, letterSpacing: '0.06em', color: isSiteRejected(s) ? T.danger : T.textMuted,
                    padding: '2px 7px', borderRadius: 5, border: `1px solid ${isSiteRejected(s) ? cm(T.danger, 25) : T.line}`, background: isSiteRejected(s) ? cm(T.danger, 8) : T.chip }}>
                    {s.siteCode || '—'}
                  </span>
                  <strong style={{ fontSize: 15, fontWeight: 750, color: T.text, letterSpacing: '-0.01em' }}>{s.siteName}</strong>
                  <span style={{ fontSize: 12, color: T.textFaint }}>
                    {s.city}{narrative ? ` · ${narrative}` : ''}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {filter === 'rejected' && (
                      <button onClick={(e) => { e.stopPropagation(); setReviving(s); }} className="zm-btn-danger"
                        style={{ height: 28, padding: '0 10px', border: 'none', borderRadius: 7, background: T.danger,
                          color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon.refresh size={12}/> Revive
                      </button>
                    )}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px',
                      borderRadius: 999, border: `1px solid ${isSiteRejected(s) ? cm(T.danger, 25) : T.line}`, background: isSiteRejected(s) ? cm(T.danger, 8) : T.chip,
                      fontSize: 11.5, fontWeight: 650, color: isSiteRejected(s) ? T.danger : T.textMuted }}>
                      <Icon.clock size={13} /> History <Icon.caret size={13} />
                    </span>
                  </span>
                </div>
                <div style={{ minWidth: 0, overflowX: 'auto', padding: '10px 16px 14px' }}>
                  <Pipeline site={s} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <HistoryDrawer site={openSite} fetchHistory={fetchHistory} onClose={() => setOpenSite(null)} />
      {reviving && <ReviveDialog site={reviving} onCancel={() => setReviving(null)} onConfirm={onReviveConfirm} busy={busy}/>}
    </div>
  );
}
