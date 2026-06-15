import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { listMyTeam } from '../../services/api/adapters/httpAdapter.js';
import {
  allocateProject,
  finalizeInitialization,
  getProject,
  proposeInitialization,
  respondInitialization,
  reviewProjectMilestone,
  setMidProjectVisit,
  submitProjectMilestone,
  submitQualityAuditInspectionDate,
  supervisorApproveQualityAudit,
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

// Local (timezone-safe) yyyy-mm-dd helpers for date inputs / presets.
function toISODate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDaysISO(isoDate, days) {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// yyyy-mm-dd for today + N days (timezone-safe). Used for initialization-date
// presets; +2 days is the default.
function todayPlusISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

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
  const [busy, setBusy] = React.useState(false);
  const [budgetDirty, setBudgetDirty] = React.useState(false);

  const rehydrateReview = React.useCallback((review) => {
    setBudget(budgetFromReview(review));
    setAreaInputs(areaFromReview(review));
    setBudgetDirty(false);
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
    skipWhen: () => budgetDirty || busy,
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
  // The 11-item budget now lives in Project Excellence (filled after GFC). It is
  // READ-ONLY here — the project just displays the approved figures.
  const budgetEditable = false;
  const budgetLockedReason = review?.budgetStatus === 'approved'
    ? 'Budget approved in Project Excellence — shown read-only.'
    : 'Budget is managed in Project Excellence (post-GFC). Execution unlocks once it is approved.';

  const handleBackToQueue = () => {
    navigate(ROUTES.PROJECT);
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
              {budgetLockedReason && (
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
            </div>
          </FieldCard>

          <ExecutionSection
            review={review}
            siteId={siteId}
            isSupervisor={isSupervisor}
            dark={dark}
            busy={busy}
            mutate={mutate}
          />

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
            {busy && budgetDirty ? 'Saving draft...' : 'Back to project queue'}
          </button>
        </>
      )}
    </div>
  );
}

const zmDateStyle = (dark) => ({
  height: 36,
  border: '1px solid var(--zm-line)',
  borderRadius: 8,
  padding: '0 10px',
  background: 'var(--zm-surface)',
  color: 'var(--zm-fg)',
  fontFamily: 'var(--zm-font-body)',
  colorScheme: dark ? 'dark' : 'light',
});

const muted = { color: 'var(--zm-fg-3)', fontSize: 12.5 };

function presetPill(active) {
  return {
    height: 34,
    padding: '0 12px',
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
    background: active ? 'var(--zm-accent)' : 'var(--zm-surface)',
    color: active ? '#fff' : 'var(--zm-fg)',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 800,
    fontSize: 12,
    cursor: 'pointer',
  };
}

function fmtDate(d) {
  if (!d) return '—';
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StageCard({ title, status, tone, locked, children }) {
  return (
    <div className="zm-glass" style={{
      padding: 14, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10,
      opacity: locked ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>{title}</strong>
        {status != null && statusPill(status, tone)}
      </div>
      {children}
    </div>
  );
}

// Lightweight inline modal for capturing a rejection reason.
function ReasonModal({ title, label, confirmLabel, dark, busy, onConfirm, onClose }) {
  const [text, setText] = React.useState('');
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)', backdropFilter: 'blur(6px)',
      zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14,
        width: 'min(460px, 96vw)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
        boxShadow: 'var(--zm-shadow-pop)',
      }}>
        <strong style={{ fontSize: 15 }}>{title}</strong>
        <span style={muted}>{label}</span>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
          placeholder="Reason (required)"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg)',
            fontFamily: 'var(--zm-font-body)', fontSize: 13, resize: 'vertical',
            colorScheme: dark ? 'dark' : 'light',
          }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <ActionButton variant="ghost" disabled={busy} onClick={onClose}>Cancel</ActionButton>
          <ActionButton disabled={busy || !text.trim()} onClick={() => onConfirm(text.trim())}>{confirmLabel}</ActionButton>
        </div>
      </div>
    </div>
  );
}

