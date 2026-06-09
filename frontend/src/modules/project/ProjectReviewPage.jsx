import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { listMyTeam } from '../../services/api/adapters/httpAdapter.js';
import {
  allocateProject,
  getProject,
  pushQualityAudit,
  reviewProjectBudget,
  reviewProjectMilestone,
  reviewQualityAudit,
  saveProjectBudget,
  submitProjectMilestone,
} from '../../services/api/projectApi.js';
import { ROUTES } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

const DEFAULT_BUDGET = [
  'Professional Fees',
  'HVAC',
  'Furniture, Light & Planters',
  'Civil & Interiors',
  'Kitchen Equipment',
  'Branding',
  'Crockery & Small Equipments',
  'Utilities',
  'Licencing',
  'BD Cost',
  'Misc',
].map((label, index) => ({ idx: index + 1, label, amount: '' }));

// Indices (1-based) whose sum feeds the "Civil, Interior & MEP" metric.
const CIVIL_MEP_IDX = [2, 3, 4, 5, 8];

function budgetFromReview(review) {
  return DEFAULT_BUDGET.map((item) => {
    const saved = review?.budgetItems?.find((row) => Number(row.idx) === item.idx);
    // Always render the current canonical head label; only the amount is
    // restored from a saved draft (a draft saved under the old 10-head names
    // must not resurrect those labels).
    return saved ? { ...item, amount: saved.amount ?? '' } : item;
  });
}

function areaFromReview(review) {
  return {
    total_indoor_area_sqft: review?.totalIndoorAreaSqft ?? '',
    total_area_sqft: review?.totalAreaSqft ?? '',
    covers: review?.covers ?? '',
  };
}

function milestonesFromReview(review) {
  return {
    initialization_date: review?.initializationDate || '',
    expected_completion_date: review?.expectedCompletionDate || '',
    inspection_date: review?.inspectionDate || '',
    final_completion_date: review?.finalCompletionDate || '',
  };
}

const MILESTONE_DRAFT_FIELDS = [
  {
    field: 'initialization_date',
    prop: 'initializationDate',
    canSave: (review, executionUnlocked) => executionUnlocked,
  },
  {
    field: 'expected_completion_date',
    prop: 'expectedCompletionDate',
    canSave: (review, executionUnlocked) => executionUnlocked && review?.initializationStatus === 'approved',
  },
  {
    field: 'inspection_date',
    prop: 'inspectionDate',
    canSave: (review, executionUnlocked) => executionUnlocked && review?.expectedCompletionStatus === 'approved',
  },
  {
    field: 'final_completion_date',
    prop: 'finalCompletionDate',
    canSave: (review, executionUnlocked) => executionUnlocked && review?.qualityAuditStatus === 'approved',
  },
];

