import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ModuleChecklistPage from '../../shared/checklist/ModuleChecklistPage.jsx';
import { usePageContext } from '../../../App.jsx';
import { useSession } from '../../../state/SessionContext.jsx';
import {
  getLegalReview,
  saveDdItems,
  finalizeDd,
  submitDdForReview,
} from '../../../services/api/legalApi.js';
import {
  delegateLegal,
  revokeLegalDelegation,
  listLegalDelegationsForSite,
} from '../../../services/api/legalDelegationApi.js';
import { listMyTeam } from '../../../services/api/adapters/httpAdapter.js';
import { ROUTES, legalSiteAgreementRoute, legalSiteLicensingRoute } from '../../../router/routes.js';
import { agreementAllowsLicensing, agreementStatusLabel, normalizeAgreementStatus } from '../../../lib/agreementStatus.js';

const DDR_CHECKS = [
  { id: 'title_doc',       label: 'Title / ownership verified' },
  { id: 'sanctioned_plan', label: 'Sanctioned plan verified' },
  { id: 'oc_cc',           label: 'OC / CC verified' },
  { id: 'commercial_use',  label: 'Commercial usage verified' },
  { id: 'property_tax',    label: 'Property tax verified' },
  { id: 'electricity',     label: 'Electricity connection verified' },
  { id: 'fire_noc',        label: 'Fire NOC verified' },
];

// Backend exposes only two slots for free-form other rows.
const MAX_OTHER_ROWS = 2;

function coreFromDd(dd) {
  if (!dd) return {};
  const result = {};
  for (const check of DDR_CHECKS) {
    const value = dd[check.id];
    result[check.id] = value && value !== 'pending' ? value : null;
  }
  return result;
}

function otherRowsFromDd(dd) {
  if (!dd) return [];
  // A row is materialised whenever the user has invested anything into the
  // slot — either a typed label or a non-pending status. This preserves
  // "in progress" rows (label typed, status not yet chosen) across saves,
  // which is the primary failure mode the dedicated label columns fix.
  return ['other_1', 'other_2']
    .map((slot, index) => {
      const status = dd[slot];
      const label  = dd[`${slot}_label`];
      const hasStatus = status && status !== 'pending';
      const hasLabel  = typeof label === 'string' && label.trim().length > 0;
      if (!hasStatus && !hasLabel) return null;
      return {
        id: `other-${index + 1}`,
        slot,
        label: hasLabel ? label : `Other ${index + 1}`,
        status: hasStatus ? status : null,
      };
    })
    .filter(Boolean);
}

