import React from 'react';
import { useSession } from '../../../state/SessionContext.jsx';
import { useSites } from '../../../state/SitesContext.jsx';
import { usePageContext } from '../../../App.jsx';
import { can } from '../../../rbac/permissions.js';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Avatar from '../../shared/primitives/Avatar.jsx';
import StatusPill from '../../shared/primitives/StatusPill.jsx';
import Icon from '../../shared/primitives/Icon.jsx';

// All render bodies preserved exactly from Drafts.jsx.
// Only change: window globals replaced with ES imports above.

const MONTHS = ['All', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const REJECT_REASONS = [
  'High rent', 'High cannibalisation', 'Affluence problem',
  'High traffic problem', 'No visibility', 'Sales problem', 'Other',
];

function EyeIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function RejectReasonDialog({ draft, onCancel, onSubmit }) {
  const [picked, setPicked] = React.useState([]);
  const [comment, setComment] = React.useState('');
  const toggle = (r) => setPicked(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  const otherSelected = picked.includes('Other');
  const ready = picked.length > 0 && (!otherSelected || comment.trim().length > 0);
  if (!draft) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'zm-fade 200ms var(--zm-ease)' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 540, padding: 26, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18, animation: 'zm-rise 240ms var(--zm-ease-emp)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#B91C1C' }}>Rejecting · {draft.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Why is this draft a No?</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Pick all that apply. The BD exec sees the reason; the draft is archived for future reference.</p>
          </div>
          <button onClick={onCancel} className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer' }}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {REJECT_REASONS.map(r => { const on = picked.includes(r); return (<button key={r} onClick={() => toggle(r)} className="zm-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid ' + (on ? '#B91C1C' : 'var(--zm-line)'), background: on ? '#FBE0E0' : 'var(--zm-surface)', color: on ? '#B91C1C' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{on && <Icon name="check" size={12}/>}{r}</button>); })}
        </div>
        {otherSelected && (<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><label style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' }}>Other reason · comment <span style={{ color: '#B91C1C', fontWeight: 700 }}>*</span></label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell the BD exec what to look out for next time…" style={{ width: '100%', minHeight: 80, padding: 10, resize: 'vertical', border: '1px solid var(--zm-line)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none', background: 'var(--zm-bg)' }}/></div>)}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="zm-btn" style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button disabled={!ready} onClick={() => onSubmit(draft, picked, comment)} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid #F2B6B6', background: ready ? '#fff' : 'var(--zm-surface)', color: ready ? '#B91C1C' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Confirm reject</button>
        </div>
      </div>
    </div>
  );
}

function ArchiveNoteDialog({ draft, onCancel, onConfirm }) {
  const [note, setNote] = React.useState('');
  const ready = note.trim().length > 0;
  if (!draft) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'zm-fade 200ms var(--zm-ease)' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 520, padding: 26, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18, animation: 'zm-rise 240ms var(--zm-ease-emp)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Archiving · {draft.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Park this draft — why?</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Archive = not-a-No, just on the shelf. The note appears in Archive and can guide a future Revive.</p>
          </div>
          <button onClick={onCancel} className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer' }}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' }}>Reason for archiving <span style={{ color: '#B91C1C', fontWeight: 700 }}>*</span></label>
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. landlord undecided — revisit in Q3, or saving for the next franchise wave…" style={{ width: '100%', minHeight: 90, padding: 10, resize: 'vertical', border: '1px solid var(--zm-line)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none', background: 'var(--zm-bg)' }}/>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="zm-btn" style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button disabled={!ready} onClick={() => onConfirm(draft, note.trim())} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: ready ? 'var(--zm-accent)' : 'var(--zm-surface)', color: ready ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed' }}>Archive draft</button>
        </div>
      </div>
    </div>
  );
}

