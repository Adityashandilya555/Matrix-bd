import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ModuleChecklistPage from '../../shared/checklist/ModuleChecklistPage.jsx';
import { usePageContext } from '../../../App.jsx';
import { useSession } from '../../../state/SessionContext.jsx';
import { getLegalReview, saveDdItems, finalizeDd } from '../../../services/api/legalApi.js';
import {
  delegateLegal,
  revokeLegalDelegation,
  listLegalDelegationsForSite,
} from '../../../services/api/legalDelegationApi.js';
import { listMyTeam } from '../../../services/api/adapters/httpAdapter.js';
import { ROUTES, paymentSiteLicensingRoute } from '../../../router/routes.js';

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
  return ['other_1', 'other_2']
    .map((slot, index) => {
      const value = dd[slot];
      if (!value || value === 'pending') return null;
      return { id: `other-${index + 1}`, slot, label: `Other ${index + 1}`, status: value };
    })
    .filter(Boolean);
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

  // Delegations: supervisor-only "Delegate to executive" UI.
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

  const initialCore = coreFromDd(review?.dd);
  const initialOthers = otherRowsFromDd(review?.dd);

  const buildPayload = ({ coreStatuses, otherRows }) => {
    const payload = {};
    for (const check of DDR_CHECKS) {
      const v = coreStatuses[check.id];
      if (v === 'yes' || v === 'no') payload[check.id] = v;
    }
    otherRows.slice(0, MAX_OTHER_ROWS).forEach((row, idx) => {
      const slot = `other_${idx + 1}`;
      if (row.status === 'yes' || row.status === 'no') payload[slot] = row.status;
    });
    return payload;
  };

  const handleSave = async (snapshot) => {
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

  const handleSubmit = async (snapshot) => {
    if (snapshot.issueCount > 0) {
      const reason = window.prompt('At least one item is marked No. Enter the rejection reason to finalise as NEGATIVE:');
      if (!reason) return;
      try {
        setSubmitting(true);
        await saveDdItems(siteId, buildPayload(snapshot));
        const next = await finalizeDd(siteId, { finalVerdict: 'negative', rejectionReason: reason });
        setReview(next);
        showToast?.('DDR finalised as negative. BD notified.', 'danger');
      } catch (err) {
        showToast?.(err?.detail || err?.message || 'Finalise failed', 'danger');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    try {
      setSubmitting(true);
      await saveDdItems(siteId, buildPayload(snapshot));
      const next = await finalizeDd(siteId, { finalVerdict: 'positive' });
      setReview(next);
      showToast?.('DDR finalised as positive.', 'success');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Finalise failed', 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  // Minimal site shape derived from the LegalReviewResponse. The fuller name /
  // code / city render comes from the queue payload that linked us here; for
  // now we synthesise a placeholder, since LegalReviewResponse currently only
  // exposes the legal child rows. The header still reflects real status.
  const site = {
    code: review?.siteId?.slice(0, 8).toUpperCase() || 'SITE',
    name: `Site ${review?.siteId?.slice(0, 8) || ''}`,
    city: '—',
    owner: '—',
    stage: review?.siteStatus || 'LEGAL_REVIEW',
    icon: 'shield',
    iconBg: 'var(--zm-plum-soft)',
    iconColor: 'var(--zm-plum)',
  };

  // ── Licensing-tab gate (U5) ────────────────────────────────────────────────
  // Executive's licensing tab is visible iff
  //   dd.stage === 'published'
  //   && dd.final_verdict === 'positive'
  //   && there is an active legal delegation on this site for me.
  //
  // Defensive default: if the backend's `stage` column hasn't shipped yet
  // (slice U3 not landed), `dd.stage` is undefined — treat that as 'published'
  // so the gate still passes once the verdict turns positive.
  const ddStage = review?.dd?.stage ?? 'published';
  const ddIsPublished = ddStage === 'published';
  const ddPositive = review?.dd?.final_verdict === 'positive';
  const isDelegateForMe = !!myUserId && delegations.some(
    (d) => String(d.delegateUserId) === String(myUserId),
  );
  const showLicensingTab =
    isExecutive && ddIsPublished && ddPositive && isDelegateForMe;

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
          DD is positive and published — licensing has been auto-assigned to you.
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate(paymentSiteLicensingRoute(siteId))}
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
    {delegationPanel}
    {licensingTab}
    <ModuleChecklistPage
      checks={DDR_CHECKS}
      site={site}
      moduleName="legal"
      meta={[
        ['Site id', review?.siteId || '—'],
        ['Status',  review?.siteStatus || '—'],
        ['DD state', review?.legalDdStatus || 'pending'],
      ]}
      trail={[
        ['LOI uploaded',     'Completed by BD'],
        ['Legal review',     review?.legalDdStatus === 'in_review' ? 'In progress' : 'Pending'],
        ['Legal decision',   review?.dd?.final_verdict && review.dd.final_verdict !== 'pending' ? review.dd.final_verdict : 'Pending'],
      ]}
      header={{
        file: 'No. 05',
        eyebrow: 'Legal module · DDR',
        title: <>Due diligence <em>review</em></>,
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
    />
    </>
  );
}