function DdrVerdictOverrideModal({ issueCount, onPositive, onNegative, onCancel, busy }) {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState('');

  const submitNegative = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Enter the rejection reason before finalising as negative.');
      return;
    }
    onNegative(trimmed);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 560, maxWidth: '94%', padding: 26, borderRadius: 14, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-warning)' }}>
            DDR contains {issueCount} No item{issueCount === 1 ? '' : 's'}
          </span>
          <h2 style={{ margin: '6px 0 8px', fontFamily: 'var(--zm-font-display)', fontSize: 22, fontWeight: 750, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>
            Do you want to finalise DDR as positive?
          </h2>
          <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg-3)', lineHeight: 1.55 }}>
            Choose positive only if Legal has accepted the open observations and the Agreement/Licensing process should continue. The override will be recorded in the activity trail.
          </p>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
            Rejection reason if finalising negative
          </span>
          <textarea
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(''); }}
            disabled={busy}
            placeholder="Example: Fire NOC not available from landlord."
            style={{ minHeight: 86, resize: 'vertical', padding: 12, borderRadius: 9, border: '1px solid var(--zm-line)', background: 'var(--zm-bg)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13.5, outline: 'none' }}
          />
          {error && <span style={{ color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12 }}>{error}</span>}
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onCancel} disabled={busy} className="zm-btn" style={{ height: 36, padding: '0 15px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 650, cursor: busy ? 'wait' : 'pointer' }}>Cancel</button>
          <button onClick={submitNegative} disabled={busy} className="zm-btn" style={{ height: 36, padding: '0 15px', borderRadius: 8, border: '1px solid rgba(185,28,28,0.28)', background: 'rgba(185,28,28,0.08)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 750, cursor: busy ? 'wait' : 'pointer' }}>No, finalise negative</button>
          <button onClick={onPositive} disabled={busy} className="zm-btn-primary" style={{ height: 36, padding: '0 15px', borderRadius: 8, border: 'none', background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 750, cursor: busy ? 'wait' : 'pointer', boxShadow: 'var(--zm-shadow-1)' }}>Yes, finalise positive</button>
        </div>
      </div>
    </div>
  );
}

export default function DdrPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { showToast } = usePageContext();
  const { role, session } = useSession();
  const isSupervisor = role === 'supervisor';
  const isExecutive  = role === 'executive' || role === 'exec';
  const myUserId = session?.userId || null;

  const [review, setReview] = React.useState(null);
  const [loadState, setLoadState] = React.useState('loading'); // loading | ready | error
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submittingForReview, setSubmittingForReview] = React.useState(false);
  const [overrideSnapshot, setOverrideSnapshot] = React.useState(null);

  // Delegations: supervisor-only "Delegate to executive" UI; also drives the
  // executive's licensing CTA unlock once DD is published positive.
  const [executives, setExecutives] = React.useState([]);
  const [delegations, setDelegations] = React.useState([]);
  const [selectedExec, setSelectedExec] = React.useState('');
  const [delegating, setDelegating] = React.useState(false);

  React.useEffect(() => {
    if (!siteId) return;
    // Delegations are needed by:
    //   • supervisors — to render the delegate panel
    //   • executives  — to decide whether the licensing CTA is unlocked
    //                    (auto-inherited after a positive published DD)
    // Failures degrade silently so the rest of the DDR page keeps working.
    if (isSupervisor) {
      listMyTeam('legal').then(setExecutives).catch(() => setExecutives([]));
    }
    listLegalDelegationsForSite(siteId)
      .then((r) => setDelegations(r.items || []))
      .catch(() => setDelegations([]));
  }, [siteId, isSupervisor]);

  const refreshDelegations = React.useCallback(async () => {
    if (!siteId) return;
    try {
      const r = await listLegalDelegationsForSite(siteId);
      setDelegations(r.items || []);
    } catch {
      setDelegations([]);
    }
  }, [siteId]);

  const handleDelegate = async () => {
    if (!selectedExec) return;
    try {
      setDelegating(true);
      await delegateLegal(siteId, selectedExec);
      showToast?.('Site delegated to executive.', 'success');
      setSelectedExec('');
      await refreshDelegations();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Delegation failed', 'danger');
    } finally {
      setDelegating(false);
    }
  };

  const handleRevoke = async (userId) => {
    try {
      setDelegating(true);
      await revokeLegalDelegation(siteId, userId);
      showToast?.('Delegation revoked.', 'success');
      await refreshDelegations();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Revoke failed', 'danger');
    } finally {
      setDelegating(false);
    }
  };

  React.useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    setLoadState('loading');
    getLegalReview(siteId)
      .then((data) => {
        if (cancelled) return;
        setReview(data);
        setLoadState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.detail || err?.message || 'Failed to load DDR');
        setLoadState('error');
    });
    return () => { cancelled = true; };
  }, [siteId]);

  const dd = review?.dd;
  const initialCore = React.useMemo(
    () => coreFromDd(dd),
    [
      siteId,
      dd?.title_doc,
      dd?.sanctioned_plan,
      dd?.oc_cc,
      dd?.commercial_use,
      dd?.property_tax,
      dd?.electricity,
      dd?.fire_noc,
    ],
  );
  const initialOthers = React.useMemo(
    () => otherRowsFromDd(dd),
    [
      siteId,
      dd?.other_1,
      dd?.other_1_label,
      dd?.other_2,
      dd?.other_2_label,
    ],
  );

  if (!siteId) {
    return <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-danger)' }}>Missing site id.</div>;
  }

  if (loadState === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-fg-3)' }}>Loading DDR…</div>;
  }
  if (loadState === 'error') {
    return (
      <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-danger)' }}>
        {error}
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => navigate(ROUTES.LEGAL)} className="zm-btn"
            style={{ height: 32, padding: '0 12px', borderRadius: 7, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', cursor: 'pointer' }}>
            Back to legal queue
          </button>
        </div>
      </div>
    );
  }

  const rawStage = review?.dd?.stage || 'draft';
  const ddFinalVerdict = review?.dd?.final_verdict || 'pending';
  const ddFinalized = ddFinalVerdict !== 'pending' && Boolean(review?.dd?.approved_by);
  const publishedButUnfinalized = rawStage === 'published' && !ddFinalized;
  const stage = publishedButUnfinalized ? 'draft' : rawStage;
  const displayLegalDdStatus = publishedButUnfinalized ? 'in_review' : (review?.legalDdStatus || 'pending');
  // Executive must hold an active legal delegation on this site to edit. The
  // backend enforces this (raises 403 in svc_save_verification), so we mirror
  // it here to avoid letting an executive type into a checklist that the API
  // will refuse to persist.
  const hasMyDelegation = !!myUserId && delegations.some(
    (d) => String(d.delegateUserId) === String(myUserId),
  );
  const executiveBlockedByDelegation = isExecutive && !hasMyDelegation;
  // Edit gate:
  //  • Executives: stage === 'draft' AND delegated to them.
  //  • Supervisors: any stage EXCEPT 'published'. Once published, the row is
  //    what BD reads as the source of truth, so any post-publish change
  //    must flow through the change-request path (BD opens a request →
  //    supervisor approves it via change_request_service). This mirrors
  //    svc_save_verification's supervisor stage-gate.
  const supervisorLockedByPublished = isSupervisor && stage === 'published';
  const canEdit =
    (isSupervisor && !supervisorLockedByPublished)
    || (stage === 'draft' && hasMyDelegation);

  const buildPayload = ({ coreStatuses, otherRows }) => {
    const payload = {};
    for (const check of DDR_CHECKS) {
      const v = coreStatuses[check.id];
      if (v === 'yes' || v === 'no') payload[check.id] = v;
    }
    // Slot semantics:
    //   • A row with a typed label (any status) writes BOTH label + status
    //     (status only if 'yes'/'no'). The label persists on Save Draft so
    //     it survives a round-trip — the primary fix.
    //   • A slot the user has cleared (no row at this index) writes
    //     other_N_label="" so the backend knows to null out the persisted
    //     label. The status reverts to whatever was already there (we do
    //     not blanket-clear so the supervisor's history is preserved).
    const filledSlots = new Set();
    otherRows.slice(0, MAX_OTHER_ROWS).forEach((row, idx) => {
      const slot = `other_${idx + 1}`;
      const labelKey = `${slot}_label`;
      filledSlots.add(slot);
      const trimmed = (row.label || '').trim();
      if (trimmed.length > 0) payload[labelKey] = trimmed;
      if (row.status === 'yes' || row.status === 'no') payload[slot] = row.status;
    });
    // Explicit clear: any slot index the user did not fill should release
    // its prior label so a stale "Mall NOC" doesn't outlive its row.
    ['other_1', 'other_2'].forEach((slot) => {
      if (!filledSlots.has(slot)) payload[`${slot}_label`] = '';
    });
    return payload;
  };

  const handleSave = async (snapshot) => {
    if (!canEdit) {
      if (executiveBlockedByDelegation) {
        showToast?.(
          'You do not have an active legal delegation on this site. Ask the legal supervisor to delegate it before saving a draft.',
          'danger',
        );
      } else if (supervisorLockedByPublished) {
        showToast?.(
          'DDR is published — BD reads this as the source of truth. Edits require a change request from BD.',
          'danger',
        );
      } else {
        showToast?.(`DDR is ${stage.replace('_', ' ')} — edits are locked for ${role}.`, 'danger');
      }
      return;
    }
    try {
      setSaving(true);
      const payload = buildPayload(snapshot);
      const next = await saveDdItems(siteId, payload);
      setReview(next);
      showToast?.('DDR draft saved.', 'success');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Save failed', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForReview = async () => {
    try {
      setSubmittingForReview(true);
      const next = await submitDdForReview(siteId);
      setReview(next);
      showToast?.('DDR submitted for supervisor review.', 'success');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Submit for review failed', 'danger');
    } finally {
      setSubmittingForReview(false);
    }
  };

  const finalizePositive = async (snapshot, overrideReason = null) => {
    try {
      setSubmitting(true);
      await saveDdItems(siteId, buildPayload(snapshot));
      const next = await finalizeDd(siteId, {
        finalVerdict: 'positive',
        overrideReason,
      });
      setReview(next);
      setOverrideSnapshot(null);
      showToast?.(
        overrideReason ? 'DDR finalised as positive with supervisor override.' : 'DDR finalised as positive.',
        'success',
      );
      navigate(legalSiteAgreementRoute(siteId));
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Finalise failed', 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const finalizeNegative = async (snapshot, reason) => {
    try {
      setSubmitting(true);
      await saveDdItems(siteId, buildPayload(snapshot));
      const next = await finalizeDd(siteId, { finalVerdict: 'negative', rejectionReason: reason });
      setReview(next);
      setOverrideSnapshot(null);
      showToast?.('DDR finalised as negative. BD notified.', 'danger');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Finalise failed', 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (snapshot) => {
    if (snapshot.issueCount > 0) {
      setOverrideSnapshot(snapshot);
      return;
    }
    await finalizePositive(snapshot);
  };

  const site = {
    code: review?.siteCode || review?.siteId?.slice(0, 8).toUpperCase() || 'SITE',
    name: review?.siteName || `Site ${review?.siteId?.slice(0, 8) || ''}`,
    city: review?.city || '—',
    owner: review?.submittedByName || '—',
    stage: review?.siteStatus || 'LEGAL_REVIEW',
    icon: 'shield',
    iconBg: 'var(--zm-plum-soft)',
    iconColor: 'var(--zm-plum)',
  };

  // ── Licensing-tab gate (U5) ────────────────────────────────────────────────
  // Licensing opens after DDR is published positive. Supervisors can continue
  // directly; executives need the same active legal delegation used for DDR.
  //
  // Executive's licensing CTA is unlocked when:
  //   dd.stage === 'published'
  //   && dd.final_verdict === 'positive'
  //   && there is an active legal delegation on this site for me.
  //
  // A DDR verdict only unlocks the next step after explicit finalize, which
  // stamps both a published stage and an approver. Save Draft stays editable.
  const ddIsPublished = stage === 'published' && ddFinalized;
  const ddPositive = ddFinalVerdict === 'positive' && ddFinalized;
  const agreementStatus = normalizeAgreementStatus(review);
  const agreementReady = agreementAllowsLicensing(agreementStatus);
  const isDelegateForMe = !!myUserId && delegations.some(
    (d) => String(d.delegateUserId) === String(myUserId),
  );
  const showLicensingTab =
    ddIsPublished && ddPositive && agreementReady && (isSupervisor || (isExecutive && isDelegateForMe));

  const agreementPanel = ddIsPublished && ddPositive && !agreementReady ? (
    <div
      className="zm-glass"
      style={{
        padding: 16, borderRadius: 12, marginBottom: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        border: '1px solid var(--zm-copper-line)',
        background: 'var(--zm-warning-soft)',
      }}
    >
      <div>
        <div style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
        }}>
          Agreement required
        </div>
        <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', marginTop: 4 }}>
          DDR is positive and published. Mark the agreement executed before licensing opens for this site.
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate(legalSiteAgreementRoute(siteId))}
        className="zm-btn-primary"
        style={{
          height: 34, padding: '0 14px', borderRadius: 7, border: 'none',
          background: 'var(--zm-accent)', color: '#fff',
          fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Open agreement
      </button>
    </div>
  ) : null;

  const delegationPanel = (
    <div
      className="zm-glass"
      style={{
        padding: 16, borderRadius: 12, marginBottom: 12,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{
        fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
        letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
      }}>
        Legal delegation
      </div>

      {isSupervisor && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedExec}
            onChange={(e) => setSelectedExec(e.target.value)}
            disabled={delegating || executives.length === 0}
            style={{
              minWidth: 240, height: 34, padding: '0 10px', borderRadius: 7,
              border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
              color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13,
            }}
          >
            <option value="">
              {executives.length ? 'Delegate to executive…' : 'No legal executives in team'}
            </option>
            {executives.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email} ({u.email})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedExec || delegating}
            onClick={handleDelegate}
            className="zm-btn-primary"
            style={{
              height: 34, padding: '0 14px', borderRadius: 7, border: 'none',
              background: 'var(--zm-accent)', color: '#fff',
              fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800,
              cursor: !selectedExec || delegating ? 'not-allowed' : 'pointer',
              opacity: !selectedExec || delegating ? 0.5 : 1,
            }}
          >
            {delegating ? 'Working…' : 'Delegate'}
          </button>
        </div>
      )}

      {delegations.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {delegations.map((d) => (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 7,
                background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line-faint)',
              }}
            >
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>
                <strong>{d.delegateName || d.delegateEmail}</strong>
                <span style={{ color: 'var(--zm-fg-3)', marginLeft: 8 }}>
                  {d.delegateEmail}
                </span>
              </span>
              {isSupervisor && (
                <button
                  type="button"
                  disabled={delegating}
                  onClick={() => handleRevoke(d.delegateUserId)}
                  className="zm-btn"
                  style={{
                    height: 28, padding: '0 10px', borderRadius: 6,
                    border: '1px solid var(--zm-line)', background: 'transparent',
                    color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)',
                    fontSize: 11, fontWeight: 700, cursor: delegating ? 'not-allowed' : 'pointer',
                  }}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>
          {isExecutive
            ? 'This site has not been delegated to you yet — ask your supervisor to assign it.'
            : 'No active delegations on this site.'}
        </div>
      )}
    </div>
  );

  const licensingTab = showLicensingTab ? (
    <div
      className="zm-glass"
      style={{
        padding: 16, borderRadius: 12, marginBottom: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}
    >
      <div>
        <div style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
        }}>
          Licensing
        </div>
        <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', marginTop: 4 }}>
          {isSupervisor
            ? `Agreement is ${agreementStatusLabel(agreementStatus).toLowerCase()} — continue into licensing for this site.`
            : `Agreement is ${agreementStatusLabel(agreementStatus).toLowerCase()} — licensing has been auto-assigned to you.`}
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate(legalSiteLicensingRoute(siteId))}
        className="zm-btn-primary"
        style={{
          height: 34, padding: '0 14px', borderRadius: 7, border: 'none',
          background: 'var(--zm-accent)', color: '#fff',
          fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
        }}
      >
        Open licensing
      </button>
    </div>
  ) : null;

  return (
    <>
    {executiveBlockedByDelegation && (
      <div
        className="zm-glass"
        style={{
          padding: 14, borderRadius: 10, marginBottom: 12,
          border: '1px solid var(--zm-warning, #E0A659)',
          background: 'rgba(224, 166, 89, 0.08)',
          color: 'var(--zm-fg)',
          fontFamily: 'var(--zm-font-body)', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 10,
        }}
        role="status"
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 999,
          background: 'var(--zm-warning, #E0A659)', color: '#1A1310', fontWeight: 900,
          fontSize: 13,
        }}>!</span>
        <span>
          <strong>Read-only:</strong> you have not been delegated this site yet.
          Ask the legal supervisor to delegate it to you before saving a draft.
        </span>
      </div>
    )}
    {supervisorLockedByPublished && (
      <div
        className="zm-glass"
        style={{
          padding: 14, borderRadius: 10, marginBottom: 12,
          border: '1px solid var(--zm-accent)',
          background: 'var(--zm-accent-soft, rgba(82,124,222,0.08))',
          color: 'var(--zm-fg)',
          fontFamily: 'var(--zm-font-body)', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 10,
        }}
        role="status"
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, borderRadius: 999,
          background: 'var(--zm-accent)', color: '#fff', fontWeight: 900,
          fontSize: 13,
        }}>i</span>
        <span>
          <strong>Published — read-only:</strong> BD reads this DDR as the
          source of truth. Edits to a published checklist require a change
          request opened by BD; once approved, the change replays here.
        </span>
      </div>
    )}
    {delegationPanel}
    {agreementPanel}
    {licensingTab}
    <ModuleChecklistPage
      checks={DDR_CHECKS}
      site={site}
      moduleName="legal"
      meta={[
        ['Site id', review?.siteId || '—'],
        ['Status',  review?.siteStatus || '—'],
        ['DD state', displayLegalDdStatus],
      ]}
      trail={[
        ['LOI uploaded',     'Completed by BD'],
        ['Legal review',     displayLegalDdStatus === 'in_review' ? 'In progress' : 'Pending'],
        ['Legal decision',   ddFinalized ? ddFinalVerdict : 'Pending'],
      ]}
      header={{
        file: 'No. 05',
        eyebrow: 'Legal module · DDR',
        title: <>Due diligence review</>,
        lede: 'Mark each due-diligence check as Yes or No before the legal supervisor confirms the site verdict.',
        tagIcon: 'shield',
      }}
      tableLabel="DDR field"
      moduleShort="DDR"
      handoffText="A positive DDR continues toward agreement; a negative DDR closes the legal path and notifies BD."
      otherPlaceholder="Other DDR field"
      otherTitle="Need another document check?"
      otherDescription={`Up to ${MAX_OTHER_ROWS} custom rows can be added per site.`}
      maxOtherRows={MAX_OTHER_ROWS}
      initialCoreStatuses={initialCore}
      initialOtherRows={initialOthers}
      onSave={handleSave}
      onSubmit={handleSubmit}
      saving={saving}
      submitting={submitting}
      stage={stage}
      // isExecutive accepts both 'executive' (backend ships this) and 'exec'
      // (mock-mode role switcher, plus any legacy session payload). Using the
      // narrower role==='executive' check here previously hid the
      // Submit-for-review button whenever a session carried role='exec',
      // making the draft → pending_review flow unreachable from the UI even
      // though svc_submit_dd_for_review accepted it server-side.
      onSubmitForReview={isExecutive ? handleSubmitForReview : undefined}
      submittingForReview={submittingForReview}
      readOnly={!canEdit}
      readOnlyText={
        supervisorLockedByPublished
          ? 'DDR is published and read-only. Use a BD change request to amend the published source of truth.'
          : executiveBlockedByDelegation
            ? 'This site has not been delegated to you yet.'
            : `DDR is ${stage.replace('_', ' ')} and cannot be edited by this role.`
      }
    />
    {overrideSnapshot && (
      <DdrVerdictOverrideModal
        issueCount={overrideSnapshot.issueCount}
        busy={submitting}
        onCancel={() => setOverrideSnapshot(null)}
        onPositive={() => finalizePositive(
          overrideSnapshot,
          `Supervisor override: ${overrideSnapshot.issueCount} DDR item${overrideSnapshot.issueCount === 1 ? '' : 's'} marked No but finalised as positive.`,
        )}
        onNegative={(reason) => finalizeNegative(overrideSnapshot, reason)}
      />
    )}
    </>
  );
}
