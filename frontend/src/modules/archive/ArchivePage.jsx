import React from 'react';
import { useSites } from '../../state/SitesContext.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { usePageContext } from '../../App.jsx';
import { SiteStatus } from '../../lib/stateMachine.js';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Avatar from '../shared/primitives/Avatar.jsx';
import Icon from '../shared/primitives/Icon.jsx';

// A row is "rejected" if it was rejected in BD review or in Legal DD; anything
// else that lands here (a supervisor manually shelving a site) is "archived".
const isRejectedRow = (a) => a.status === SiteStatus.REJECTED || a.status === SiteStatus.LEGAL_REJECTED;
const isArchivedRow = (a) => a.status === SiteStatus.ARCHIVED;

function statusMeta(a) {
  if (a.status === SiteStatus.LEGAL_REJECTED) return { label: 'Legal rejected', fg: '#B42318', bg: '#FEF3F2' };
  if (a.status === SiteStatus.REJECTED) return { label: 'Rejected', fg: '#B42318', bg: '#FEF3F2' };
  return { label: 'Archived', fg: '#374151', bg: '#F1F3F6' };
}

// Render body preserved from Archive.jsx; extended with archive_note rendering
// and a Revive control (supervisor-only) wired to POST /sites/{id}/revive.

function EyeIcon({ size = 12 }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>);
}

