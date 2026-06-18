import React from 'react';
import { useSites } from '../../state/SitesContext.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { usePageContext } from '../../App.jsx';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Avatar from '../shared/primitives/Avatar.jsx';
import Icon from '../shared/primitives/Icon.jsx';

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

export default function ArchivePage({ onOpenSite: onOpenSiteProp, showToast: showToastProp }) {
  const ctx = usePageContext();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  const showToast = showToastProp || ctx.showToast;
  const { archive, reviveSite } = useSites();
  const { role } = useSession();
  const canRevive = role === 'supervisor';
  const [reviving, setReviving] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="№ 05" eyebrow="Reference · Archive"
        title={<>Archived <em>sites</em></>}
        lede={`${archive.length} archived site${archive.length === 1 ? '' : 's'}`}
        right={<HeaderTag icon="folder" label={canRevive ? 'REVIVABLE' : 'READ ONLY'}/>}
      />
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
          <span>Code</span><span>Site</span><span>City</span><span>Created by</span><span>Archived on</span><span>Reason / note</span><span/>{canRevive && <span style={{ textAlign: 'right' }}>Revive</span>}
        </div>
        {archive.map(a => {
          const hasReasons = (a.reasons || []).length > 0;
          return (
            <div key={a.id} className="zm-row" style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)', paddingTop: 2 }}>{a.code}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{a.name}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>{a.id}</span></div>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', paddingTop: 2 }}>{a.city}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2 }}><Avatar name={a.createdBy} size={20}/><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{a.createdBy}</span></div>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12, color: 'var(--zm-fg)', paddingTop: 2 }}>{a.archivedAt || '—'}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {hasReasons && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {a.reasons.map(r => (<span key={r} style={{ padding: '2px 8px', borderRadius: 999, background: '#F1F3F6', color: '#374151', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, whiteSpace: 'nowrap' }}>{r}</span>))}
                  </div>
                )}
                {a.note && (
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)', lineHeight: 1.45 }}>{a.note}</span>
                )}
                {!hasReasons && !a.note && (<span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>—</span>)}
              </div>
              <button onClick={() => onOpenSite?.(a)} className="zm-btn zm-row-cta" style={{ height: 28, padding: '0 10px', border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', justifySelf: 'end', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><EyeIcon size={12}/> View</button>
              {canRevive && (
                <button onClick={() => setReviving(a)} className="zm-btn-primary" style={{ height: 28, padding: '0 10px', border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff', justifySelf: 'end', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="refresh" size={12}/> Revive</button>
              )}
            </div>
          );
        })}
        {archive.length === 0 && (<div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>Archive is empty. Rejected and archived drafts will appear here for future reference.</div>)}
      </div>
      {reviving && <ReviveDialog site={reviving} onCancel={() => setReviving(null)} onConfirm={onReviveConfirm} busy={busy}/>}
    </div>
  );
}
