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
import { listMyTeam } from '../../../services/api/adapters/httpAdapter.js';
import { useFocusSite } from '../../../hooks/useFocusSite.js';
import StateKpiTile from '../../shared/primitives/StateKpiTile.jsx';
import { STAGES } from '../../shared/primitives/constants.js';

// All render bodies preserved exactly from Shortlist.jsx.

function EyeIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

export function LOITimelineModal({ site, onCancel, onSubmit }) {
  const [days, setDays] = React.useState(14);
  const daysId = React.useId();
  // Guard against double-submit: a second click before the first approve
  // resolves double-fires the (unlocked) backend state transition. (#96)
  const [submitting, setSubmitting] = React.useState(false);
  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try { await onSubmit(site, days); }
    finally { setSubmitting(false); }
  };
  if (!site) return null;
  const presets = [7, 14, 21, 30];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'zm-fade 200ms var(--zm-ease)' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 480, padding: 28, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 16, animation: 'zm-rise 240ms var(--zm-ease-emp)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Approving · {site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Expected LOI timeline</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>By when should the BD exec have the signed LOI uploaded? Sites that miss this date highlight in Sites in process.</p>
          </div>
          <button onClick={onCancel} className="zm-icon-btn" style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer', flex: '0 0 30px' }}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label htmlFor={daysId} style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 12, color: 'var(--zm-fg)' }}>Days from today</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input id={daysId} type="number" min="1" max="120" value={days} onChange={(e) => setDays(Math.max(1, Math.min(120, Number(e.target.value) || 0)))} style={{ width: 110, height: 56, padding: '0 14px', background: 'var(--zm-bg)', border: '1px solid var(--zm-line)', borderRadius: 8, fontFamily: 'var(--zm-font-mono)', fontSize: 28, fontWeight: 600, color: 'var(--zm-fg)', outline: 'none', textAlign: 'center' }}/>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)' }}>days · target date{' '}<strong style={{ color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-mono)' }}>{new Date(Date.now() + days * 86400000).toISOString().slice(0,10)}</strong></span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {presets.map(p => (<button key={p} onClick={() => setDays(p)} className="zm-pill" style={{ height: 28, padding: '0 12px', borderRadius: 999, border: '1px solid ' + (days === p ? 'var(--zm-accent)' : 'var(--zm-line)'), background: days === p ? 'var(--zm-accent-soft)' : 'var(--zm-surface)', color: days === p ? 'var(--zm-accent)' : 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{p}d</button>))}
          </div>
        </div>
        <div style={{ padding: 12, background: 'var(--zm-accent-soft)', borderRadius: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color: 'var(--zm-accent)', display: 'inline-flex', marginTop: 1 }}><Icon name="alert" size={14}/></span>
          On approval, this site moves to Sites in process. The BD exec is notified and the timer starts.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={submitting} className="zm-btn" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={submitting} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1, boxShadow: 'var(--zm-shadow-1)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={13}/> {submitting ? 'Approving…' : 'Approve & set timeline'}</button>
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

  // `isCancelled` lets the mount effect abort its own load: if the modal closes
  // (or reopens for a different site) before the two requests resolve, we skip
  // the setState — preventing an unmounted-component update and a stale
  // previous-site delegation list flashing in. (#98)
  const load = React.useCallback(async (isCancelled = () => false) => {
    setLoading(true); setError(null);
    try {
      const [list, team] = await Promise.all([
        siteService.listSiteDelegations(site.id),
        listMyTeam('bd'),
      ]);
      if (isCancelled()) return;
      setDelegations(list);
      // listMyTeam('bd') returns only this supervisor's BD executives — the same
      // module-scoped primitive Legal/Design/Project use — so executives from
      // other departments never appear in the picker.
      setCandidates(team);
    } catch (err) {
      if (!isCancelled()) setError(err?.message || 'Failed to load delegations');
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, [site.id]);

  React.useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

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

        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(185,28,28,0.08)', color: 'var(--zm-danger)', fontSize: 12.5 }}>{error}</div>}

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
                      <button disabled={busy} onClick={() => revoke(d)} style={{ height: 30, padding: '0 12px', borderRadius: 7, border: '1px solid #F2B6B6', background: '#fff', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>Revoke</button>
                    </div>
                  ))}
                </div>
              )
          }
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Grant a new delegation</span>
          {eligible.length === 0 && !loading
            ? <span style={{ fontSize: 12.5, color: 'var(--zm-fg-3)' }}>{candidates.length === 0 ? 'No executives in this workspace yet — approve a pending executive from /team.' : 'All eligible executives already have an active delegation here.'}</span>
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

function AssignDetailsModal({ site, currentUserId, onClose, onAssigned, showToast }) {
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [candidates, setCandidates] = React.useState([]);
  const [pickedUserId, setPickedUserId] = React.useState(site.assignedToId || site.assignedTo?.id || '');
  const assignedName = site.assignedToName || site.assignedTo?.name || '';

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    listMyTeam('bd')
      .then((team) => {
        if (!alive) return;
        setCandidates(team.filter((u) => String(u.id) !== String(currentUserId || '')));
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || 'Failed to load executives');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [currentUserId]);

  const assign = async () => {
    if (!pickedUserId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await siteService.assignSite(site.id, pickedUserId);
      const exec = candidates.find((u) => String(u.id) === String(pickedUserId));
      showToast?.(`Delegated · ${site.name} assigned to ${exec?.name || 'executive'}.`, 'success');
      await onAssigned?.();
      onClose?.();
    } catch (err) {
      const message = err?.detail || err?.message || 'Could not assign executive';
      setError(message);
      showToast?.(message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 112, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, width: 520, maxWidth: '94%', padding: 26, boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Delegate for details · {site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 750, fontSize: 21, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Choose the executive who will fill Add Details</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
              The site stays in Shortlisted sites. The assigned executive completes the details form, then sends it back for your approval.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: busy ? 'wait' : 'pointer' }}><Icon name="x" size={14}/></button>
        </div>

        {assignedName && (
          <div style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--zm-accent-soft)', border: '1px solid var(--zm-accent-line)', color: 'var(--zm-accent)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 650 }}>
            Currently assigned to {assignedName}
          </div>
        )}

        {error && <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.28)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5 }}>{error}</div>}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 750, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Executive</span>
          <select value={pickedUserId} onChange={(e) => setPickedUserId(e.target.value)} disabled={busy || loading} style={{ height: 42, padding: '0 12px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-bg)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13.5, outline: 'none' }}>
            <option value="">{loading ? 'Loading executives...' : 'Pick an executive...'}</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.email}{u.assignedCity ? ` · ${u.assignedCity}` : ''}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={busy} className="zm-btn" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: busy ? 'var(--zm-fg-4)' : 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 650, cursor: busy ? 'wait' : 'pointer' }}>Cancel</button>
          <button onClick={assign} disabled={!pickedUserId || busy} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: pickedUserId && !busy ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)', color: pickedUserId && !busy ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 750, cursor: pickedUserId && !busy ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="user" size={13}/>{busy ? 'Delegating...' : 'Delegate for details'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectShortlistModal({ site, onClose, onReject }) {
  const [reason, setReason] = React.useState('Site does not fit expansion criteria');
  const [comment, setComment] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  if (!site) return null;
  const reasons = [
    'Site does not fit expansion criteria',
    'Commercials are not viable',
    'Location or catchment is weak',
    'Duplicate or incorrect pipeline',
  ];
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onReject(site, [reason], comment.trim() || null);
      onClose?.();
    } catch (err) {
      setError(err?.detail || err?.message || 'Could not reject this site.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 112, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 520, maxWidth: '94%', background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14, boxShadow: 'var(--zm-shadow-pop)', padding: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 750, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-danger)' }}>Reject shortlist · {site.code}</span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 750, fontSize: 21, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>Send this site out of the shortlist</h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>The site will move to rejected records and the owner will be notified with your reason.</p>
          </div>
          <button onClick={onClose} disabled={busy} className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: busy ? 'wait' : 'pointer' }}><Icon name="x" size={14}/></button>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 750, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} style={{ height: 42, borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-bg)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13.5, padding: '0 12px', outline: 'none' }}>
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 750, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Comment</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} disabled={busy} placeholder="Optional context for the BD team..." style={{ minHeight: 88, resize: 'vertical', borderRadius: 9, border: '1px solid var(--zm-line)', background: 'var(--zm-bg)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, padding: 12, outline: 'none' }}/>
        </label>
        {error && <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.28)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={busy} className="zm-btn" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: busy ? 'var(--zm-fg-4)' : 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 650, cursor: busy ? 'wait' : 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={busy} className="zm-btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: busy ? 'var(--zm-surface-sunken)' : 'var(--zm-danger)', color: busy ? 'var(--zm-fg-4)' : '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 750, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="alert" size={13}/>{busy ? 'Rejecting...' : 'Reject site'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ShortlistCard({ item, role, currentUserId, onView, onAddDetails, onApprove, onDelegate, onReject }) {
  const supervisor = role === 'supervisor';
  const assignedToId = item.assignedToId || item.assignedTo?.id || '';
  const assignedToName = item.assignedToName || item.assignedTo?.name || '';
  const supervisorCreatedShortlist =
    supervisor &&
    item.status === 'shortlisted' &&
    item.submittedBy &&
    item.supervisorId &&
    String(item.submittedBy) === String(currentUserId) &&
    String(item.supervisorId) === String(currentUserId);
  const needsAssignment = supervisorCreatedShortlist && !assignedToId;
  const waitingForAssignedDetails = supervisorCreatedShortlist && !!assignedToId && !item.inReview;
  const reviewable = item.inReview === true;
  const hasDraft = !!item.details && !reviewable;
  return (
    <div data-site-id={item.code} style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--zm-shadow-1)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 10, flex: '0 0 64px', background: `linear-gradient(135deg, hsl(${item.hue} 30% 80%), hsl(${item.hue+30} 30% 60%))` }}/>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{item.code}</span>
            {reviewable ? <StatusPill stage="inReview"/> : <StatusPill stage="shortlist"/>}
          </span>
          <h3 style={{ margin: 0, fontFamily: 'var(--zm-font-display)', fontWeight: 600, fontSize: 17, color: 'var(--zm-fg)' }}>{item.name}</h3>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>{item.city} · Visit {item.visitDate} · Created by {item.createdBy}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Score</span>
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 600, fontSize: 22, color: item.score >= 4 ? 'var(--zm-success)' : 'var(--zm-fg)' }}>{item.score || '—'}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, padding: '10px 0', borderTop: '1px solid var(--zm-line-faint)', borderBottom: '1px solid var(--zm-line-faint)' }}>
        {[['Est. sales', item.estSales ? `₹${(Number(item.estSales) / 100000).toFixed(1)} L/mo` : '—'], ['Carpet', item.carpet ? `${item.carpet} sqft` : '—'], ['Total op', item.totalOpCost ? `₹${Math.round(Number(item.totalOpCost) / 1000)} k/mo` : '—'], ['Rent type', item.rentType === 'fixed' ? 'Fixed + esc.' : item.rentType === 'revshare' ? 'Rev share' : item.rentType === 'mg_revshare' ? 'MG + rev share' : '—']].map(([k, v]) => (
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
            <button onClick={() => onReject(item)} className="zm-btn" title="Reject this shortlisted site" style={{ height: 34, padding: '0 13px', border: '1px solid rgba(155,42,42,0.30)', borderRadius: 7, background: 'rgba(155,42,42,0.06)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1 }}><Icon name="alert" size={13}/> Reject</button>
            {(needsAssignment || waitingForAssignedDetails) && (
              <button onClick={() => onDelegate(item)} className="zm-btn-primary" title={needsAssignment ? 'Assign this site to a BD executive for Add Details' : 'Change the assigned executive'} style={{ height: 34, padding: '0 13px', border: 'none', borderRadius: 7, background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', boxShadow: 'var(--zm-shadow-1)', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1 }}><Icon name="user" size={13}/> {needsAssignment ? 'Delegate for details' : 'Reassign'}</button>
            )}
            {waitingForAssignedDetails && (
              <span style={{ padding: '6px 10px', borderRadius: 7, background: 'var(--zm-accent-soft)', border: '1px solid var(--zm-accent-line)', fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-accent)', fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="clock" size={12}/> Awaiting details{assignedToName ? ` · ${assignedToName}` : ''}
              </span>
            )}
            {!needsAssignment && !waitingForAssignedDetails && (
              <button onClick={() => onApprove(item)} disabled={!reviewable} className="zm-btn-primary" title={!reviewable ? 'BD exec must Send for review before approving' : 'Approve and advance to Sites in process'} style={{ height: 34, padding: '0 14px', border: 'none', borderRadius: 7, background: reviewable ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)', color: reviewable ? '#fff' : 'var(--zm-fg-4)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: reviewable ? 'pointer' : 'not-allowed', boxShadow: reviewable ? 'var(--zm-shadow-1)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', lineHeight: 1 }}><Icon name="check" size={13}/> Approve shortlist</button>
            )}
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
  const { role, user, session } = useSession();
  const { shortlist, saveDraftDetails, submitDetailsForReview, approveShortlistToStaging, refresh } = useSites();
  useFocusSite(); // scroll/flash a card reached via /shortlist?focus=<code>
  const [approving, setApproving] = React.useState(null);
  const [detailing, setDetailing] = React.useState(null);
  const [detailSaving, setDetailSaving] = React.useState(false);
  const [detailError, setDetailError] = React.useState(null);
  const [delegating, setDelegating] = React.useState(null);
  const [rejecting, setRejecting] = React.useState(null);

  const ME = user.name;
  const currentUserId = session?.userId || session?.id || session?.sub || user?.id || null;
  // RBAC: isExec = cannot approve shortlist (only supervisor can; executives need a delegation)
  const isExec = !can(role, 'shortlist');
  const visibleShortlist = isExec
    ? shortlist.filter((s) => {
        const assignedToId = s.assignedToId || s.assignedTo?.id || '';
        return (
          String(s.submittedBy || '') === String(currentUserId || '') ||
          String(assignedToId || '') === String(currentUserId || '') ||
          s.createdBy === ME
        );
      })
    : shortlist;

  // Shortlist state tracking — two sub-states, surfaced as clickable KPI tiles.
  const awaitingDetails = visibleShortlist.filter(s => !s.inReview);
  const pendingApproval = visibleShortlist.filter(s => s.inReview);
  const [stateFilter, setStateFilter] = React.useState('all'); // all | awaiting | pending
  const filteredShortlist =
    stateFilter === 'awaiting' ? awaitingDetails :
    stateFilter === 'pending' ? pendingApproval :
    visibleShortlist;

  const onApprove = (item) => setApproving(item);
  const onTimelineSubmit = async (item, days) => {
    try {
      await approveShortlistToStaging(item, days);
      setApproving(null);
      showToast?.(`Approved · ${item.name}. LOI expected in ${days}d. Moved to Sites in process.`);
    } catch (err) {
      showToast?.(`Approval failed: ${err?.detail || err?.message || 'Unknown error'}`, 'danger');
    }
  };
  const onAddDetails = (item) => {
    setDetailError(null);
    setDetailing(item);
  };
  const onDetailsSubmit = async (item, formData) => {
    // Keep the modal open until the submit resolves; close ONLY on success so a
    // backend error doesn't discard everything the BD exec typed. Mirrors the
    // save-draft handler (detailSaving disables the button, detailError shows
    // the message inline). (#97)
    setDetailError(null);
    setDetailSaving(true);
    try {
      await submitDetailsForReview(item, formData);
      setDetailing(null);
      showToast?.(`Sent for review · ${formData.name}. Supervisor notified.`);
    } catch (err) {
      const message = err?.detail || err?.message || 'Unknown error';
      setDetailError(message);
      showToast?.(`Submit failed: ${message}`, 'danger');
    } finally {
      setDetailSaving(false);
    }
  };
  const onDetailsSaveDraft = async (item, formData) => {
    setDetailError(null);
    setDetailSaving(true);
    try {
      await saveDraftDetails(item, formData);
      setDetailing(null);
      showToast?.(`Draft saved · ${item.name}. Continue anytime from the shortlist.`);
    } catch (err) {
      const message = err?.detail || err?.message || 'Unknown error';
      setDetailError(message);
      showToast?.(`Draft save failed: ${message}`, 'danger');
    } finally {
      setDetailSaving(false);
    }
  };
  const onRejectShortlist = async (item, reasons, comment) => {
    await siteService.rejectSite(item.id, reasons, comment);
    await refresh?.();
    showToast?.(`Rejected · ${item.name}.`, 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 920 }}>
      <PageHeader
        file="№ 03" eyebrow="Workflow · Shortlist"
        title="Shortlist"
        lede={`${visibleShortlist.length} site${visibleShortlist.length === 1 ? '' : 's'}`}
        right={<HeaderTag icon="clock" label="OLDEST FIRST"/>}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StateKpiTile
          label="Awaiting details" value={awaitingDetails.length} color={STAGES.staging.color}
          sub="17-field form not submitted yet"
          active={stateFilter === 'awaiting'}
          onClick={() => setStateFilter(f => f === 'awaiting' ? 'all' : 'awaiting')}
        />
        <StateKpiTile
          label="Pending approval" value={pendingApproval.length} color={STAGES.inReview.color}
          sub="in review · awaiting supervisor"
          active={stateFilter === 'pending'}
          onClick={() => setStateFilter(f => f === 'pending' ? 'all' : 'pending')}
        />
      </div>
      {filteredShortlist.map(item => (
        <ShortlistCard key={item.code} item={item} role={role} currentUserId={currentUserId}
          onView={onOpenSite || (() => {})} onAddDetails={onAddDetails} onApprove={onApprove}
          onDelegate={setDelegating} onReject={setRejecting}/>
      ))}
      {filteredShortlist.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', background: 'var(--zm-surface)', border: '1px dashed var(--zm-line)', borderRadius: 12 }}>
          <span style={{ display: 'inline-flex', color: 'var(--zm-fg-3)', marginBottom: 12 }}><Icon name="check" size={32}/></span>
          <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 14, color: 'var(--zm-fg-2)' }}>
            {visibleShortlist.length === 0 ? 'Queue empty.' : 'No sites in this state — clear the tile filter to see all.'}
          </p>
        </div>
      )}
      {approving && <LOITimelineModal site={approving} onCancel={() => setApproving(null)} onSubmit={onTimelineSubmit}/>}
      {detailing && <AddDetailsPage key={detailing.id} item={detailing} onClose={() => { if (!detailSaving) setDetailing(null); }} onSubmit={(formData) => onDetailsSubmit(detailing, formData)} onSaveDraft={(formData) => onDetailsSaveDraft(detailing, formData)} savingDraft={detailSaving} saveError={detailError}/>}
      {rejecting && <RejectShortlistModal site={rejecting} onClose={() => setRejecting(null)} onReject={onRejectShortlist}/>}
      {delegating && (
        <AssignDetailsModal
          site={delegating}
          currentUserId={currentUserId}
          onClose={() => setDelegating(null)}
          onAssigned={refresh}
          showToast={showToast}
        />
      )}
    </div>
  );
}