// Post budget-approval execution flow: init date (admin-proposed → exec accept/
// reject → supervisor finalize) → expected completion → mid-project visit →
// quality audit → push to NSO. Local input state is independent of `review` so
// silent background refreshes don't clobber in-progress typing.
function ExecutionSection({ review, siteId, isSupervisor, dark, busy, mutate }) {
  const unlocked = review.budgetStatus === 'approved';
  const initStatus = review.initializationStatus;
  const initApproved = initStatus === 'approved';
  const expStatus = review.expectedCompletionStatus;
  const expApproved = expStatus === 'approved';
  const visitSet = !!review.midProjectVisitDate;
  const qaStatus = review.qualityAuditStatus;
  const done = review.projectStatus === 'done' || review.nsoStatus === 'pushed';

  const [expDate, setExpDate] = React.useState('');
  const [visitDate, setVisitDate] = React.useState('');
  const [finalInitDate, setFinalInitDate] = React.useState('');
  // Supervisor's proposed init date when the PE handover left it unset; defaults
  // to today + 2 days (the same default the admin approval panel uses).
  const [proposeInitDate, setProposeInitDate] = React.useState(() => todayPlusISO(2));
  const [auditFile, setAuditFile] = React.useState(null);
  const [inspectionDate, setInspectionDate] = React.useState('');
  const [modal, setModal] = React.useState(null);

  const tone = (ok) => (ok ? 'var(--zm-success)' : 'var(--zm-copper)');

  if (!unlocked) {
    return (
      <FieldCard title="Execution" right={statusPill('Budget locked', 'var(--zm-copper)')}>
        <div style={muted}>Execution opens once the budget is approved.</div>
      </FieldCard>
    );
  }

  // Guard: if no executive is allocated yet, surface a clear prompt rather
  // than letting every stage silently say "awaiting executive".
  const hasExecutive = !!review.allocatedTo;

  return (
    <FieldCard title="Execution" right={statusPill(done ? 'Project complete' : 'In progress', done ? 'var(--zm-success)' : 'var(--zm-accent)')}>
      {!hasExecutive && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(224, 162, 60, 0.12)',
          border: '1px solid rgba(224, 162, 60, 0.35)',
          color: 'var(--zm-copper)',
          fontSize: 12.5,
          fontWeight: 700,
        }}>
          ⚠ No project executive allocated — use the Ownership panel above to assign one before execution can proceed.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        <StageCard title="1 · Initialization date" status={initStatus} tone={tone(initApproved)}>
          <div style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 800 }}>{fmtDate(review.initializationDate)}</div>
          {(!initStatus || initStatus === 'pending') && (
            isSupervisor ? (
              <>
                <span style={muted}>No initialization date was set during budget approval. Propose one to start execution — it goes to the executive to accept.</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {[2, 7, 14].map((n) => {
                    const d = todayPlusISO(n);
                    return <button key={n} type="button" onClick={() => setProposeInitDate(d)} style={presetPill(proposeInitDate === d)}>+{n} days</button>;
                  })}
                  <input type="date" value={proposeInitDate} onChange={(e) => setProposeInitDate(e.target.value)} style={zmDateStyle(dark)} />
                  <ActionButton disabled={busy || !proposeInitDate} onClick={() => mutate(() => proposeInitialization(siteId, proposeInitDate))}>Propose date</ActionButton>
                </div>
              </>
            ) : <span style={muted}>Awaiting the supervisor to set the initialization date.</span>
          )}
          {initStatus === 'proposed' && !isSupervisor && (
            <>
              <span style={muted}>Proposed initialization date. Accept to confirm, or reject with a reason.</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ActionButton disabled={busy} onClick={() => mutate(() => respondInitialization(siteId, { decision: 'approve' }))}>Accept</ActionButton>
                <ActionButton variant="ghost" disabled={busy} onClick={() => setModal('init-reject')}>Reject</ActionButton>
              </div>
            </>
          )}
          {initStatus === 'proposed' && isSupervisor && (
            hasExecutive
              ? <span style={muted}>Awaiting the executive's response.</span>
              : <span style={{ color: 'var(--zm-copper)', fontSize: 12.5 }}>Allocate an executive above — they must accept this date before execution can continue.</span>
          )}
          {initStatus === 'rejected' && (
            <>
              <span style={{ color: 'var(--zm-danger)', fontSize: 12.5 }}>Returned by executive: {review.initializationComments || '—'}</span>
              {isSupervisor ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="date" value={finalInitDate} onChange={(e) => setFinalInitDate(e.target.value)} style={zmDateStyle(dark)} />
                  <ActionButton disabled={busy || !finalInitDate} onClick={() => mutate(() => finalizeInitialization(siteId, finalInitDate))}>Set final date</ActionButton>
                </div>
              ) : <span style={muted}>Awaiting the supervisor's revised date.</span>}
            </>
          )}
        </StageCard>

        <StageCard title="2 · Expected completion" status={initApproved ? expStatus : null} tone={tone(expApproved)} locked={!initApproved}>
          {!initApproved ? (
            <span style={muted}>Unlocks after the initialization date is confirmed.</span>
          ) : expApproved ? (
            <div style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 800 }}>{fmtDate(review.expectedCompletionDate)}</div>
          ) : expStatus === 'submitted' ? (
            <>
              <div style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 800 }}>{fmtDate(review.expectedCompletionDate)}</div>
              {isSupervisor ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ActionButton disabled={busy} onClick={() => mutate(() => reviewProjectMilestone(siteId, 'expected_completion_date', { decision: 'approve' }))}>Approve</ActionButton>
                  <ActionButton variant="ghost" disabled={busy} onClick={() => setModal('exp-reject')}>Reject</ActionButton>
                </div>
              ) : <span style={muted}>Awaiting supervisor approval.</span>}
            </>
          ) : !isSupervisor ? (
            <>
              {expStatus === 'rejected' && review.expectedCompletionComments && (
                <span style={{ color: 'var(--zm-danger)', fontSize: 12.5 }}>Returned: {review.expectedCompletionComments}</span>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {[30, 45, 60].map((n) => {
                  const d = addDaysISO(review.initializationDate, n);
                  return <button key={n} type="button" onClick={() => setExpDate(d)} style={presetPill(!!d && expDate === d)}>+{n} days</button>;
                })}
                <input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} style={zmDateStyle(dark)} />
              </div>
              {expDate && <span style={muted}>Expected completion: {fmtDate(expDate)}</span>}
              <ActionButton disabled={busy || !expDate} onClick={() => mutate(() => submitProjectMilestone(siteId, 'expected_completion_date', expDate))}>Push to supervisor</ActionButton>
            </>
          ) : hasExecutive
              ? <span style={muted}>Awaiting the executive to set the expected completion.</span>
              : <span style={{ color: 'var(--zm-copper)', fontSize: 12.5 }}>Allocate an executive above to proceed.</span>}
        </StageCard>

        <StageCard title="3 · Mid-project visit" status={expApproved ? (visitSet ? 'scheduled' : 'pending') : null} tone={tone(visitSet)} locked={!expApproved}>
          {!expApproved ? (
            <span style={muted}>Unlocks after expected completion is approved.</span>
          ) : isSupervisor ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={visitDate || review.midProjectVisitDate || ''} onChange={(e) => setVisitDate(e.target.value)} style={zmDateStyle(dark)} />
              <ActionButton disabled={busy || !(visitDate || review.midProjectVisitDate)} onClick={() => mutate(() => setMidProjectVisit(siteId, visitDate || review.midProjectVisitDate))}>
                {visitSet ? 'Update visit date' : 'Set visit date'}
              </ActionButton>
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--zm-font-mono)', fontWeight: 800, color: visitSet ? 'var(--zm-accent)' : 'var(--zm-fg-3)' }}>
              {visitSet ? `Visit scheduled: ${fmtDate(review.midProjectVisitDate)}` : 'Awaiting the supervisor to schedule the visit.'}
            </div>
          )}
        </StageCard>

        <StageCard title="4 · Quality audit" status={visitSet ? qaStatus : null} tone={tone(qaStatus === 'approved')} locked={!visitSet}>
          {!visitSet ? (
            <span style={muted}>Unlocks after the mid-project visit date is set.</span>
          ) : qaStatus === 'approved' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: 'var(--zm-success)', fontWeight: 700 }}>Audit confirmed by business-admin · project complete.</span>
              <span style={muted}>Inspection date: {fmtDate(review.inspectionDate)}</span>
              <span style={muted}>Open the NSO Handover tab to push this site to NSO.</span>
            </div>
          ) : qaStatus === 'supervisor_approved' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={muted}>Inspection date: {fmtDate(review.inspectionDate)}</span>
              <span style={{ color: 'var(--zm-copper)', fontSize: 12.5 }}>Approved by supervisor — awaiting business-admin confirmation.</span>
            </div>
          ) : qaStatus === 'submitted' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={muted}>Inspection date: {fmtDate(review.inspectionDate)}</span>
              {isSupervisor ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ActionButton disabled={busy} onClick={() => mutate(() => supervisorApproveQualityAudit(siteId, { decision: 'approve' }))}>Approve</ActionButton>
                  <ActionButton variant="ghost" disabled={busy} onClick={() => setModal('qa-reject')}>Reject</ActionButton>
                </div>
              ) : <span style={muted}>Awaiting supervisor approval.</span>}
            </div>
          ) : !isSupervisor ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {qaStatus === 'rejected' && review.qualityAuditComments && (
                <span style={{ color: 'var(--zm-danger)', fontSize: 12.5 }}>Returned: {review.qualityAuditComments}</span>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--zm-fg-3)', fontSize: 12 }}>Inspection date</span>
                <input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} style={zmDateStyle(dark)} />
              </label>
              <ActionButton disabled={busy || !inspectionDate} onClick={() => mutate(() => submitQualityAuditInspectionDate(siteId, inspectionDate))}>Submit for approval</ActionButton>
            </div>
          ) : hasExecutive
              ? <span style={muted}>Awaiting the executive to set the inspection date.</span>
              : <span style={{ color: 'var(--zm-copper)', fontSize: 12.5 }}>Allocate an executive above to proceed.</span>}
        </StageCard>
      </div>

      {modal === 'init-reject' && (
        <ReasonModal title="Reject initialization date" label="This returns the date to the supervisor to set a new one." confirmLabel="Reject date" dark={dark} busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(reason) => { setModal(null); mutate(() => respondInitialization(siteId, { decision: 'reject', comments: reason })); }} />
      )}
      {modal === 'exp-reject' && (
        <ReasonModal title="Reject expected completion" label="This returns it to the executive to revise." confirmLabel="Reject" dark={dark} busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(reason) => { setModal(null); mutate(() => reviewProjectMilestone(siteId, 'expected_completion_date', { decision: 'reject', comments: reason })); }} />
      )}
      {modal === 'qa-reject' && (
        <ReasonModal title="Reject quality audit" label="This returns it to the executive to re-enter the inspection date." confirmLabel="Reject" dark={dark} busy={busy}
          onClose={() => setModal(null)}
          onConfirm={(reason) => { setModal(null); mutate(() => supervisorApproveQualityAudit(siteId, { decision: 'reject', comments: reason })); }} />
      )}
    </FieldCard>
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
