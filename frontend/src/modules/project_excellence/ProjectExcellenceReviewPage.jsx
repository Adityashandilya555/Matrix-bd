// skipcq: JS-0833
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { usePageContext } from '../../App.jsx';
import { listMyTeam } from '../../services/api/adapters/httpAdapter.js';
import {
  allocatePE,
  getPE,
  listPEDelegations,
  reviewPEBudget,
  revokePEAllocation,
  savePEBudget,
  adminReviewPEBudget,
} from '../../services/api/projectExcellenceApi.js';
import { ROUTES } from '../../router/routes.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';
import { CIVIL_MEP_IDX, formatRatio, sumByIdx } from '../../lib/budgetMetrics.js';

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

function budgetFromState(state) {
  return DEFAULT_BUDGET.map((item) => {
    const saved = state?.budgetItems?.find((row) => Number(row.idx) === item.idx);
    return saved ? { ...item, amount: saved.amount ?? '' } : item;
  });
}

function formatINR(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₹0';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
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

export default function ProjectExcellenceReviewPage() {
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

  const [budgetItems, setBudgetItems] = React.useState(DEFAULT_BUDGET);
  const [areaFields, setAreaFields] = React.useState({ total_indoor_area_sqft: '', total_area_sqft: '', covers: '' });
  const [execList, setExecList] = React.useState([]);
  const [teamError, setTeamError] = React.useState(null);
  const [allocExec, setAllocExec] = React.useState('');
  const [allocation, setAllocation] = React.useState(null);
  const [actionError, setActionError] = React.useState(null);
  const [reviewComments, setReviewComments] = React.useState('');

  const refresh = React.useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTeamError(null);
    Promise.all([
      getPE(siteId),
      // Wrap (don't swallow): a failed team fetch must surface as a visible
      // warning, not a silently-empty allocation list that looks healthy.
      !isBusinessAdmin
        ? listMyTeam('project_excellence').then((t) => ({ ok: true, team: t })).catch((e) => ({ ok: false, error: e }))
        : Promise.resolve({ ok: true, team: [] }),
      isSupervisor
        ? listPEDelegations(siteId).then((d) => d.items?.[0] || null).catch(() => null)
        : Promise.resolve(null),
    ]).then(([data, teamRes, deleg]) => {
      if (cancelled) return;
      setAllocation(deleg);
      setState(data);
      setBudgetItems(budgetFromState(data));
      setAreaFields({
        total_indoor_area_sqft: data.totalIndoorAreaSqft ?? '',
        total_area_sqft: data.totalAreaSqft ?? '',
        covers: data.covers ?? '',
      });
      if (!isBusinessAdmin) {
        if (teamRes.ok) {
          // listMyTeam returns a bare array of executives already scoped to this
          // supervisor's project_excellence team (role_in_module='executive');
          // it carries no `role` field, so don't re-filter on one — that emptied
          // the list and left "Allocate" with no executives to pick.
          setExecList(Array.isArray(teamRes.team) ? teamRes.team : []);
          setTeamError(null);
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
  }, [siteId, isBusinessAdmin, isSupervisor]);

  React.useEffect(() => refresh(), [refresh]);
  useSiteDataRefresh(refresh, { sources: ['project_excellence', 'businessAdmin'] });

  const handleBudgetChange = (idx, field, value) => {
    setBudgetItems((prev) => prev.map((item) => item.idx === idx ? { ...item, [field]: value } : item));
  };

  const handleSaveBudget = async (action = 'save') => {
    setSaving(true);
    setError(null);
    try {
      const data = await savePEBudget(siteId, {
        items: budgetItems.map((item) => ({
          idx: item.idx,
          label: item.label,
          amount: item.amount === '' || item.amount == null ? null : Number(item.amount),
        })),
        action,
        totalIndoorAreaSqft: areaFields.total_indoor_area_sqft || null,
        totalAreaSqft: areaFields.total_area_sqft || null,
        covers: areaFields.covers || null,
      });
      setState(data);
      setBudgetItems(budgetFromState(data));
      if (action === 'submit') {
        showToast?.('Budget submitted for review.', 'success');
        navigate(ROUTES.PROJECT_EXCELLENCE);
      } else {
        showToast?.('Budget saved.', 'success');
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
    try {
      const data = await allocatePE(siteId, targetUserId);
      setState(data);
    } catch (err) {
      setError(err?.detail || err?.message || 'Allocation failed');
    } finally {
      setSaving(false);
    }
  };

  const onRevoke = async () => {
    if (!allocation) return;
    setActionError(null);
    setSaving(true);
    try {
      await revokePEAllocation(siteId, allocation.delegateUserId);
      setAllocation(null);
      refresh();
      showToast?.('Allocation revoked.', 'success');
    } catch (err) {
      setActionError(err?.detail || err?.message || 'Revoke failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSupervisorReview = async (decision) => {
    setSaving(true);
    try {
      const data = await reviewPEBudget(siteId, { decision, comments: reviewComments });
      setState(data);
      setBudgetItems(budgetFromState(data));
      setReviewComments('');
      showToast?.(decision === 'approve' ? 'Budget approved — sent to admin.' : 'Budget sent back.', decision === 'approve' ? 'success' : 'danger');
      navigate(ROUTES.PROJECT_EXCELLENCE);
    } catch (err) {
      setError(err?.detail || err?.message || 'Review failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminReview = async (decision) => {
    setSaving(true);
    try {
      const data = await adminReviewPEBudget(siteId, { decision, comments: reviewComments });
      setState(data);
      setBudgetItems(budgetFromState(data));
      setReviewComments('');
    } catch (err) {
      setError(err?.detail || err?.message || 'Admin review failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader file="No. 10" eyebrow="Project Excellence" title="Loading…"/>
      <div className="zm-glass" style={{ padding: 32, textAlign: 'center', color: 'var(--zm-fg-3)' }}>
        Loading site details…
      </div>
    </div>
  );

  if (error && !state) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader file="No. 10" eyebrow="Project Excellence" title="Error"/>
      <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{error}</div>
    </div>
  );

  const budgetTotal = budgetItems.reduce((s, item) => s + (Number(item.amount) || 0), 0);
  const civilMepSum = sumByIdx(budgetItems, CIVIL_MEP_IDX);
  const canEditBudget = !isBusinessAdmin && state?.budgetStatus && ['draft', 'rejected'].includes(state.budgetStatus);
  const canSupervisorReview = isSupervisor && state?.budgetStatus === 'pending_supervisor';
  const canAdminReview = isBusinessAdmin && state?.budgetStatus === 'pending_admin';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow="Project Excellence"
        title={state?.siteName || siteId}
        onBack={() => navigate(ROUTES.PROJECT_EXCELLENCE)}
        right={<HeaderTag icon="box" label="PROJECT EXCELLENCE"/>}
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
        <FieldRow label="Project status">
          {statusPill(state?.projectStatus || 'done', 'var(--zm-success)')}
        </FieldRow>
        <FieldRow label="Excellence status">
          {statusPill(state?.excellenceStatus || 'pending', 'var(--zm-accent)')}
        </FieldRow>
        <FieldRow label="Budget status">
          {statusPill(state?.budgetStatus || 'draft',
            state?.budgetStatus === 'approved' ? 'var(--zm-success)' : 'var(--zm-copper)')}
        </FieldRow>
        {state?.allocatedToName && (
          <FieldRow label="Allocated to">
            <span style={{ fontSize: 13 }}>{state.allocatedToName}</span>
          </FieldRow>
        )}
      </SectionCard>

      {/* Allocation (supervisor only) */}
      {isSupervisor && (
        <SectionCard title="Allocation">
          {actionError && <div style={{ marginBottom: 8, color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5 }}>{actionError}</div>}
          {teamError && (
            <div role="alert" style={{ marginBottom: 10, color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5 }}>
              {teamError}
            </div>
          )}
          {allocation ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
                borderRadius: 4, border: '1px solid var(--zm-accent)', color: 'var(--zm-accent)',
                fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>Allocated · {allocation.delegateName || allocation.delegateEmail}</span>
              <button type="button" disabled={saving} onClick={onRevoke} style={{
                height: 32, padding: '0 14px', border: 'none', borderRadius: 7,
                background: 'var(--zm-danger)', color: '#fff', fontFamily: 'var(--zm-font-body)',
                fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1,
              }}>Revoke</button>
            </div>
          ) : state?.excellenceStatus === 'pending' || state?.excellenceStatus === 'allocated' ? (
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
          ) : (
            <span style={{ fontSize: 13, color: 'var(--zm-fg-3)' }}>Not available for allocation.</span>
          )}
        </SectionCard>
      )}

      {/* Budget form */}
      <SectionCard title={`Budget (total: ${formatINR(budgetTotal)})`}>
        {/* Area inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
          {[
            { key: 'total_indoor_area_sqft', label: 'Indoor area (sqft)' },
            { key: 'total_area_sqft', label: 'Total area (sqft)' },
            { key: 'covers', label: 'Covers' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label style={{ fontSize: 11, color: 'var(--zm-fg-3)', textTransform: 'uppercase', fontFamily: 'var(--zm-font-body)', letterSpacing: '0.1em' }}>
                {label}
              </label>
              <input
                type="number"
                min="0"
                value={areaFields[key]}
                onChange={(e) => setAreaFields((prev) => ({ ...prev, [key]: e.target.value }))}
                disabled={!canEditBudget}
                style={{
                  display: 'block', width: '100%', marginTop: 4, height: 36, padding: '0 10px',
                  boxSizing: 'border-box', borderRadius: 7, border: '1px solid var(--zm-line)',
                  background: canEditBudget ? 'var(--zm-surface)' : 'var(--zm-surface-2)',
                  color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-mono)', fontSize: 13,
                  opacity: canEditBudget ? 1 : 0.6,
                }}
              />
            </div>
          ))}
        </div>

        {/* Auto-calculated, read-only. Recompute live; "—" when divisor is empty/0. */}
        <div className="zm-label">Calculated metrics · read-only</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 10, marginBottom: 18 }}>
          <MetricField
            label="Civil, Interior & MEP Cost per sqft"
            value={formatRatio(civilMepSum, areaFields.total_indoor_area_sqft)}
          />
          <MetricField
            label="CAPEX Cost per sqft"
            value={formatRatio(budgetTotal, areaFields.total_area_sqft)}
          />
          <MetricField
            label="CAPEX per Cover"
            value={formatRatio(budgetTotal, areaFields.covers)}
          />
        </div>

        {/* Line items */}
        {budgetItems.map((item) => (
          <div key={item.idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--zm-fg-2)', display: 'flex', alignItems: 'center' }}>
              <span style={{ color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-mono)', fontSize: 11, marginRight: 8 }}>
                {String(item.idx).padStart(2, '0')}
              </span>
              {item.label}
            </div>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={item.amount}
              onChange={(e) => handleBudgetChange(item.idx, 'amount', e.target.value)}
              disabled={!canEditBudget}
              style={{
                height: 36, padding: '0 10px', borderRadius: 7, border: '1px solid var(--zm-line)',
                background: canEditBudget ? 'var(--zm-surface)' : 'var(--zm-surface-2)',
                color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-mono)', fontSize: 13,
                textAlign: 'right', opacity: canEditBudget ? 1 : 0.6,
              }}
            />
          </div>
        ))}

        {/* Comments (read-only feedback) */}
        {state?.budgetSupervisorComments && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--zm-surface-2)', color: 'var(--zm-fg-2)', fontSize: 13 }}>
            <strong>Supervisor comment:</strong> {state.budgetSupervisorComments}
          </div>
        )}
        {state?.budgetAdminComments && (
          <div style={{ marginTop: 8, padding: 12, borderRadius: 8, background: 'var(--zm-surface-2)', color: 'var(--zm-fg-2)', fontSize: 13 }}>
            <strong>Admin comment:</strong> {state.budgetAdminComments}
          </div>
        )}

        {/* Action buttons — budget editor */}
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
                style={{ height: 36, padding: '0 18px', borderRadius: 7, border: 'none', background: 'var(--zm-success)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Approve
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

        {/* Admin review panel */}
        {canAdminReview && (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 8, border: '1px solid var(--zm-line)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Admin budget review</div>
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
                onClick={() => handleAdminReview('approve')}
                style={{ height: 36, padding: '0 18px', borderRadius: 7, border: 'none', background: 'var(--zm-success)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={saving || !reviewComments.trim()}
                onClick={() => handleAdminReview('reject')}
                style={{ height: 36, padding: '0 18px', borderRadius: 7, border: 'none', background: 'var(--zm-danger)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !reviewComments.trim() ? 0.5 : 1 }}
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

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