function formatMoney(value) {
  if (value == null || value === '') return 'Not set';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not set';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// Indian-grouped rupee value for the live header total and the read-only
// metrics (e.g. 804670 -> "₹8,04,670").
function formatINR(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₹0';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// A calculated ratio renders the rupee value, or "—" when its divisor is
// missing / zero (so we never show Infinity or NaN).
function formatRatio(numerator, divisor) {
  const d = Number(divisor);
  if (!Number.isFinite(d) || d === 0) return '—';
  return formatINR(numerator / d);
}

function statusPill(value, tone = 'var(--zm-accent)') {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 24,
      padding: '0 10px',
      borderRadius: 4,
      border: `1px solid ${tone}`,
      color: tone,
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 800,
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {String(value || 'pending').replace(/_/g, ' ')}
    </span>
  );
}

function FieldCard({ title, children, right }) {
  return (
    <section className="zm-glass" style={{
      padding: 18,
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <h2 style={{
          margin: 0,
          fontFamily: 'var(--zm-font-body)',
          fontSize: 15,
          fontWeight: 900,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--zm-fg)',
        }}>
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function ActionButton({ children, onClick, disabled, variant = 'primary' }) {
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 36,
        padding: '0 14px',
        borderRadius: 8,
        border: primary ? 'none' : '1px solid var(--zm-line)',
        background: primary ? 'var(--zm-accent)' : 'var(--zm-surface)',
        color: primary ? '#fff' : 'var(--zm-fg)',
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12,
        fontWeight: 850,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function ProjectReviewPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { role, dark } = useSession();
  const isSupervisor = role === 'supervisor';
  const [state, setState] = React.useState({ status: 'loading', review: null, error: null });
  const [team, setTeam] = React.useState([]);
  const [delegateId, setDelegateId] = React.useState('');
  const [budget, setBudget] = React.useState(DEFAULT_BUDGET);
  const [areaInputs, setAreaInputs] = React.useState({
    total_indoor_area_sqft: '',
    total_area_sqft: '',
    covers: '',
  });
  const [milestones, setMilestones] = React.useState({
    initialization_date: '',
    expected_completion_date: '',
    inspection_date: '',
    final_completion_date: '',
  });
  const [busy, setBusy] = React.useState(false);
  const [budgetDirty, setBudgetDirty] = React.useState(false);
  const [milestonesDirty, setMilestonesDirty] = React.useState(false);

  const rehydrateReview = React.useCallback((review) => {
    setBudget(budgetFromReview(review));
    setAreaInputs(areaFromReview(review));
    setMilestones(milestonesFromReview(review));
    setBudgetDirty(false);
    setMilestonesDirty(false);
    setState({ status: 'ready', review, error: null });
  }, []);

  const load = React.useCallback((silent = false) => {
    let cancelled = false;
    if (!silent) setState((prev) => ({ ...prev, status: 'loading', error: null }));
    getProject(siteId)
      .then((review) => {
        if (cancelled) return;
        rehydrateReview(review);
      })
      .catch((err) => {
        if (!cancelled) {
          const error = err?.detail || err?.message || 'Failed to load project';
          if (silent) setState((prev) => ({ ...prev, error }));
          else setState({ status: 'error', review: null, error });
        }
      });
    return () => { cancelled = true; };
  }, [siteId, rehydrateReview]);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(React.useCallback(() => load(true), [load]), {
    siteId,
    sources: ['project', 'businessAdmin', 'design'],
    skipWhen: () => budgetDirty || milestonesDirty || busy,
  });

  React.useEffect(() => {
    if (!isSupervisor) return;
    let cancelled = false;
    listMyTeam('project')
      .then((rows) => { if (!cancelled) setTeam(rows || []); })
      .catch(() => { if (!cancelled) setTeam([]); });
    return () => { cancelled = true; };
  }, [isSupervisor]);

  const mutate = async (fn) => {
    setBusy(true);
    try {
      const next = await fn();
      rehydrateReview(next);
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.detail || err?.message || 'Action failed' }));
    } finally {
      setBusy(false);
    }
  };

  const review = state.review;
  const budgetTotal = budget.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const amountAt = (idx) => Number(budget.find((item) => item.idx === idx)?.amount) || 0;
  const civilMepSum = CIVIL_MEP_IDX.reduce((sum, idx) => sum + amountAt(idx), 0);
  // Payload shared by every save/submit path so the area / cover inputs always
  // travel with the budget items.
  const budgetPayload = {
    items: budget,
    totalIndoorAreaSqft: areaInputs.total_indoor_area_sqft,
    totalAreaSqft: areaInputs.total_area_sqft,
    covers: areaInputs.covers,
  };
  const executionUnlocked = review?.budgetStatus === 'approved';
  const budgetEditable = review ? ['draft', 'rejected'].includes(review.budgetStatus) : false;
  const budgetLockedReason = review?.budgetStatus === 'pending_supervisor'
    ? 'Budget is awaiting supervisor review and is read-only until it is sent back.'
    : review?.budgetStatus === 'pending_admin'
      ? 'Budget is awaiting business-admin review and is read-only until it is sent back.'
      : review?.budgetStatus === 'approved'
        ? 'Budget is approved and locked.'
        : null;

  const handleBackToQueue = async () => {
    if ((!budgetDirty || !budgetEditable) && !milestonesDirty) {
      navigate(ROUTES.PROJECT);
      return;
    }
    setBusy(true);
    try {
      let next = review;
      if (budgetDirty && budgetEditable) {
        next = await saveProjectBudget(siteId, { ...budgetPayload, action: 'save' });
      }
      if (milestonesDirty && executionUnlocked) {
        for (const item of MILESTONE_DRAFT_FIELDS) {
          const value = milestones[item.field];
          const previous = review?.[item.prop] || '';
          if (value && value !== previous && item.canSave(review, executionUnlocked)) {
            next = await submitProjectMilestone(siteId, item.field, value);
          }
        }
      }
      rehydrateReview(next);
      navigate(ROUTES.PROJECT);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.detail || err?.message || 'Could not save the project draft before returning to queue.',
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 09"
        eyebrow="Project module"
        title={review ? `${review.siteName} project` : 'Project execution'}
        lede={review ? `${review.city} · ${review.siteCode}` : 'Budget and execution workflow.'}
        right={<HeaderTag icon="box" label={review?.projectStatus || 'PROJECT'}/>}
      />

      {state.status === 'loading' && (
        <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
          Loading project...
        </div>
      )}

      {state.error && (
        <div className="zm-glass" style={{ padding: 16, color: 'var(--zm-danger)' }}>
          {state.error}
        </div>
      )}

      {review && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18 }}>
            <FieldCard
              title="Ownership"
              right={statusPill(review.projectStatus, review.projectStatus === 'done' ? 'var(--zm-success)' : 'var(--zm-accent)')}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                <div>
                  <div className="zm-label">Allocated to</div>
                  <strong>{review.allocatedToName || 'Not allocated'}</strong>
                </div>
                <div>
                  <div className="zm-label">Budget</div>
                  <strong>{String(review.budgetStatus || 'draft').replace(/_/g, ' ')}</strong>
                </div>
                <div>
                  <div className="zm-label">Budget total</div>
                  <strong>{formatMoney(review.budgetTotal ?? budgetTotal)}</strong>
                </div>
              </div>
              {isSupervisor && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={delegateId}
                    onChange={(e) => setDelegateId(e.target.value)}
                    style={{
                      minWidth: 260,
                      height: 38,
                      border: '1px solid var(--zm-line)',
                      borderRadius: 8,
                      padding: '0 10px',
                      background: 'var(--zm-surface)',
                      color: 'var(--zm-fg)',
                      fontFamily: 'var(--zm-font-body)',
                      colorScheme: dark ? 'dark' : 'light',
                    }}
                  >
                    <option value="">Choose project executive...</option>
                    {team.map((member) => (
                      <option key={member.id} value={member.id}>{member.name || member.email}</option>
                    ))}
                  </select>
                  <ActionButton disabled={!delegateId || busy} onClick={() => mutate(() => allocateProject(siteId, delegateId))}>
                    Allocate
                  </ActionButton>
                </div>
              )}
            </FieldCard>

            <FieldCard title="Gate status">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {statusPill(`Design ${review.designStatus}`, review.designStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)')}
                {statusPill(`Budget ${review.budgetStatus}`, review.budgetStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)')}
                {statusPill(`Stage ${review.currentStage}`, review.currentStage === 'done' ? 'var(--zm-success)' : 'var(--zm-accent)')}
              </div>
            </FieldCard>
          </div>

          <FieldCard
            title="Estimated budget"
            right={<span style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 900 }}>{formatMoney(budgetTotal)}</span>}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 10 }}>
              {budget.map((item, index) => (
                <label key={item.idx} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(140px, 1fr) 120px',
                  gap: 10,
                  alignItems: 'center',
                }}>
                  <span style={{ fontWeight: 750 }}>{index + 1}. {item.label}</span>
                  <input
                    value={item.amount}
                    inputMode="decimal"
                    onChange={(e) => {
                      setBudgetDirty(true);
                      setBudget((rows) => rows.map((row) => row.idx === item.idx ? { ...row, amount: e.target.value } : row));
                    }}
                    disabled={busy || !budgetEditable}
                    placeholder="0"
                    style={{
                      height: 36,
                      border: '1px solid var(--zm-line)',
                      borderRadius: 8,
                      padding: '0 10px',
                      fontFamily: 'var(--zm-font-mono)',
                      background: budgetEditable ? 'var(--zm-surface)' : 'var(--zm-surface-2)',
                      color: budgetEditable ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
                    }}
                  />
                </label>
              ))}
            </div>

            {/* Area & cover inputs — saved with the budget; drive the metrics below. */}
            <div style={{ height: 1, background: 'var(--zm-line)', opacity: 0.6 }} />
            <div className="zm-label">Area &amp; covers</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 10 }}>
              <NumberField
                label="Total Indoor Area"
                hint="(sqft)"
                value={areaInputs.total_indoor_area_sqft}
                editable={budgetEditable}
                disabled={busy || !budgetEditable}
                onChange={(v) => { setBudgetDirty(true); setAreaInputs((a) => ({ ...a, total_indoor_area_sqft: v })); }}
              />
              <NumberField
                label="Total Area"
                hint="(sqft)"
                value={areaInputs.total_area_sqft}
                editable={budgetEditable}
                disabled={busy || !budgetEditable}
                onChange={(v) => { setBudgetDirty(true); setAreaInputs((a) => ({ ...a, total_area_sqft: v })); }}
              />
              <NumberField
                label="Number of Covers"
                value={areaInputs.covers}
                editable={budgetEditable}
                disabled={busy || !budgetEditable}
                onChange={(v) => { setBudgetDirty(true); setAreaInputs((a) => ({ ...a, covers: v })); }}
              />
            </div>

            {/* Auto-calculated, read-only. Recompute live; "—" when divisor is empty/0. */}
            <div className="zm-label">Calculated metrics · read-only</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 10 }}>
              <MetricField
                label="Civil, Interior & MEP Cost per sqft"
                value={formatRatio(civilMepSum, areaInputs.total_indoor_area_sqft)}
              />
              <MetricField
                label="CAPEX Cost per sqft"
                value={formatRatio(budgetTotal, areaInputs.total_area_sqft)}
              />
              <MetricField
                label="CAPEX per Cover"
                value={formatRatio(budgetTotal, areaInputs.covers)}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {budgetEditable && (
                <>
                  <ActionButton disabled={busy} variant="ghost" onClick={() => mutate(() => saveProjectBudget(siteId, { ...budgetPayload, action: 'save' }))}>
                    Save budget draft
                  </ActionButton>
                  <ActionButton disabled={busy} onClick={() => mutate(() => saveProjectBudget(siteId, { ...budgetPayload, action: 'submit' }))}>
                    Submit budget
                  </ActionButton>
                </>
              )}
              {!budgetEditable && budgetLockedReason && (
                <div style={{
                  minHeight: 36,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--zm-line)',
                  background: 'var(--zm-surface-2)',
                  color: 'var(--zm-fg-3)',
                  fontSize: 12.5,
                }}>
                  {budgetLockedReason}
                </div>
              )}
              {isSupervisor && review.budgetStatus === 'pending_supervisor' && (
                <>
                  <ActionButton disabled={busy} onClick={() => mutate(() => reviewProjectBudget(siteId, { decision: 'approve' }))}>
                    Approve to admin
                  </ActionButton>
                  <ActionButton disabled={busy} variant="ghost" onClick={() => mutate(() => reviewProjectBudget(siteId, { decision: 'reject', comments: 'Budget needs revision.' }))}>
                    Reject
                  </ActionButton>
                </>
              )}
            </div>
          </FieldCard>

          <FieldCard title="Execution milestones" right={statusPill(executionUnlocked ? 'Execution open' : 'Budget locked', executionUnlocked ? 'var(--zm-success)' : 'var(--zm-copper)')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))', gap: 12 }}>
              <Milestone
                label="Initialization date"
                field="initialization_date"
                value={milestones.initialization_date}
                status={review.initializationStatus}
                disabled={!executionUnlocked || busy}
                dark={dark}
                onChange={(value) => {
                  setMilestonesDirty(true);
                  setMilestones((v) => ({ ...v, initialization_date: value }));
                }}
                onSubmit={() => mutate(() => submitProjectMilestone(siteId, 'initialization_date', milestones.initialization_date))}
                onApprove={isSupervisor && review.initializationStatus === 'submitted' ? () => mutate(() => reviewProjectMilestone(siteId, 'initialization_date', { decision: 'approve' })) : null}
                onReject={isSupervisor && review.initializationStatus === 'submitted' ? () => mutate(() => reviewProjectMilestone(siteId, 'initialization_date', { decision: 'reject', comments: 'Initialization date needs revision.' })) : null}
              />
              <Milestone
                label="Expected completion"
                field="expected_completion_date"
                value={milestones.expected_completion_date}
                status={review.expectedCompletionStatus}
                disabled={!executionUnlocked || review.initializationStatus !== 'approved' || busy}
                dark={dark}
                onChange={(value) => {
                  setMilestonesDirty(true);
                  setMilestones((v) => ({ ...v, expected_completion_date: value }));
                }}
                onSubmit={() => mutate(() => submitProjectMilestone(siteId, 'expected_completion_date', milestones.expected_completion_date))}
                onApprove={isSupervisor && review.expectedCompletionStatus === 'submitted' ? () => mutate(() => reviewProjectMilestone(siteId, 'expected_completion_date', { decision: 'approve' })) : null}
                onReject={isSupervisor && review.expectedCompletionStatus === 'submitted' ? () => mutate(() => reviewProjectMilestone(siteId, 'expected_completion_date', { decision: 'reject', comments: 'Expected completion needs revision.' })) : null}
              />
              <Milestone
                label="Inspection date"
                field="inspection_date"
                value={milestones.inspection_date}
                status={review.inspectionDate ? 'recorded' : 'pending'}
                disabled={!executionUnlocked || review.expectedCompletionStatus !== 'approved' || busy}
                dark={dark}
                onChange={(value) => {
                  setMilestonesDirty(true);
                  setMilestones((v) => ({ ...v, inspection_date: value }));
                }}
                onSubmit={() => mutate(() => submitProjectMilestone(siteId, 'inspection_date', milestones.inspection_date))}
              />
              <div className="zm-glass" style={{ padding: 14, borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong>Quality audit</strong>
                  {statusPill(review.qualityAuditStatus, review.qualityAuditStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)')}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <ActionButton disabled={!executionUnlocked || !review.inspectionDate || busy} variant="ghost" onClick={() => mutate(() => pushQualityAudit(siteId))}>
                    Push audit
                  </ActionButton>
                  {isSupervisor && review.qualityAuditStatus === 'submitted' && (
                    <>
                      <ActionButton disabled={busy} onClick={() => mutate(() => reviewQualityAudit(siteId, { decision: 'approve' }))}>Approve</ActionButton>
                      <ActionButton disabled={busy} variant="ghost" onClick={() => mutate(() => reviewQualityAudit(siteId, { decision: 'reject', comments: 'Quality audit needs correction.' }))}>Reject</ActionButton>
                    </>
                  )}
                </div>
              </div>
              <Milestone
                label="Final completion"
                field="final_completion_date"
                value={milestones.final_completion_date}
                status={review.finalCompletionDate ? 'done' : 'pending'}
                disabled={!executionUnlocked || review.qualityAuditStatus !== 'approved' || busy}
                dark={dark}
                onChange={(value) => {
                  setMilestonesDirty(true);
                  setMilestones((v) => ({ ...v, final_completion_date: value }));
                }}
                onSubmit={() => mutate(() => submitProjectMilestone(siteId, 'final_completion_date', milestones.final_completion_date))}
              />
            </div>
          </FieldCard>

          <button
            type="button"
            onClick={handleBackToQueue}
            disabled={busy}
            style={{
              alignSelf: 'flex-start',
              height: 38,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid var(--zm-line)',
              background: 'var(--zm-surface)',
              color: 'var(--zm-fg)',
              fontFamily: 'var(--zm-font-body)',
              fontWeight: 800,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy && (budgetDirty || milestonesDirty) ? 'Saving draft...' : 'Back to project queue'}
          </button>
        </>
      )}
    </div>
  );
}

