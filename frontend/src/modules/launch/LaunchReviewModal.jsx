import React from 'react';
import Icon from '../shared/primitives/Icon.jsx';
import RentTermsForm, { ZM_TOKENS } from '../shared/rent/RentTermsForm.jsx';
import {
  getLaunchApproval, saveLaunchRentFields, execReview, supervisorReview,
} from '../../services/api/launchApprovalApi.js';

// LaunchReviewModal — the BD-side review surface for the post-NSO validation loop.
//
//   role='exec'       → the creating executive. Read-only rent. Approve / Reject
//                       + comment. Verdict is recorded and flows to the supervisor.
//   role='supervisor' → supervisor. EDITABLE rent (rev-share form). Approve /
//                       Reject + comment. Flows to the admin's final confirm.
//
// Both see the filled site details, every department status, and the recorded
// timeline. Nothing here touches the canonical DB — edits stay on the backend
// staging row until the admin's final confirm.

const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const pct = (n) => (n == null ? '—' : `${Number(n)}%`);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

function deptTone(value) {
  const v = String(value || '').toLowerCase();
  if (['positive', 'approved', 'done', 'active', 'complete', 'ready', 'received', 'verified', 'true'].includes(v)) return 'var(--zm-success)';
  if (['negative', 'rejected', 'false'].includes(v)) return 'var(--zm-danger)';
  if (['pending', '', 'null', 'undefined'].includes(v)) return 'var(--zm-warning, #E09A3C)';
  return 'var(--zm-accent)';
}

function Field({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', wordBreak: 'break-word' }}>{children == null || children === '' ? '—' : children}</div>
    </div>
  );
}

function DeptChip({ label, value }) {
  const color = deptTone(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)' }}>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>{value == null || value === '' ? '—' : String(value)}</span>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 10 }}>{children}</div>;
}