function DraftsFilterBar({ filters, onFilters, drafts }) {
  const cities = ['All', ...Array.from(new Set(drafts.map(d => d.city)))];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 10, padding: 14, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ position: 'relative', minWidth: 0 }}><Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--zm-fg-3)', pointerEvents: 'none' }}/><input placeholder="Search name or creator…" value={filters.q} onChange={(e) => onFilters({ ...filters, q: e.target.value })} style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', height: 36, padding: '0 10px 0 32px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}/></div>
      <select value={filters.city} onChange={(e) => onFilters({ ...filters, city: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}>{cities.map(c => <option key={c} value={c}>City · {c}</option>)}</select>
      <select value={filters.month} onChange={(e) => onFilters({ ...filters, month: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}>{MONTHS.map(m => <option key={m} value={m}>Visit · {m}</option>)}</select>
      <select value={filters.days} onChange={(e) => onFilters({ ...filters, days: e.target.value })} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}><option value="all">Days · all</option><option value="0-3">Days · 0–3</option><option value="4-7">Days · 4–7</option><option value="7+">Days · &gt; 7 (overdue)</option><option value="14+">Days · 14+</option></select>
    </div>
  );
}

function applyDraftFilters(drafts, f) {
  return drafts.filter(d => {
    if (f.q) { const q = f.q.toLowerCase(); if (!d.name.toLowerCase().includes(q) && !d.createdBy.toLowerCase().includes(q)) return false; }
    if (f.city !== 'All' && d.city !== f.city) return false;
    if (f.month !== 'All') { const m = new Date(d.visitDate).toLocaleString('en', { month: 'short' }); if (m !== f.month) return false; }
    if (f.days !== 'all') { const bands = { '0-3': [0,3], '4-7': [4,7], '7+': [8,9999], '14+': [14,9999] }; const [lo, hi] = bands[f.days]; if (d.days < lo || d.days > hi) return false; }
    return true;
  });
}

function DraftRow({ draft, role, canDecide, onApprove, onReject, onArchive, onOpen }) {
  const overdue = canDecide && draft.days > 7;
  return (
    <div className="zm-row" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 0.8fr 0.7fr ' + (canDecide ? '230px' : '90px'), alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)', background: overdue ? 'rgba(185,28,28,0.05)' : 'transparent', position: 'relative' }}>
      {overdue && <span style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, background: '#B91C1C', borderRadius: 2 }}/>}
      <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{draft.code}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--zm-fg)' }}>{draft.name}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>{draft.id}</span></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={draft.createdBy} size={22}/><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{draft.createdBy}</span></div>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>{draft.city}</span>
      <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 12.5, color: 'var(--zm-fg-2)' }}>{draft.visitDate}</span>
      <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 13, fontWeight: 600, color: overdue ? '#B91C1C' : 'var(--zm-fg)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{overdue && <Icon name="alert" size={12}/>}{String(draft.days).padStart(2,'0')}d</span>
      {canDecide ? (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={() => onOpen(draft)} title="View" className="zm-icon-btn" style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><EyeIcon/></button>
          <button onClick={() => onArchive(draft)} title="Archive" className="zm-icon-btn" style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="folder" size={14}/></button>
          <button onClick={() => onReject(draft)} className="zm-btn-danger" style={{ height: 32, padding: '0 10px', border: '1px solid #F2B6B6', borderRadius: 7, background: '#fff', color: '#B91C1C', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>No</button>
          <button onClick={() => onApprove(draft)} className="zm-btn-primary" style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: 'var(--zm-shadow-1)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12}/> Yes</button>
        </div>
      ) : (
        <button onClick={() => onOpen(draft)} className="zm-btn" style={{ height: 32, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', justifySelf: 'end', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><EyeIcon/> View</button>
      )}
    </div>
  );
}

export default function DraftsPage({ onOpenSite: onOpenSiteProp, showToast: showToastProp }) {
  const ctx = usePageContext();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  const showToast = showToastProp || ctx.showToast;
  const { role, user } = useSession();
  const { drafts, moveDraftToShortlist, rejectDraft, archiveDraft } = useSites();
  const [filters, setFilters] = React.useState({ q: '', city: 'All', month: 'All', days: 'all' });
  const [rejecting, setRejecting] = React.useState(null);
  const [archiving, setArchiving] = React.useState(null);

  const ME = user.name;
  const MY_CITY = user.city || user.assignedCity || null;
  // RBAC: use can() for permission checks. isExec kept as derived alias for render body compat.
  const isExec = !can(role, 'shortlist'); // exec cannot shortlist; supervisor can
  const isSubSup = role === 'sub_supervisor';

  // Sub-supervisors juggle two views: their own drafts (they're also BD execs in
  // their city) vs. the rest of their city's team. Default to Team so they see
  // what needs their decision first.
  const [scope, setScope] = React.useState('team');
  React.useEffect(() => { if (!isSubSup) setScope('all'); }, [isSubSup]);

  const visibleDrafts = React.useMemo(() => {
    if (isExec) return drafts.filter(d => d.createdBy === ME);
    if (isSubSup) {
      const inCity = MY_CITY ? drafts.filter(d => d.city === MY_CITY) : drafts;
      if (scope === 'mine') return inCity.filter(d => d.createdBy === ME);
      if (scope === 'team') return inCity.filter(d => d.createdBy !== ME);
      return inCity;
    }
    return drafts; // supervisor sees everything
  }, [drafts, isExec, isSubSup, MY_CITY, ME, scope]);

  // Sub-supervisor counts drive the scope toggle copy so the user can see at a
  // glance whether their inbox or their own drafts need attention.
  const myCityDrafts   = isSubSup && MY_CITY ? drafts.filter(d => d.city === MY_CITY) : drafts;
  const mineCount      = isSubSup ? myCityDrafts.filter(d => d.createdBy === ME).length : 0;
  const teamCount      = isSubSup ? myCityDrafts.filter(d => d.createdBy !== ME).length : 0;

  const filtered = applyDraftFilters(visibleDrafts, filters);
  const overdueCount = role === 'supervisor' || isSubSup ? visibleDrafts.filter(d => d.days > 7).length : 0;

  const onApprove = (d) => { moveDraftToShortlist(d); showToast?.(`Shortlisted · ${d.name} moved to shortlist queue`); };
  const onReject = (d) => setRejecting(d);
  const onRejectConfirm = (d, reasons, comment) => { setRejecting(null); rejectDraft(d, reasons, comment); showToast?.(`Rejected · ${d.name} · archived with ${reasons.length} reason${reasons.length === 1 ? '' : 's'}`, 'danger'); };
  const onArchive = (d) => setArchiving(d);
  const onArchiveConfirm = async (d, note) => {
    setArchiving(null);
    try {
      await archiveDraft(d, note);
      showToast?.(`Archived · ${d.name}. Available in Archive view.`);
    } catch (err) {
      showToast?.(err?.message || 'Could not archive draft', 'danger');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="№ 02" eyebrow="Workflow · Pipeline"
        title={role === 'supervisor' || isSubSup ? <>Drafts <em>awaiting</em> shortlist</> : <>Your drafts <em>in flight</em></>}
        lede={
          role === 'supervisor'
            ? `${visibleDrafts.length} draft${visibleDrafts.length === 1 ? '' : 's'} from all your BD execs. Supervisor SLA: 7 days. Tap Yes, No, or Archive.`
            : isSubSup
              ? `${visibleDrafts.length} draft${visibleDrafts.length === 1 ? '' : 's'} ${scope === 'mine' ? 'you created' : scope === 'team' ? `from your ${MY_CITY || 'city'} team` : `across ${MY_CITY || 'your city'}`}. You can shortlist or reject anything in your city — except your own drafts, which the supervisor decides.`
              : `${visibleDrafts.length} of your own draft${visibleDrafts.length === 1 ? '' : 's'} awaiting supervisor decision — you only see what you created.`
        }
        right={overdueCount > 0 ? <HeaderTag icon="alert" label={`${overdueCount} PAST SLA`} tone="accent"/> : <HeaderTag icon="check" label="SLA CLEAR"/>}
      />
      {isSubSup && (
        <div role="tablist" aria-label="Drafts scope" style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: 4, background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 999, gap: 4 }}>
          {[
            { id: 'team', label: 'Team', count: teamCount, sub: MY_CITY ? `${MY_CITY} · others' drafts` : "Others' drafts" },
            { id: 'mine', label: 'Mine', count: mineCount, sub: 'Drafts I created' },
            { id: 'all',  label: 'All',  count: teamCount + mineCount, sub: MY_CITY ? `Everything in ${MY_CITY}` : 'Everything' },
          ].map(t => {
            const active = scope === t.id;
            return (
              <button key={t.id} role="tab" aria-selected={active} onClick={() => setScope(t.id)} title={t.sub}
                style={{
                  height: 32, padding: '0 14px', borderRadius: 999, border: 'none',
                  background: active ? 'var(--zm-surface)' : 'transparent',
                  color: active ? 'var(--zm-fg)' : 'var(--zm-fg-2)',
                  fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600,
                  cursor: 'pointer', boxShadow: active ? 'var(--zm-shadow-1)' : 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                {t.label}
                <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: active ? 'var(--zm-fg-3)' : 'var(--zm-fg-4)' }}>{t.count}</span>
              </button>
            );
          })}
        </div>
      )}
      <DraftsFilterBar filters={filters} onFilters={setFilters} drafts={visibleDrafts}/>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--zm-shadow-1)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 0.8fr 0.7fr ' + (can(role, 'shortlist') ? '230px' : '90px'), gap: 10, padding: '11px 16px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
          <span>Code</span><span>Pipeline name</span><span>Created by</span><span>City</span><span>Visit date</span><span>Days</span><span style={{ textAlign: 'right' }}>{can(role, 'shortlist') ? 'Decision' : 'Action'}</span>
        </div>
        {filtered.map(d => {
          // Sub-supervisors can decide on team drafts in their city but NOT on
          // drafts they created themselves — the spec leaves self-approval to
          // the supervisor. Supervisors decide everything; execs decide nothing.
          const canDecideHere = role === 'supervisor' || (isSubSup && d.createdBy !== ME);
          return (
            <DraftRow key={d.id} draft={d} role={role} canDecide={canDecideHere} onApprove={onApprove} onReject={onReject} onArchive={onArchive} onOpen={onOpenSite || (() => {})}/>
          );
        })}
        {filtered.length === 0 && (<div style={{ padding: 48, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>No drafts match these filters.</div>)}
      </div>
      {rejecting && <RejectReasonDialog draft={rejecting} onCancel={() => setRejecting(null)} onSubmit={onRejectConfirm}/>}
      {archiving && <ArchiveNoteDialog draft={archiving} onCancel={() => setArchiving(null)} onConfirm={onArchiveConfirm}/>}
    </div>
  );
}
