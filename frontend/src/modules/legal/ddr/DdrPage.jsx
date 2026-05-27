import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ModuleChecklistPage from '../../shared/checklist/ModuleChecklistPage.jsx';
import { usePageContext } from '../../../App.jsx';
import {
  getLegalReview,
  saveDdItems,
  finalizeDd,
  submitDdForReview,
} from '../../../services/api/legalApi.js';
import { useSession } from '../../../state/SessionContext.jsx';
import { ROUTES } from '../../../router/routes.js';

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
  const { role } = useSession();

  const [review, setReview] = React.useState(null);
  const [loadState, setLoadState] = React.useState('loading'); // loading | ready | error
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submittingForReview, setSubmittingForReview] = React.useState(false);

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
  const stage = review?.dd?.stage || 'draft';
  // Edit gate: executives only when stage === 'draft'. Supervisors edit any stage.
  const canEdit = role === 'supervisor' || stage === 'draft';

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
    if (!canEdit) {
      showToast?.(`DDR is ${stage.replace('_', ' ')} — edits are locked for ${role}.`, 'danger');
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

  return (
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
      stage={stage}
      onSubmitForReview={role === 'executive' ? handleSubmitForReview : undefined}
      submittingForReview={submittingForReview}
    />
  );
}