export default function LaunchReviewModal({ siteId, role, onClose, onDone }) {
  const isSupervisor = role === 'supervisor';
  const [data, setData] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [comment, setComment] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const RENT_KEYS = ['rent_type', 'expected_rent', 'rev_share_pct', 'revshare_dinein_pct', 'revshare_delivery_pct', 'escalation_pct', 'expected_escalation_years', 'rent_free_days', 'lock_in_months', 'tenure_months'];

  const hydrate = React.useCallback((d) => {
    setData(d);
    const f = {};
    RENT_KEYS.forEach((k) => { f[k] = d[k] ?? null; });
    setForm(f);
  }, []);

  React.useEffect(() => {
    if (!siteId) return;
    setLoading(true);
    getLaunchApproval(siteId)
      .then(hydrate)
      .catch((e) => setErr(e?.detail || e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [siteId, hydrate]);

  const handleRentChange = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSaveRent = async () => {
    setSaving(true); setErr(null); setSavedFlash(false);
    try {
      hydrate(await saveLaunchRentFields(siteId, form));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch (e) {
      setErr(e?.detail || e?.message || 'Failed to save rent changes');
    } finally {
      setSaving(false);
    }
  };

  const handleVerdict = async (verdict) => {
    if (verdict === 'rejected' && !comment.trim()) {
      setErr('A comment is required when rejecting.');
      return;
    }
    setActing(true); setErr(null);
    try {
      const fn = isSupervisor ? supervisorReview : execReview;
      await fn(siteId, { verdict, comment: comment.trim() || null });
      onDone?.();
      onClose?.();
    } catch (e) {
      setErr(e?.detail || e?.message || 'Failed to submit verdict');
    } finally {
      setActing(false);
    }
  };

  const d = data;
  const det = d?.details || {};
  const dep = d?.departments || {};

  const rentSummary = () => {
    if (!d?.rent_type) return 'No rent type set';
    if (d.rent_type === 'fixed') return `Fixed · ${inr(d.expected_rent)}/mo · ${pct(d.escalation_pct)} every ${d.expected_escalation_years || '—'} yr`;
    if (d.rent_type === 'revshare') return `Revenue share · ${pct(d.rev_share_pct)} of sales`;
    if (d.rent_type === 'mg_revshare') return `MG ${inr(d.expected_rent)}/mo + ${pct(d.rev_share_pct)} above MG`;
    return d.rent_type;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.50)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', animation: 'zm-fade 200ms var(--zm-ease)' }}>
      <div style={{ background: 'var(--zm-bg)', borderLeft: '1px solid var(--zm-line)', width: 820, maxWidth: '96%', display: 'flex', flexDirection: 'column', boxShadow: 'var(--zm-shadow-pop)', animation: 'zm-slide 280ms var(--zm-ease-emp)' }}>
        {/* Header */}
        <header style={{ padding: '18px 26px', background: 'var(--zm-surface)', borderBottom: '1px solid var(--zm-line)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>
              {isSupervisor ? 'Supervisor review' : 'Creator review'}
            </span>
            <h2 style={{ margin: '4px 0 4px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 21, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>
              {loading ? 'Loading…' : `${d?.site_code || ''} · ${d?.site_name || ''}`}
            </h2>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>
              {d?.city} · {isSupervisor ? 'Edit rent if needed, then Approve / Reject with a comment.' : 'Read-only. Approve / Reject with a comment.'}
            </p>
          </div>
          <button onClick={onClose} className="zm-icon-btn" style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer', flex: '0 0 30px' }}><Icon name="x" size={14} /></button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>Loading…</div>}

          {err && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--zm-danger-soft)', border: '1px solid var(--zm-danger)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 13, marginBottom: 16 }}>{err}</div>
          )}

          {d && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* Admin's rent note + (for supervisor) the executive's verdict */}
              {(d.admin_review_comment || (isSupervisor && d.exec_verdict)) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {d.admin_review_comment && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--zm-accent-soft)', border: '1px solid var(--zm-line)' }}>
                      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>Admin note</span>
                      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', marginTop: 3 }}>“{d.admin_review_comment}”</div>
                    </div>
                  )}
                  {isSupervisor && d.exec_verdict && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--zm-surface)', border: `1px solid ${d.exec_verdict === 'approved' ? 'var(--zm-success)' : 'var(--zm-danger)'}` }}>
                      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: d.exec_verdict === 'approved' ? 'var(--zm-success)' : 'var(--zm-danger)' }}>
                        Executive {d.exec_verdict === 'approved' ? 'approved ✓' : 'rejected ✕'}
                      </span>
                      {d.exec_comment && <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', marginTop: 3 }}>“{d.exec_comment}”</div>}
                    </div>
                  )}
                </div>
              )}

              {/* Rent terms */}
              <div>
                <SectionLabel>Rent terms {isSupervisor && <span style={{ color: 'var(--zm-accent)' }}>· editable</span>}</SectionLabel>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', marginBottom: 14 }}>
                  <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Current</span>
                  <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--zm-fg)', marginTop: 2 }}>{rentSummary()}</div>
                </div>
                <RentTermsForm value={form} onChange={handleRentChange} readOnly={!isSupervisor} tokens={ZM_TOKENS} />
                {isSupervisor && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={handleSaveRent} disabled={saving} className="zm-btn" style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
                      {saving ? 'Saving…' : 'Save rent changes'}
                    </button>
                    {savedFlash && <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-success)', fontWeight: 600 }}>✓ Saved</span>}
                  </div>
                )}
              </div>

              {/* Department statuses */}
              <div>
                <SectionLabel>Department status</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <DeptChip label="Legal DD" value={dep.legal_dd_status} />
                  <DeptChip label="Agreement" value={dep.agreement_status} />
                  <DeptChip label="Licensing" value={dep.licensing_status} />
                  <DeptChip label="Design" value={dep.design_status} />
                  <DeptChip label="Project" value={dep.project_status} />
                  <DeptChip label="Finance" value={dep.finance_status} />
                  <DeptChip label="FSSAI" value={dep.fssai_status} />
                  <DeptChip label="Health Trade" value={dep.health_trade_status} />
                  <DeptChip label="Shops & Estab." value={dep.shops_estab_status} />
                  <DeptChip label="Fire NOC" value={dep.fire_noc_status} />
                  <DeptChip label="Storage" value={dep.storage_license_status} />
                  <DeptChip label="CA code" value={dep.ca_code} />
                </div>
              </div>

              {/* Site details */}
              <div>
                <SectionLabel>Site details</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, padding: '14px 16px', borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)' }}>
                  <Field label="Name">{det.name}</Field>
                  <Field label="City">{det.city}</Field>
                  <Field label="Model">{det.model}</Field>
                  <Field label="Visit date">{fmtDate(det.visit_date)}</Field>
                  <Field label="Google pin">{det.google_pin}</Field>
                  <Field label="Score">{det.score}</Field>
                  <Field label="Est. monthly sales">{inr(det.estimated_monthly_sales)}</Field>
                  <Field label="Nearest Starbucks">{num(det.nearest_starbucks)}</Field>
                  <Field label="Nearest TWC">{num(det.nearest_twc)}</Field>
                  <Field label="Carpet area">{det.carpet_area_sqft ? `${num(det.carpet_area_sqft)} sqft` : '—'}</Field>
                  <Field label="CAM">{inr(det.cam_charges)}</Field>
                  <Field label="Capex">{inr(det.capex)}</Field>
                  <Field label="Security deposit">{inr(det.security_deposit)}</Field>
                  <Field label="Brokerage">{inr(det.brokerage)}</Field>
                </div>
              </div>

              {/* Verdict comment */}
              <div>
                <SectionLabel>Your comment</SectionLabel>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
                  placeholder="Required when rejecting · optional when approving"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-bg)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {d && !loading && (
          <footer style={{ padding: '14px 26px', borderTop: '1px solid var(--zm-line)', background: 'var(--zm-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }} />
            <button onClick={() => handleVerdict('rejected')} disabled={acting} className="zm-btn"
              style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid var(--zm-danger)', background: 'var(--zm-danger-soft)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: acting ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="x" size={14} /> Reject
            </button>
            <button onClick={() => handleVerdict('approved')} disabled={acting} className="zm-btn-primary"
              style={{ height: 36, padding: '0 18px', borderRadius: 8, border: 'none', background: 'var(--zm-success, #2EA86A)', color: '#fff', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700, cursor: acting ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={14} /> {acting ? 'Submitting…' : 'Approve'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
