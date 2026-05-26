import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ModuleChecklistPage from '../../shared/checklist/ModuleChecklistPage.jsx';
import { usePageContext } from '../../../App.jsx';
import { getLegalReview, saveLicensing } from '../../../services/api/legalApi.js';
import { ROUTES } from '../../../router/routes.js';

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

  const [review, setReview] = React.useState(null);
  const [loadState, setLoadState] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

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
          <button type="button" onClick={() => navigate(ROUTES.PAYMENT)} className="zm-btn"
            style={{ height: 32, padding: '0 12px', borderRadius: 7, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', cursor: 'pointer' }}>
            Back to payment
          </button>
        </div>
      </div>
    );
  }

  const initialCore = coreFromLicensing(review?.licensing);

  const buildPayload = ({ coreStatuses }) => {
    const payload = {};
    for (const check of LICENSING_CHECKS) {
      const v = coreStatuses[check.id];
      if (v === 'yes' || v === 'no') payload[check.id] = v;
    }
    return payload;
  };

  const handleSave = async (snapshot) => {
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
    try {
      setSubmitting(true);
      const next = await saveLicensing(siteId, buildPayload(snapshot));
      setReview(next);
      const allYes = LICENSING_CHECKS.every((c) => snapshot.coreStatuses[c.id] === 'yes');
      if (allYes) showToast?.('Licensing complete — site auto-approved.', 'success');
      else        showToast?.('Licensing submitted.', 'success');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Submit failed', 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  const site = {
    code: review?.siteId?.slice(0, 8).toUpperCase() || 'SITE',
    name: `Site ${review?.siteId?.slice(0, 8) || ''}`,
    city: '—',
    owner: '—',
    stage: review?.siteStatus || 'LEGAL_REVIEW',
    icon: 'card',
    iconBg: 'var(--zm-copper-soft)',
    iconColor: 'var(--zm-copper)',
  };

  return (
    <ModuleChecklistPage
      checks={LICENSING_CHECKS}
      site={site}
      moduleName="payment"
      meta={[
        ['Site id',    review?.siteId || '—'],
        ['Site state', review?.siteStatus || '—'],
        ['Licensing',  review?.licensingStatus || 'pending'],
      ]}
      trail={[
        ['Agreement registered', review?.agreementStatus === 'registered' ? 'Done' : 'Pending'],
        ['Licensing review',     review?.licensingStatus === 'complete' ? 'Complete' : 'In progress'],
        ['Payment handoff',      review?.licensingStatus === 'complete' ? 'Ready' : 'Pending'],
      ]}
      header={{
        file: 'No. 06',
        eyebrow: 'Payment module · Licensing',
        title: <>Licensing <em>review</em></>,
        lede: 'Mark each statutory license check as Yes or No before the payment-side handoff is cleared.',
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
    />
  );
}