function ReviveDialog({ site, onCancel, onConfirm, busy }) {
  const [note, setNote] = React.useState('');
  const noteId = React.useId();
  if (!site) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 520, padding: 26, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Reviving · {site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Pull this back into pipeline?</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>The site will return to the stage it was at when archived. Add an optional note for the audit trail.</p>
          </div>
          <button onClick={onCancel} className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer' }}><Icon name="x" size={14}/></button>
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

function ReasonDialog({ site, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!site) return null;
  const meta = statusMeta(site);
  const reasons = site.reasons || [];
  const hasContent = reasons.length > 0 || !!site.note;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 520, maxWidth: 'calc(100vw - 32px)', padding: 26, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>{meta.label} · {site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Reason &amp; note</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Why <strong style={{ color: 'var(--zm-fg-2)' }}>{site.name}</strong> was {isRejectedRow(site) ? 'rejected' : 'archived'}.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer' }}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {reasons.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Reasons</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {reasons.map(r => (<span key={r} style={{ padding: '4px 10px', borderRadius: 999, background: meta.bg, color: meta.fg, fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 11.5 }}>{r}</span>))}
              </div>
            </div>
          )}
          {site.note && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Note</span>
              <p style={{ margin: 0, padding: 12, background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 13, lineHeight: 1.5, color: 'var(--zm-fg-2)', whiteSpace: 'pre-wrap' }}>{site.note}</p>
            </div>
          )}
          {!hasContent && (
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>No reason or note was recorded for this site.</p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="zm-btn" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function ArchivePage({ onOpenSite: onOpenSiteProp, showToast: showToastProp }) {
  const ctx = usePageContext();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  const showToast = showToastProp || ctx.showToast;
  const { archive, reviveSite } = useSites();
  const { role } = useSession();
  const canRevive = role === 'supervisor';
  const [reviving, setReviving] = React.useState(null);
  const [viewingReason, setViewingReason] = React.useState(null);
  const [filter, setFilter] = React.useState('all'); // all | archived | rejected
  const [busy, setBusy] = React.useState(false);

  const counts = React.useMemo(() => ({
    all: archive.length,
    archived: archive.filter(isArchivedRow).length,
    rejected: archive.filter(isRejectedRow).length,
  }), [archive]);

  const filtered = React.useMemo(() => archive.filter(a => (
    filter === 'archived' ? isArchivedRow(a) : filter === 'rejected' ? isRejectedRow(a) : true
  )), [archive, filter]);

  const onReviveConfirm = async (site, note) => {
    setBusy(true);
    try {
      await reviveSite(site, note);
      setReviving(null);
      showToast?.(`Revived · ${site.name} is back in pipeline`);
    } catch (err) {
      showToast?.(err?.message || 'Could not revive site', 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Supervisors get an extra column for the Revive control. Keep the column
  // template in one place so header and rows can't drift.
  const cols = canRevive
    ? '0.85fr 1.5fr 0.9fr 1fr 0.9fr 1.4fr 90px 96px'
    : '0.9fr 1.6fr 1fr 1fr 1fr 1.4fr 90px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, height: 'calc(100vh - 152px)', minHeight: 400 }}>
      <div style={{ flexShrink: 0 }}>
        <PageHeader
          file="№ 05" eyebrow="Reference · Archived / Rejected"
          title={<>Archived <em>/ rejected</em> sites</>}
          lede={`${counts.archived} archived · ${counts.rejected} rejected`}
          right={<HeaderTag icon="folder" label={canRevive ? 'REVIVABLE' : 'READ ONLY'}/>}
        />
      </div>
      <div style={{ flexShrink: 0, display: 'flex', gap: 6, padding: 4, alignSelf: 'flex-start', background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 10 }}>
        {[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'archived', label: 'Archived', count: counts.archived },
          { key: 'rejected', label: 'Rejected', count: counts.rejected },
        ].map(t => {
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              aria-pressed={active}
              className="zm-btn"
              style={{ height: 30, padding: '0 12px', borderRadius: 7, border: active ? '1px solid var(--zm-line)' : '1px solid transparent', background: active ? 'var(--zm-surface)' : 'transparent', color: active ? 'var(--zm-fg)' : 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: active ? 'var(--zm-shadow-1)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {t.label}
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, fontWeight: 600, color: active ? 'var(--zm-fg-3)' : 'var(--zm-fg-3)', background: active ? 'var(--zm-surface-2)' : 'var(--zm-surface)', border: '1px solid var(--zm-line-faint)', borderRadius: 999, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>{t.count}</span>
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
        <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
          <span>Code</span><span>Site</span><span>City</span><span>Created by</span><span>Archived on</span><span>Status · reason</span><span/>{canRevive && <span style={{ textAlign: 'right' }}>Revive</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(a => {
            const meta = statusMeta(a);
            return (
              <div key={a.id} className="zm-row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)', paddingTop: 2 }}>{a.code}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{a.name}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>{a.id}</span></div>
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', paddingTop: 2 }}>{a.city}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2 }}><Avatar name={a.createdBy} size={20}/><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{a.createdBy}</span></div>
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg)', paddingTop: 2 }}>{a.archivedAt || '—'}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 1 }}>
                  <span style={{ padding: '3px 9px', borderRadius: 999, background: meta.bg, color: meta.fg, fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap' }}>{meta.label}</span>
                  <button onClick={() => setViewingReason(a)} className="zm-btn zm-row-cta" style={{ height: 26, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><EyeIcon size={11}/> View reason</button>
                </div>
                <button onClick={() => onOpenSite?.(a)} className="zm-btn zm-row-cta" style={{ height: 28, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', justifySelf: 'end', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><EyeIcon size={12}/> View</button>
                {canRevive && (
                  !isRejectedRow(a)
                    ? <button onClick={() => setReviving(a)} className="zm-btn-primary" style={{ height: 28, padding: '0 10px', border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff', justifySelf: 'end', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="refresh" size={12}/> Revive</button>
                    : <span />
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
              {archive.length === 0
                ? 'Nothing here yet. Rejected and archived drafts will appear here for future reference.'
                : `No ${filter} sites.`}
            </div>
          )}
        </div>
      </div>
      {reviving && <ReviveDialog site={reviving} onCancel={() => setReviving(null)} onConfirm={onReviveConfirm} busy={busy}/>}
      {viewingReason && <ReasonDialog site={viewingReason} onClose={() => setViewingReason(null)}/>}
    </div>
  );
}