function Milestone({ label, value, status, disabled, dark, onChange, onSubmit, onApprove, onReject }) {
  return (
    <div className="zm-glass" style={{ padding: 14, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>{label}</strong>
        {statusPill(status, status === 'approved' || status === 'done' || status === 'recorded' ? 'var(--zm-success)' : 'var(--zm-copper)')}
      </div>
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          height: 36,
          border: '1px solid var(--zm-line)',
          borderRadius: 8,
          padding: '0 10px',
          background: 'var(--zm-surface)',
          color: 'var(--zm-fg)',
          fontFamily: 'var(--zm-font-body)',
          colorScheme: dark ? 'dark' : 'light',
        }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ActionButton disabled={disabled || !value} variant="ghost" onClick={onSubmit}>Save</ActionButton>
        {onApprove && <ActionButton onClick={onApprove}>Approve</ActionButton>}
        {onReject && <ActionButton variant="ghost" onClick={onReject}>Reject</ActionButton>}
      </div>
    </div>
  );
}

// Plain numeric input (sqft / covers). Mirrors the budget-amount input styling
// so the editable / locked states match the rest of the budget card.
function NumberField({ label, hint, value, editable, disabled, onChange }) {
  return (
    <label style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(140px, 1fr) 120px',
      gap: 10,
      alignItems: 'center',
    }}>
      <span style={{ fontWeight: 750 }}>
        {label}
        {hint && <span style={{ color: 'var(--zm-fg-3)', fontWeight: 600 }}> {hint}</span>}
      </span>
      <input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0"
        style={{
          height: 36,
          border: '1px solid var(--zm-line)',
          borderRadius: 8,
          padding: '0 10px',
          fontFamily: 'var(--zm-font-mono)',
          background: editable ? 'var(--zm-surface)' : 'var(--zm-surface-2)',
          color: editable ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
        }}
      />
    </label>
  );
}

// Read-only calculated metric — dashed border + muted fill marks it as
// non-editable, value in mono on the right.
function MetricField({ label, value }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(140px, 1fr) auto',
      gap: 10,
      alignItems: 'center',
      minHeight: 44,
      padding: '6px 12px',
      borderRadius: 8,
      border: '1px dashed var(--zm-line)',
      background: 'var(--zm-surface-2)',
    }}>
      <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--zm-fg-3)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 900, color: 'var(--zm-fg)' }}>{value}</span>
    </div>
  );
}
