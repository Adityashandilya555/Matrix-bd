import React from 'react';
import { useSession } from '../../../state/SessionContext.jsx';
import { useSites } from '../../../state/SitesContext.jsx';
import { usePageContext } from '../../../App.jsx';
import { can } from '../../../rbac/permissions.js';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import StatusPill from '../../shared/primitives/StatusPill.jsx';
import AddDetailsPage from '../../loi/details/AddDetailsPage.jsx';
import * as siteService from '../../../services/api/siteService.js';

// All render bodies preserved exactly from Shortlist.jsx.

function EyeIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function LOITimelineModal({ site, onCancel, onSubmit }) {
  const [days, setDays] = React.useState(14);
  if (!site) return null;
  const presets = [7, 14, 21, 30];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'zm-fade 200ms var(--zm-ease)' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 480, padding: 28, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 16, animation: 'zm-rise 240ms var(--zm-ease-emp)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Approving · {site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Expected LOI timeline</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>By when should the BD exec have the signed LOI uploaded? Sites that miss this date highlight in staging.</p>
          </div>
          <button onClick={onCancel} className="zm-icon-btn" style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer', flex: '0 0 30px' }}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' }}>Days from today</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input type="number" min="1" max="120" value={days} onChange={(e) => setDays(Math.max(1, Math.min(120, Number(e.target.value) || 0)))} style={{ width: 110, height: 56, padding: '0 14px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 8, fontFamily: 'var(--zm-font-mono)', fontSize: 28, fontWeight: 600, color: 'var(--zm-fg)', outline: 'none', textAlign: 'center' }}/>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>days · target date{' '}<strong style={{ color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-mono)' }}>{new Date(Date.now() + days * 86400000).toISOString().slice(0,10)}</strong></span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {presets.map(p => (<button key={p} onClick={() => setDays(p)} className="zm-pill" style={{ height: 28, padding: '0 12px', borderRadius: 999, border: '1px solid ' + (days === p ? 'var(--zm-accent)' : 'var(--zm-line)'), background: days === p ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', color: days === p ? 'var(--zm-accent)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{p}d</button>))}
          </div>
        </div>
        <div style={{ padding: 12, background: 'var(--zm-accent-soft)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color: 'var(--zm-accent)', display: 'inline-flex', marginTop: 1 }}><Icon name="alert" size={14}/></span>
          On approval, this site moves to Staging. The BD exec is notified and the timer starts.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="zm-btn" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSubmit(site, days)} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: 'var(--zm-shadow-1)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={13}/> Approve & set timeline</button>
        </div>
      </div>
    </div>
  );
}

// Supervisor-only side panel for granting / revoking shortlist delegations on
// a specific site. Executives who get a grant can act on that site even if
// it's outside their normal scope.
function DelegationModal({ site, onClose, onChanged, showToast }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [delegations, setDelegations] = React.useState([]);
  const [candidates, setCandidates] = React.useState([]);
  const [pickedUserId, setPickedUserId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [list, users] = await Promise.all([
        siteService.listSiteDelegations(site.id),
        siteService.listUsers(),
      ]);
      setDelegations(list);
      // Only executives are eligible delegates per the product rules.
      setCandidates(users.filter(u => u.role === 'executive'));
    } catch (err) {
      setError(err?.message || 'Failed to load delegations');
    } finally {
      setLoading(false);
    }
  }, [site.id]);

  React.useEffect(() => { load(); }, [load]);

  const alreadyDelegated = new Set(delegations.map(d => d.delegateUserId));
  const eligible = candidates.filter(u => !alreadyDelegated.has(u.id));

  async function grant() {
    if (!pickedUserId) return;
    setBusy(true);
    try {
      await siteService.grantDelegation(site.id, { delegateUserId: pickedUserId, notes: notes.trim() || null });
      setPickedUserId(''); setNotes('');
      await load();
      onChanged?.();
      showToast?.('Delegation granted.');
    } catch (err) {
      showToast?.(err?.message || 'Could not grant delegation', 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(d) {
    setBusy(true);
    try {
      await siteService.revokeDelegation(d.id);
      await load();
      onChanged?.();
      showToast?.(`Revoked · ${d.delegateName || d.delegateEmail}`);
    } catch (err) {
      showToast?.(err?.message || 'Could not revoke delegation', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 560, maxWidth: '94%', padding: 26, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Delegate · {site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Let an executive act on this site</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Grants are additive — you keep your own approval power. Executives with a delegation can shortlist/approve this site even if it's outside their normal scope.</p>
          </div>
          <button onClick={onClose} className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer' }}><Icon name="x" size={14}/></button>
        </div>

        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(185,28,28,0.08)', color: '#B91C1C', fontSize: 12.5 }}>{error}</div>}

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Active delegations</span>
          {loading
            ? <span style={{ fontSize: 13, color: 'var(--zm-fg-3)' }}>Loading…</span>
            : delegations.length === 0
              ? <span style={{ fontSize: 13, color: 'var(--zm-fg-3)' }}>None yet — you're the only approver.</span>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {delegations.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--zm-line)', borderRadius: 10, background: 'var(--zm-surface-2)' }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--zm-fg)' }}>{d.delegateName || d.delegateEmail}</span>
                        <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{d.delegateEmail}</span>
                        {d.notes && <span style={{ marginTop: 4, fontSize: 11.5, color: 'var(--zm-fg-3)' }}>{d.notes}</span>}
                      </div>
                      <button disabled={busy} onClick={() => revoke(d)} style={{ height: 30, padding: '0 12px', borderRadius: 7, border: '1px solid #F2B6B6', background: '#fff', color: '#B91C1C', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>Revoke</button>
                    </div>
                  ))}
                </div>
              )
          }
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Grant a new delegation</span>
          {eligible.length === 0 && !loading
            ? <span style={{ fontSize: 12.5, color: 'var(--zm-fg-3)' }}>{candidates.length === 0 ? 'No executives in this workspace yet — assign someone the executive role from /team.' : 'All eligible executives already have an active delegation here.'}</span>
            : (
              <>
                <select value={pickedUserId} onChange={(e) => setPickedUserId(e.target.value)} disabled={busy || loading} style={{ height: 36, padding: '0 10px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 6, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', outline: 'none' }}>
                  <option value="">Pick an executive…</option>
                  {eligible.map(u => (<option key={u.id} value={u.id}>{u.name} · {u.email}{u.assignedCity ? ` · ${u.assignedCity}` : ''}</option>))}
                </select>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note (why this site is being delegated)…" style={{ width: '100%', minHeight: 60, padding: 10, resize: 'vertical', border: '1px solid var(--zm-line)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg)', outline: 'none', background: 'var(--zm-bg)' }}/>
                <button onClick={grant} disabled={!pickedUserId || busy} style={{ height: 36, padding: '0 16px', alignSelf: 'flex-end', borderRadius: 8, border: 'none', background: pickedUserId ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)', color: pickedUserId ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: pickedUserId && !busy ? 'pointer' : 'not-allowed' }}>{busy ? 'Saving…' : 'Grant delegation'}</button>
              </>
            )
          }
        </section>
      </div>
    </div>
  );
}

function ShortlistCard({ item, role, onView, onAddDetails, onApprove, onDelegate }) {
  const supervisor = role === 'supervisor';
  const reviewable = item.inReview === true;
  const hasDraft = !!item.details && !reviewable;
  return (
    <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 10, flex: '0 0 64px', background: `linear-gradient(135deg, hsl(${item.hue} 30% 80%), hsl(${item.hue+30} 30% 60%))` }}/>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{item.code}</span>
            {reviewable ? <StatusPill stage="inReview"/> : <StatusPill stage="shortlist"/>}
          </span>
          <h3 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 17, color: 'var(--zm-fg)' }}>{item.name}</h3>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>{item.city} · visit {item.visitDate} · created by {item.createdBy}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Score</span>
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 600, fontSize: 22, color: item.score >= 75 ? '#047857' : 'var(--zm-fg)' }}>{item.score || '—'}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, padding: '10px 0', borderTop: '1px solid var(--zm-line-faint)', borderBottom: '1px solid var(--zm-line-faint)' }}>
        {[['Est. sales', item.estSales ? `₹${(Number(item.estSales) / 100000).toFixed(1)} L/mo` : '—'], ['Carpet', item.carpet ? `${item.carpet} sqft` : '—'], ['Total op', item.totalOpCost ? `₹${Math.round(Number(item.totalOpCost) / 1000)} k/mo` : '—'], ['Rent type', item.rentType === 'fixed' ? 'Fixed + esc.' : item.rentType === 'revshare' ? 'Rev share' : '—']].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>{k}</span><span style={{ fontFamily: 'var(--zm-font-mono)', fontFeatureSettings: "'tnum' 1", fontSize: 14, fontWeight: 600, color: 'var(--zm-fg)' }}>{v}</span></div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => onView(item)} title="View" className="zm-icon-btn" style={{ width: 34, height: 34, border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><EyeIcon size={16}/></button>
        {!supervisor && (<button onClick={() => onAddDetails(item)} className="zm-btn" style={{ height: 34, padding: '0 14px', borderRadius: 7, border: '1px solid ' + (hasDraft ? 'var(--zm-accent-line)' : 'var(--zm-line)'), background: hasDraft ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', color: hasDraft ? 'var(--zm-accent)' : 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={hasDraft ? 'folder' : 'plus'} size={13}/>{reviewable ? 'Edit details' : hasDraft ? 'Continue draft' : 'Add details'}</button>)}
        {hasDraft && !supervisor && (<span style={{ padding: '4px 8px', borderRadius: 999, background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Draft saved</span>)}
        <span style={{ flex: 1 }}/>
        {supervisor ? (
          <>
            <button onClick={() => onDelegate(item)} className="zm-btn" title="Let an executive act on this site" style={{ height: 34, padding: '0 12px', border: '1px solid var(--zm-line)', borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1 }}><Icon name="user" size={13}/> Delegate</button>
            <button onClick={() => onApprove(item)} disabled={!reviewable} className="zm-btn-primary" title={!reviewable ? 'BD exec must Send for review before approving' : 'Approve and advance to staging'} style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 7, background: reviewable ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)', color: reviewable ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: reviewable ? 'pointer' : 'not-allowed', boxShadow: reviewable ? 'var(--zm-shadow-1)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1 }}><Icon name="check" size={13}/> Approve shortlist</button>
          </>
        ) : reviewable ? (
          <span style={{ padding: '6px 10px', borderRadius: 7, background: 'var(--zm-accent-soft)', border: '1px solid var(--zm-accent-line)', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-accent)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="clock" size={12}/> Awaiting supervisor approval</span>
        ) : (
          <span style={{ padding: '6px 10px', borderRadius: 7, background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={12}/> Add 17 fields then Send for review</span>
        )}
      </div>
    </div>
  );
}

export default function ShortlistPage({ onOpenSite: onOpenSiteProp, showToast: showToastProp }) {
  const ctx = usePageContext();
  const onOpenSite = onOpenSiteProp || ctx.onOpenSite;
  const showToast = showToastProp || ctx.showToast;
  const { role, user } = useSession();
  const { shortlist, saveDraftDetails, submitDetailsForReview, approveShortlistToStaging } = useSites();
  const [approving, setApproving] = React.useState(null);
  const [detailing, setDetailing] = React.useState(null);
  const [delegating, setDelegating] = React.useState(null);

  const ME = user.name;
  // RBAC: isExec = cannot approve shortlist (only supervisor can)
  const isExec = !can(role, 'shortlist');
  const visibleShortlist = isExec ? shortlist.filter(s => s.createdBy === ME) : shortlist;

  const onApprove = (item) => setApproving(item);
  const onTimelineSubmit = (item, days) => {
    setApproving(null);
    approveShortlistToStaging(item, days);
    showToast?.(`Approved · ${item.name}. LOI expected in ${days}d. Moved to staging.`);
  };
  const onAddDetails = (item) => setDetailing(item);
  const onDetailsSubmit = (item, formData) => {
    setDetailing(null);
    submitDetailsForReview(item, formData);
    showToast?.(`Sent for review · ${formData.name}. Supervisor notified.`);
  };
  const onDetailsSaveDraft = (item, formData) => {
    setDetailing(null);
    saveDraftDetails(item, formData);
    showToast?.(`Draft saved · ${item.name}. Continue anytime from the shortlist.`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 920 }}>
      <PageHeader
        file="№ 03" eyebrow="Workflow · Shortlist"
        title={<>Shortlist <em>queue</em></>}
        lede={role === 'supervisor'
          ? `${visibleShortlist.length} site${visibleShortlist.length === 1 ? '' : 's'} cleared from pipeline — approve once the exec marks them as in review.`
          : `${visibleShortlist.length} of your own shortlisted site${visibleShortlist.length === 1 ? '' : 's'} — add the 17 essential fields, then send for review.`}
        right={<HeaderTag icon="clock" label="OLDEST FIRST"/>}
      />
      {visibleShortlist.map(item => (
        <ShortlistCard key={item.code} item={item} role={role}
          onView={onOpenSite || (() => {})} onAddDetails={onAddDetails} onApprove={onApprove}
          onDelegate={setDelegating}/>
      ))}
      {visibleShortlist.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', background: 'var(--zm-surface)', border: '1px dashed var(--zm-line)', borderRadius: 12 }}>
          <span style={{ display: 'inline-flex', color: 'var(--zm-fg-3)', marginBottom: 12 }}><Icon name="check" size={32}/></span>
          <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 14, color: 'var(--zm-fg-2)' }}>Queue empty.</p>
        </div>
      )}
      {approving && <LOITimelineModal site={approving} onCancel={() => setApproving(null)} onSubmit={onTimelineSubmit}/>}
      {detailing && <AddDetailsPage item={detailing} onClose={() => setDetailing(null)} onSubmit={(formData) => onDetailsSubmit(detailing, formData)} onSaveDraft={(formData) => onDetailsSaveDraft(detailing, formData)}/>}
      {delegating && <DelegationModal site={delegating} onClose={() => setDelegating(null)} showToast={showToast}/>}
    </div>
  );
}
