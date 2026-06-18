import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ModuleChecklistPage from '../../shared/checklist/ModuleChecklistPage.jsx';
import { usePageContext } from '../../../App.jsx';
import { useSession } from '../../../state/SessionContext.jsx';
import { getLegalReview, saveLicensing } from '../../../services/api/legalApi.js';
import { listLegalDelegationsForSite } from '../../../services/api/legalDelegationApi.js';
import { ROUTES } from '../../../router/routes.js';
import { agreementAllowsLicensing, agreementStatusLabel, normalizeAgreementStatus } from '../../../lib/agreementStatus.js';

const LICENSING_CHECKS = [
  { id: 'fssai',           label: 'FSSAI license verified' },
  { id: 'health_trade',    label: 'Health / trade license verified' },
  { id: 'shops_estab_reg', label: 'Shop & establishment registration verified' },
  { id: 'fire_noc',        label: 'Fire NOC verified' },
  { id: 'storage_license', label: 'Signage / storage license verified' },
];

function coreFromLicensing(licensing) {
  if (!licensing) return {};
  const result = {};
  for (const check of LICENSING_CHECKS) {
    const value = licensing[check.id];
    result[check.id] = value && value !== 'pending' ? value : null;
  }
  return result;
}

export default function LicensingPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { showToast } = usePageContext();
  const { role, session } = useSession();

  const [review, setReview] = React.useState(null);
  const [loadState, setLoadState] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [delegations, setDelegations] = React.useState([]);

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
        setError(err?.detail || err?.message || 'Failed to load licensing');
        setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [siteId]);

  React.useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    listLegalDelegationsForSite(siteId)
      .then((r) => {
        if (!cancelled) setDelegations(r.items || []);
      })
      .catch(() => {
        if (!cancelled) setDelegations([]);
      });
    return () => { cancelled = true; };
  }, [siteId]);

  if (!siteId) {
    return <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-danger)' }}>Missing site id.</div>;
  }

  if (loadState === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-fg-3)' }}>Loading licensing…</div>;
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

  const initialCore = coreFromLicensing(review?.licensing);
  const stage = review?.licensing?.stage || 'draft';
  const isSupervisor = role === 'supervisor';
  const isExecutive = role === 'executive' || role === 'exec';
  const myUserId = session?.userId || null;
  const hasMyDelegation = !!myUserId && delegations.some(
    (d) => String(d.delegateUserId) === String(myUserId),
  );
  const agreementStatus = normalizeAgreementStatus(review);
  const agreementReady = agreementAllowsLicensing(agreementStatus);
  const ddReady = (review?.dd?.stage || 'published') === 'published' && review?.dd?.final_verdict === 'positive';
  const canEditStage = isSupervisor || (isExecutive && stage === 'draft' && hasMyDelegation);
  const canEdit = ddReady && agreementReady && canEditStage;
  const lockedReason = !ddReady
    ? 'Licensing opens after DDR is published with a positive verdict.'
    : !agreementReady
      ? 'Agreement must be executed before licensing can be edited.'
      : isExecutive && !hasMyDelegation
        ? 'This licensing checklist is read-only until the legal supervisor delegates the site to you.'
        : isExecutive && stage !== 'draft'
          ? `Licensing is ${stage.replace('_', ' ')}; executive edits are locked.`
          : 'Licensing is read-only right now.';

  const buildPayload = ({ coreStatuses }) => {
    const payload = {};
    for (const check of LICENSING_CHECKS) {
      const v = coreStatuses[check.id];
      if (v === 'yes' || v === 'no') payload[check.id] = v;
    }
    return payload;
  };

  const handleSave = async (snapshot) => {
    if (!canEdit) {
      showToast?.(lockedReason, 'danger');
      return;
    }
    try {
      setSaving(true);
      const next = await saveLicensing(siteId, buildPayload(snapshot));
      setReview(next);
      showToast?.('Licensing draft saved.', 'success');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Save failed', 'danger');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (snapshot) => {
    if (!canEdit) {
      showToast?.(lockedReason, 'danger');
      return;
    }
    try {
      setSubmitting(true);
      const next = await saveLicensing(siteId, buildPayload(snapshot));
      setReview(next);
      const allYes = LICENSING_CHECKS.every((c) => snapshot.coreStatuses[c.id] === 'yes');
      if (allYes) showToast?.('Licensing complete — site auto-approved.', 'success');
      else        showToast?.('Licensing submitted.', 'success');
      // End of the legal chain → back to the Legal queue for the next site.
      navigate(ROUTES.LEGAL);
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Submit failed', 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const site = {
    code: review?.siteCode || review?.siteId?.slice(0, 8).toUpperCase() || 'SITE',
    name: review?.siteName || `Site ${review?.siteId?.slice(0, 8) || ''}`,
    city: review?.city || '—',
    owner: review?.submittedByName || '—',
    stage: review?.siteStatus || 'LEGAL_REVIEW',
    icon: 'card',
    iconBg: 'var(--zm-copper-soft)',
    iconColor: 'var(--zm-copper)',
  };

  return (
    <>
    {!ddReady && (
      <div className="zm-glass" style={{ padding: 14, borderRadius: 10, marginBottom: 12, color: 'var(--zm-fg-2)' }}>
        Licensing opens after DDR is published with a positive verdict.
      </div>
    )}
    {ddReady && !agreementReady && (
      <div className="zm-glass" style={{ padding: 14, borderRadius: 10, marginBottom: 12, color: 'var(--zm-fg-2)' }}>
        Agreement is still pending. Licensing is locked until the agreement is executed or registered.
      </div>
    )}
    {ddReady && agreementReady && !canEdit && (
      <div className="zm-glass" style={{ padding: 14, borderRadius: 10, marginBottom: 12, color: 'var(--zm-fg-2)' }}>
        {lockedReason}
      </div>
    )}
    <ModuleChecklistPage
      checks={LICENSING_CHECKS}
      site={site}
      moduleName="legal"
      meta={[
        ['Site id',    review?.siteId || '—'],
        ['Site state', review?.siteStatus || '—'],
        ['Licensing',  review?.licensingStatus || 'pending'],
      ]}
      trail={[
        ['DDR verdict',          ddReady ? 'Positive' : 'Pending'],
        ['Agreement status', agreementReady ? agreementStatusLabel(agreementStatus) : 'Pending'],
        ['Payment handoff',      review?.licensingStatus === 'complete' ? 'Ready' : 'Pending'],
      ]}
      header={{
        file: 'No. 06',
        eyebrow: 'Legal module · Licensing',
        title: <>Licensing <em>review</em></>,
        lede: 'Mark each statutory license check as Yes or No before the final payment-side handoff is cleared.',
        tagIcon: 'card',
      }}
      tableLabel="Licensing field"
      moduleShort="Licensing"
      handoffText="When all license checks are clear, the site auto-transitions to LEGAL_APPROVED and BD is notified."
      otherPlaceholder="Other licensing field"
      otherTitle="Statutory licenses only"
      otherDescription="Backend tracks only the five statutory fields above."
      maxOtherRows={0}
      initialCoreStatuses={initialCore}
      initialOtherRows={[]}
      onSave={handleSave}
      onSubmit={handleSubmit}
      saving={saving}
      submitting={submitting}
      stage={stage}
      readOnly={!canEdit}
      readOnlyText={lockedReason}
    />
    </>
  );
}
