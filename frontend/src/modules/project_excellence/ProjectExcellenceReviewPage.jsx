import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { listMyTeam } from '../../services/api/adapters/httpAdapter.js';
import {
  allocatePE,
  getPE,
  reviewPEBudget,
  savePEBudget,
  adminReviewPEBudget,
} from '../../services/api/projectExcellenceApi.js';
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
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  const isBusinessAdmin = role === 'business_admin';

  const [state, setState] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const [budgetItems, setBudgetItems] = React.useState(DEFAULT_BUDGET);
  const [areaFields, setAreaFields] = React.useState({ total_indoor_area_sqft: '', total_area_sqft: '', covers: '' });
  const [execList, setExecList] = React.useState([]);
  const [allocExec, setAllocExec] = React.useState('');
  const [reviewComments, setReviewComments] = React.useState('');

  const refresh = React.useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getPE(siteId),
      !isBusinessAdmin ? listMyTeam('project_excellence').catch(() => []) : Promise.resolve([]),
    ]).then(([data, team]) => {
      if (cancelled) return;
      setState(data);
      setBudgetItems(budgetFromState(data));
      setAreaFields({
        total_indoor_area_sqft: data.totalIndoorAreaSqft ?? '',
        total_area_sqft: data.totalAreaSqft ?? '',
        covers: data.covers ?? '',
      });
      if (!isBusinessAdmin) {
        // listMyTeam returns a bare array of executives already scoped to this
        // supervisor's project_excellence team (role_in_module='executive');
        // it carries no `role` field, so don't re-filter on one — that emptied
        // the list and left "Allocate" with no executives to pick.
        setExecList(Array.isArray(team) ? team : []);
      }
    }).catch((err) => {
      if (!cancelled) setError(err?.detail || err?.message || 'Failed to load site');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [siteId, isBusinessAdmin]);

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
    } catch (err) {
      setError(err?.detail || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAllocate = async () => {
    if (!allocExec) return;
    setSaving(true);
    try {
      const data = await allocatePE(siteId, allocExec);
      setState(data);
    } catch (err) {
      setError(err?.detail || err?.message || 'Allocation failed');
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

      {/* Allocation (supervisor only, unallocated sites) */}
      {isSupervisor && !state?.allocatedTo && state?.excellenceStatus === 'pending' && (
        <SectionCard title="Allocate site">
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
