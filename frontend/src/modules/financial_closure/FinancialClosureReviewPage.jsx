import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { usePageContext } from '../../App.jsx';
import { listMyTeam } from '../../services/api/adapters/httpAdapter.js';
import {
  getFC,
  allocateFC,
  revokeFCAllocation,
  saveFCBudget,
  reviewFCBudget,
  finalizeFinancialClosure,
} from '../../services/api/financialClosureApi.js';
import { ROUTES } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

const DEFAULT_LABELS = [
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
];

// Build the editable 11-line model from the closure state. Each line keeps the
// approved GFC baseline (read-only) alongside the editable "closure actual".
function linesFromState(state) {
  return DEFAULT_LABELS.map((label, index) => {
    const idx = index + 1;
    const saved = state?.lines?.find((row) => Number(row.idx) === idx);
    return {
      idx,
      label: saved?.label || label,
      gfcAmount: saved?.gfcAmount ?? 0,
      closureAmount: saved?.closureAmount == null ? '' : saved.closureAmount,
    };
  });
}

function formatINR(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₹0';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// Variation = closure actual − GFC baseline. Over budget (positive) is red,
// under budget (negative) is green, exactly on budget is muted.
function variationTone(variation) {
  const v = Number(variation) || 0;
  if (v > 0) return 'var(--zm-danger)';
  if (v < 0) return 'var(--zm-success)';
  return 'var(--zm-fg-3)';
}

function formatVariation(variation) {
  const v = Number(variation) || 0;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatINR(Math.abs(v))}`;
}

function statusPill(value, tone = 'var(--zm-accent)') {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
      borderRadius: 4, border: `1px solid ${tone}`, color: tone,
      fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10,
      letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {value}
    </span>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="zm-glass" style={{ padding: 20, borderRadius: 10 }}>
      {title && (
        <div style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--zm-fg-3)', marginBottom: 14,
        }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--zm-line-faint)' }}>
      <span style={{ fontSize: 13, color: 'var(--zm-fg-2)', fontFamily: 'var(--zm-font-body)' }}>{label}</span>
      {children}
    </div>
  );
}

export default function FinancialClosureReviewPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { showToast } = usePageContext();
  const { role, session, user } = useSession();
  const isSupervisor = role === 'supervisor';
  const isBusinessAdmin = role === 'business_admin';
  const myUserId = session?.userId || session?.id || session?.sub || user?.id || null;

  const [state, setState] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const [lines, setLines] = React.useState(() => linesFromState(null));
  const [execList, setExecList] = React.useState([]);
  const [teamError, setTeamError] = React.useState(null);
  const [allocExec, setAllocExec] = React.useState('');
  const [allocNotes, setAllocNotes] = React.useState('');
  const [reviewComments, setReviewComments] = React.useState('');

  const refresh = React.useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTeamError(null);
    Promise.all([
      getFC(siteId),
      // Financial Closure runs inside the Project module (its routes require
      // module='project'), so the allocatable people are the supervisor's
      // PROJECT team. 'financial_closure' is not a membership module — asking
      // for it 404/422s and the list comes back empty.
      // Wrap (don't swallow): a failed team fetch must surface as a visible
      // warning, not a silently-empty allocation list that looks healthy.
      isSupervisor
        ? listMyTeam('project').then((t) => ({ ok: true, team: t })).catch((e) => ({ ok: false, error: e }))
        : Promise.resolve({ ok: true, team: [] }),
    ]).then(([data, teamRes]) => {
      if (cancelled) return;
      setState(data);
      setLines(linesFromState(data));
      if (isSupervisor) {
        if (teamRes.ok) {
          const team = teamRes.team;
          setExecList(Array.isArray(team) ? team : (team?.users || []));
        } else {
          setExecList([]);
          setTeamError(teamRes.error?.detail || teamRes.error?.message || 'Could not load executives to allocate. Try refreshing.');
        }
      }
    }).catch((err) => {
      if (!cancelled) setError(err?.detail || err?.message || 'Failed to load site');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [siteId, isSupervisor]);

  React.useEffect(() => refresh(), [refresh]);
  useSiteDataRefresh(refresh, { sources: ['financial_closure', 'businessAdmin'] });

  const handleClosureChange = (idx, value) => {
    setLines((prev) => prev.map((item) => item.idx === idx ? { ...item, closureAmount: value } : item));
  };

  const handleSaveBudget = async (action = 'save') => {
    setSaving(true);
    setError(null);
    try {
      const data = await saveFCBudget(siteId, {
        action,
        comments: reviewComments || null,
        items: lines.map((item) => ({
          idx: item.idx,
          label: item.label,
          amount: item.closureAmount === '' || item.closureAmount == null ? null : Number(item.closureAmount),
        })),
      });
      setState(data);
      setLines(linesFromState(data));
      if (action === 'submit') {
        setReviewComments('');
        showToast?.('Closure budget submitted for review.', 'success');
        navigate(ROUTES.PROJECT_FINANCIAL_CLOSURE);
      } else {
        showToast?.('Closure budget saved.', 'success');
      }
    } catch (err) {
      setError(err?.detail || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAllocate = async () => {
    if (!allocExec) return;
    const targetUserId = allocExec === '__self__' ? myUserId : allocExec;
    if (!targetUserId) { setError('Could not resolve your user id — refresh and try again.'); return; }
    setSaving(true);
    setError(null);
    try {
      const data = await allocateFC(siteId, targetUserId, allocNotes || undefined);
      setState(data);
      setLines(linesFromState(data));
      setAllocExec('');
      setAllocNotes('');
    } catch (err) {
      setError(err?.detail || err?.message || 'Allocation failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (userId) => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      await revokeFCAllocation(siteId, userId);
      refresh();
    } catch (err) {
      setError(err?.detail || err?.message || 'Revoke failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSupervisorReview = async (decision) => {
    setSaving(true);
    setError(null);
    try {
      const data = await reviewFCBudget(siteId, { decision, comments: reviewComments });
      setState(data);
      setLines(linesFromState(data));
      setReviewComments('');
      showToast?.(decision === 'approve' ? 'Closure budget approved — sent to admin.' : 'Closure budget sent back.', decision === 'approve' ? 'success' : 'danger');
      navigate(ROUTES.PROJECT_FINANCIAL_CLOSURE);
    } catch (err) {
      setError(err?.detail || err?.message || 'Review failed');
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async (decision) => {
    setSaving(true);
    setError(null);
    try {
      const data = await finalizeFinancialClosure(siteId, { decision, comments: reviewComments });
      setState(data);
      setLines(linesFromState(data));
      setReviewComments('');
      showToast?.(decision === 'approve' ? 'Financial closure complete.' : 'Closure sent back.', decision === 'approve' ? 'success' : 'danger');
      navigate(ROUTES.PROJECT_FINANCIAL_CLOSURE);
    } catch (err) {
      setError(err?.detail || err?.message || 'Financial closure failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader file="No. 11" eyebrow="Financial Closure" title="Loading…"/>
      <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
        Loading site details…
      </div>
    </div>
  );

  if (error && !state) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader file="No. 11" eyebrow="Financial Closure" title="Error"/>
      <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{error}</div>
    </div>
  );

  const closureStatus = state?.closureStatus || 'draft';
  // Editing the closure actuals is only permitted in draft/rejected, and only
  // by the worker (supervisor or the allocated executive), never the admin.
  const canEditBudget = !isBusinessAdmin && ['draft', 'rejected'].includes(closureStatus);
  const canSupervisorReview = isSupervisor && closureStatus === 'pending_supervisor';
  const canAdminReview = isBusinessAdmin && closureStatus === 'pending_admin';
  const isClosed = closureStatus === 'approved';

  // Live totals from the in-memory edits, falling back to server totals.
  const gfcTotal = lines.reduce((s, item) => s + (Number(item.gfcAmount) || 0), 0);
  const closureTotal = lines.reduce((s, item) => s + (Number(item.closureAmount) || 0), 0);
  const variationTotal = closureTotal - gfcTotal;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 11"
        eyebrow="Financial Closure"
        title={state?.siteName || siteId}
        onBack={() => navigate(ROUTES.PROJECT_FINANCIAL_CLOSURE)}
        right={<HeaderTag icon="box" label="FINANCIAL CLOSURE"/>}
      />

      {error && (
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{error}</div>
      )}

      {/* Site info */}
      <SectionCard title="Site info">
        <FieldRow label="Code">
          <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 13 }}>{state?.siteCode}</span>
        </FieldRow>
        <FieldRow label="City">
          <span style={{ fontSize: 13 }}>{state?.city}</span>
        </FieldRow>
        <FieldRow label="Launched">
          {statusPill(state?.isLaunched ? 'launched' : 'pending',
            state?.isLaunched ? 'var(--zm-success)' : 'var(--zm-copper)')}
        </FieldRow>
        <FieldRow label="Closure status">
          {statusPill(state?.financialClosureStatus || closureStatus,
            isClosed ? 'var(--zm-success)' : 'var(--zm-copper)')}
        </FieldRow>
        <FieldRow label="Budget status">
          {statusPill(closureStatus,
            isClosed ? 'var(--zm-success)' : 'var(--zm-copper)')}
        </FieldRow>
        {state?.allocatedToName && (
          <FieldRow label="Allocated to">
            <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
              {state.allocatedToName}
              {isSupervisor && state?.allocatedTo && !isClosed && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleRevoke(state.allocatedTo)}
                  style={{
                    height: 24, padding: '0 10px', borderRadius: 6, border: '1px solid var(--zm-line)',
                    background: 'transparent', color: 'var(--zm-danger)', cursor: 'pointer',
                    fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 700,
                  }}
                >
                  Revoke
                </button>
              )}
            </span>
          </FieldRow>
        )}
      </SectionCard>

      {/* Closed → explicit completion banner so the finished state is obvious. */}
      {isClosed && (
        <div className="zm-glass" style={{
          padding: '12px 16px', borderLeft: '3px solid var(--zm-success)',
          color: 'var(--zm-success)', fontFamily: 'var(--zm-font-body)',
          fontSize: 13, fontWeight: 700,
        }}>
          ✓ Financial closure complete — this site is closed.
        </div>
      )}

      {/* Allocation (supervisor only, unallocated sites) */}
      {isSupervisor && !state?.allocatedTo && !isClosed && (
        <SectionCard title="Allocate closure to executive">
          {teamError && (
            <div role="alert" style={{ marginBottom: 10, color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5 }}>
              {teamError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              value={allocExec}
              onChange={(e) => setAllocExec(e.target.value)}
              style={{
                flex: 1, height: 36, padding: '0 10px', borderRadius: 7,
                border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)',
                fontFamily: 'var(--zm-font-body)', fontSize: 13,
              }}
            >
              <option value="">Select executive…</option>
              <option value="__self__">Delegate to self (me)</option>
              {execList.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!allocExec || saving}
              onClick={handleAllocate}
              style={{
                height: 36, padding: '0 16px', borderRadius: 7, border: 'none',
                background: 'var(--zm-accent)', color: '#fff', cursor: 'pointer',
                fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700,
                opacity: !allocExec || saving ? 0.5 : 1,
              }}
            >
              Allocate
            </button>
          </div>
          <input
            type="text"
            value={allocNotes}
            onChange={(e) => setAllocNotes(e.target.value)}
            placeholder="Notes (optional)"
            style={{
              display: 'block', width: '100%', marginTop: 10, height: 36, padding: '0 10px',
              boxSizing: 'border-box', borderRadius: 7, border: '1px solid var(--zm-line)',
              background: 'var(--zm-surface)', color: 'var(--zm-fg)',
              fontFamily: 'var(--zm-font-body)', fontSize: 13,
            }}
          />
        </SectionCard>
      )}

      {/* Closure budget — GFC baseline / Closure actual / Variation */}
      <SectionCard title="Closure budget">
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 10,
          paddingBottom: 8, borderBottom: '1px solid var(--zm-line)',
        }}>
          <div />
          {['GFC', 'Closure actual', 'Variation'].map((h) => (
            <div key={h} style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', textAlign: 'right',
            }}>
              {h}
            </div>
          ))}
        </div>

        {/* Line items */}
        {lines.map((item) => {
          const variation = (Number(item.closureAmount) || 0) - (Number(item.gfcAmount) || 0);
          return (
            <div key={item.idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--zm-fg-2)', display: 'flex', alignItems: 'center' }}>
                <span style={{ color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 11, marginRight: 8 }}>
                  {String(item.idx).padStart(2, '0')}
                </span>
                {item.label}
              </div>

              {/* GFC baseline — read-only */}
              <div style={{
                height: 36, padding: '0 10px', borderRadius: 7, border: '1px solid var(--zm-line-faint)',
                background: 'var(--zm-surface-2)', color: 'var(--zm-fg-2)',
                fontFamily: 'var(--zm-font-mono)', fontSize: 13, textAlign: 'right',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              }}>
                {formatINR(item.gfcAmount)}
              </div>

              {/* Closure actual — editable only in draft/rejected for a worker */}
              {canEditBudget ? (
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={item.closureAmount}
                  onChange={(e) => handleClosureChange(item.idx, e.target.value)}
                  style={{
                    height: 36, padding: '0 10px', borderRadius: 7, border: '1px solid var(--zm-line)',
                    background: 'var(--zm-surface)', color: 'var(--zm-fg)',
                    fontFamily: 'var(--zm-font-mono)', fontSize: 13, textAlign: 'right',
                    boxSizing: 'border-box', width: '100%',
                  }}
                />
              ) : (
                <div style={{
                  height: 36, padding: '0 10px', borderRadius: 7, border: '1px solid var(--zm-line-faint)',
                  background: 'var(--zm-surface-2)', color: 'var(--zm-fg)',
                  fontFamily: 'var(--zm-font-mono)', fontSize: 13, textAlign: 'right',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                }}>
                  {item.closureAmount === '' || item.closureAmount == null ? '—' : formatINR(item.closureAmount)}
                </div>
              )}

              {/* Variation — color coded */}
              <div style={{
                height: 36, padding: '0 10px',
                fontFamily: 'var(--zm-font-mono)', fontSize: 13, fontWeight: 700,
                textAlign: 'right', color: variationTone(variation),
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              }}>
                {formatVariation(variation)}
              </div>
            </div>
          );
        })}

        {/* Totals row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginTop: 12,
          paddingTop: 12, borderTop: '1px solid var(--zm-line)', alignItems: 'center',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)' }}>
            Total
          </div>
          <div style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 13, fontWeight: 700, textAlign: 'right', color: 'var(--zm-fg-2)' }}>
            {formatINR(state?.gfcBudgetTotal ?? gfcTotal)}
          </div>
          <div style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 13, fontWeight: 700, textAlign: 'right', color: 'var(--zm-fg)' }}>
            {formatINR(canEditBudget ? closureTotal : (state?.closureBudgetTotal ?? closureTotal))}
          </div>
          <div style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 13, fontWeight: 800, textAlign: 'right', color: variationTone(canEditBudget ? variationTotal : (state?.variationTotal ?? variationTotal)) }}>
            {formatVariation(canEditBudget ? variationTotal : (state?.variationTotal ?? variationTotal))}
          </div>
        </div>

        {/* Comments (read-only feedback) */}
        {state?.supervisorComments && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--zm-surface-2)', color: 'var(--zm-fg-2)', fontSize: 13 }}>
            <strong>Supervisor comment:</strong> {state.supervisorComments}
          </div>
        )}
        {state?.adminComments && (
          <div style={{ marginTop: 8, padding: 12, borderRadius: 8, background: 'var(--zm-surface-2)', color: 'var(--zm-fg-2)', fontSize: 13 }}>
            <strong>Admin comment:</strong> {state.adminComments}
          </div>
        )}

        {/* Action buttons — closure editor */}
        {canEditBudget && (
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveBudget('save')}
              style={{
                height: 36, padding: '0 18px', borderRadius: 7, border: '1px solid var(--zm-line)',
                background: 'transparent', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveBudget('submit')}
              style={{
                height: 36, padding: '0 18px', borderRadius: 7, border: 'none',
                background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Submit for review
            </button>
          </div>
        )}

        {/* Supervisor review panel */}
        {canSupervisorReview && (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 8, border: '1px solid var(--zm-line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Supervisor review</div>
            <textarea
              value={reviewComments}
              onChange={(e) => setReviewComments(e.target.value)}
              placeholder="Comments (required on reject)"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                borderRadius: 7, border: '1px solid var(--zm-line)', resize: 'vertical',
                background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)',
                fontSize: 13,
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSupervisorReview('approve')}
                style={{ height: 36, padding: '0 18px', borderRadius: 7, border: 'none', background: 'var(--zm-success)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.55 : 1 }}
              >
                {saving ? 'Submitting…' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={saving || !reviewComments.trim()}
                onClick={() => handleSupervisorReview('reject')}
                style={{ height: 36, padding: '0 18px', borderRadius: 7, border: 'none', background: 'var(--zm-danger)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !reviewComments.trim() ? 0.5 : 1 }}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Business-admin review panel — final financial closure */}
        {canAdminReview && (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 8, border: '1px solid var(--zm-line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Business admin review</div>
            <textarea
              value={reviewComments}
              onChange={(e) => setReviewComments(e.target.value)}
              placeholder="Comments (required on reject)"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                borderRadius: 7, border: '1px solid var(--zm-line)', resize: 'vertical',
                background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)',
                fontSize: 13,
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleFinalize('approve')}
                style={{ height: 36, padding: '0 18px', borderRadius: 7, border: 'none', background: 'var(--zm-success)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.55 : 1 }}
              >
                {saving ? 'Finalizing…' : 'Financial Closure'}
              </button>
              <button
                type="button"
                disabled={saving || !reviewComments.trim()}
                onClick={() => handleFinalize('reject')}
                style={{ height: 36, padding: '0 18px', borderRadius: 7, border: 'none', background: 'var(--zm-danger)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !reviewComments.trim() ? 0.5 : 1 }}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {isClosed && (
          <div style={{ marginTop: 18, padding: 12, borderRadius: 8, background: 'var(--zm-surface-2)', color: 'var(--zm-success)', fontSize: 13, fontWeight: 700 }}>
            Financial closure complete. This site is closed.
          </div>
        )}
      </SectionCard>
    </div>
  );
}
