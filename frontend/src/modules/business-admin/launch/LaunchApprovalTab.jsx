/**
 * LaunchApprovalTab — Business Admin portal tab for the post-NSO validation loop.
 *
 * The admin has TWO touches in the loop:
 *   1. pending_admin_review — review the full filled details + every department
 *      status; rent shown as "current" with Keep-same / Edit (Edit opens the
 *      rev-share form); leave a rent comment; "Send for review" → executive.
 *   2. pending_admin_final  — see every rent change from draft → now and BOTH
 *      the executive's and supervisor's verdicts (highlighted); make final rent
 *      edits if needed; "Confirm" ⇒ commits the agreed terms to the DB.
 *   then ready_to_launch → "🚀 Launch Site".
 *
 * Between the two touches the record sits with the executive then the
 * supervisor; the admin sees it read-only ("With executive / supervisor").
 */
// skipcq: JS-0833
import React from 'react';
import {
  T, Icon, Button, Card, SectionHeader, EmptyState, ErrorState, Skeleton,
  TABULAR, Drawer, inr,
} from '../ui/kit.jsx';
import RentTermsForm, { AC_TOKENS } from '../../shared/rent/RentTermsForm.jsx';
import { usePageContext } from '../../../App.jsx';
import {
  getLaunchQueue, getLaunchApproval, saveLaunchRentFields,
  sendForReview, finalConfirm, launchSite,
} from '../../../services/api/launchApprovalApi.js';
import { sendForFinancialClosure } from '../../../services/api/financialClosureApi.js';
import { keyActivate } from '../../../lib/a11y.js';

// ── Status display map ─────────────────────────────────────────────────────────
const STATUS_LABELS = {
  pending_admin_review:    { label: 'Pending Admin Review',  color: '#E09A3C' },
  under_exec_review:       { label: 'With Executive',        color: '#6C9FE6' },
  under_supervisor_review: { label: 'With Supervisor',       color: '#9B8AF2' },
  pending_admin_final:     { label: 'Final Admin Confirm',   color: '#E0B33C' },
  ready_to_launch:         { label: 'Ready to Launch',       color: '#58E0A4' },
  launched:                { label: 'LAUNCHED 🚀',           color: '#58E0A4' },
};

const RENT_TYPE_LABEL = { fixed: 'Fixed + escalation', revshare: 'Revenue share', mg_revshare: 'MG + Revenue share', staggered: 'Staggered Rent with Escalation' };
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const pct = (n) => (n == null ? '—' : `${Number(n)}%`);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

// Map a department status string → a semantic colour.
function deptTone(value) {
  const v = String(value || '').toLowerCase();
  if (['positive', 'approved', 'done', 'active', 'complete', 'ready', 'received', 'verified', 'true'].includes(v)) return T.success;
  if (['negative', 'rejected', 'false'].includes(v)) return T.danger;
  if (['pending', '', 'null', 'undefined'].includes(v)) return T.warn;
  return T.accent; // in_review / in_progress / awaiting_* / allocated / gfc_pending
}

// ── Small presentational helpers ────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: T.text, wordBreak: 'break-word' }}>{children == null || children === '' ? '—' : children}</div>
    </div>
  );
}

function DeptChip({ label, value }) {
  const color = deptTone(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 11px', borderRadius: 8, background: T.surface, border: `1px solid ${T.line}` }}>
      <span style={{ fontSize: 12, color: T.textMuted }}>{label}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>{value == null || value === '' ? '—' : String(value)}</span>
    </div>
  );
}

function SubHead({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted }}>{children}</div>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}

function VerdictChip({ verdict }) {
  if (!verdict) return <span style={{ fontSize: 11, color: T.textFaint }}>Not reviewed</span>;
  const ok = verdict === 'approved';
  const color = ok ? T.success : T.danger;
  return (
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color, background: `${color}22`, padding: '2px 9px', borderRadius: 20 }}>
      {ok ? '✓ Approved' : '✕ Rejected'}
    </span>
  );
}

// A single verdict card (exec / supervisor) — highlighted approve/reject + comment.
function VerdictCard({ title, verdict, by, at, comment }) {
  const color = verdict === 'approved' ? T.success : verdict === 'rejected' ? T.danger : T.line;
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: T.surface, border: `1px solid ${verdict ? color : T.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: comment ? 8 : 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted }}>{title}</span>
        <span style={{ flex: 1 }} />
        <VerdictChip verdict={verdict} />
      </div>
      {comment && <div style={{ fontSize: 12.5, color: T.text, lineHeight: 1.5, background: T.bg, borderRadius: 8, padding: '8px 10px' }}>“{comment}”</div>}
      {(by || at) && <div style={{ marginTop: 6, fontSize: 11, color: T.textFaint }}>{[by, at ? fmtDate(at) : null].filter(Boolean).join(' · ')}</div>}
    </div>
  );
}

// Recorded timeline — baseline → edits → verdicts → confirm → launch.
function Timeline({ events }) {
  if (!events?.length) return <div style={{ fontSize: 12.5, color: T.textFaint }}>No activity yet.</div>;
  const actionColor = (a) => (a === 'approved' || a === 'committed' || a === 'launched' || a === 'confirmed') ? T.success : a === 'rejected' ? T.danger : a === 'edited' ? T.accent : T.textMuted;
  const actionLabel = {
    baseline: 'Draft baseline', edited: 'Edited rent', sent_for_review: 'Sent for review',
    approved: 'Approved', rejected: 'Rejected', confirmed: 'Final confirm', committed: 'Committed to DB', launched: 'Launched',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {events.map((e, i) => {
        const color = actionColor(e.action);
        return (
          <div key={e.id} style={{ display: 'flex', gap: 12, paddingBottom: i === events.length - 1 ? 0 : 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: color, flexShrink: 0, marginTop: 4 }} />
              {i !== events.length - 1 && <span style={{ flex: 1, width: 1.5, background: T.line, marginTop: 2 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>{actionLabel[e.action] || e.action}</span>
                <span style={{ fontSize: 11.5, color: T.textMuted }}>{e.actor_name || 'system'}{e.actor_role ? ` · ${e.actor_role}` : ''}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: T.textFaint, ...TABULAR }}>{e.created_at ? new Date(e.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
              {e.comment && <div style={{ marginTop: 4, fontSize: 12.5, color: T.text, lineHeight: 1.45 }}>“{e.comment}”</div>}
              {Array.isArray(e.changes) && e.changes.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {e.changes.map((c, j) => (
                    <div key={`${c.field ?? c.label ?? j}-${j}`} style={{ fontSize: 11.5, color: T.textMuted, ...TABULAR }}>
                      <span style={{ color: T.textFaint }}>{c.label || c.field}:</span>{' '}
                      <span style={{ textDecoration: c.from != null ? 'line-through' : 'none', color: T.textFaint }}>{c.from ?? '—'}</span>
                      {' → '}<span style={{ color: T.text, fontWeight: 600 }}>{c.to ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Site detail drawer ───────────────────────────────────────────────────────────
function LaunchDetailDrawer({ siteId, onClose, onRefresh }) {
  const { showToast } = usePageContext();
  const [data, setData] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [rentMode, setRentMode] = React.useState('keep'); // 'keep' | 'edit'
  const [comment, setComment] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const RENT_KEYS = ['rent_type', 'expected_rent', 'rev_share_pct', 'escalation_pct', 'expected_escalation_years', 'rent_free_days', 'lock_in_months', 'tenure_months'];

  const hydrate = React.useCallback((d) => {
    setData(d);
    const f = {};
    RENT_KEYS.forEach((k) => { f[k] = d[k] ?? null; });
    setForm(f);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      hydrate(await getLaunchApproval(siteId));
    } catch (e) {
      setErr(e?.detail || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [siteId, hydrate]);

  React.useEffect(() => { if (siteId) load(); }, [load, siteId]);

  const status = data?.status;
  // Closure is one-way (pending → open) and the backend 409s a re-send, so the
  // action is offered only while it's still pending — on a fresh drawer open too,
  // not just right after this session sent it.
  const closureSent = (data?.financial_closure_status || 'pending') !== 'pending';
  const canEdit = status === 'pending_admin_review' || status === 'pending_admin_final';
  const isFinal = status === 'pending_admin_final';
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

  const handleAction = async (action) => {
    setActing(true); setErr(null);
    try {
      let d;
      let msg = '';
      if (action === 'send') { d = await sendForReview(siteId, comment); msg = 'Sent for review'; }
      else if (action === 'final') { d = await finalConfirm(siteId, comment); msg = 'Rent terms confirmed'; }
      else if (action === 'launch') { d = await launchSite(siteId); msg = 'Site launched successfully!'; }
      else if (action === 'send_closure') {
        await sendForFinancialClosure(siteId);
        // The send returns an FC-state record, not a launch-approval one, so it
        // can't go through hydrate(). Flip the closure flag on the loaded record
        // instead — otherwise `status` stays 'launched', the action re-arms once
        // `acting` clears, and a second click 409s ("already open for this site").
        setData((prev) => (prev ? { ...prev, financial_closure_status: 'open' } : prev));
        showToast('Sent for financial closure');
        onRefresh();
        return;
      }
      hydrate(d);
      setComment('');
      showToast(msg);
      onRefresh();
    } catch (e) {
      setErr(e?.detail || e?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  const statusInfo = STATUS_LABELS[status] || { label: status, color: T.textMuted };
  const d = data;
  const det = d?.details || {};
  const dep = d?.departments || {};

  // Current rent summary line.
  const rentSummary = () => {
    if (!d?.rent_type) return 'No rent type set';
    if (d.rent_type === 'fixed') return `Fixed · ${inr(d.expected_rent)}/mo · ${pct(d.escalation_pct)} every ${d.expected_escalation_years || '—'} yr`;
    if (d.rent_type === 'revshare') return `Revenue share · ${pct(d.rev_share_pct)} of sales`;
    if (d.rent_type === 'mg_revshare') return `MG ${inr(d.expected_rent)}/mo + ${pct(d.rev_share_pct)} above MG`;
    return RENT_TYPE_LABEL[d.rent_type] || d.rent_type;
  };

  return (
    <Drawer
      open={!!siteId}
      onClose={onClose}
      title={loading ? 'Loading…' : `${dep.ca_code || d?.site_code || ''} · ${d?.site_name || ''}`}
      subtitle={loading ? '' : d?.city}
      headerRight={d && (
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: statusInfo.color, background: `${statusInfo.color}22`, padding: '3px 10px', borderRadius: 20 }}>
          {statusInfo.label}
        </span>
      )}
      footer={d && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {savedFlash && <span style={{ fontSize: 12, color: T.successText, fontWeight: 600 }}>✓ Rent changes saved</span>}
          <span style={{ flex: 1 }} />
          {status === 'pending_admin_review' && (
            <Button variant="accent" size="md" loading={acting} onClick={() => handleAction('send')}>
              Send for review →
            </Button>
          )}
          {status === 'pending_admin_final' && (
            <Button variant="success" size="md" loading={acting} onClick={() => handleAction('final')}>
              Confirm &amp; commit
            </Button>
          )}
          {status === 'ready_to_launch' && (
            <Button variant="success" size="md" loading={acting} onClick={() => handleAction('launch')}
              style={{ background: '#2EA86A', color: '#fff' }}>
              Launch Site
            </Button>
          )}
          {status === 'launched' && (closureSent ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: T.successText }}>
              <Icon.check size={14} /> Sent for financial closure
            </span>
          ) : (
            <Button variant="accent" size="md" loading={acting} onClick={() => handleAction('send_closure')}>
              Send for financial closure →
            </Button>
          ))}
          {(status === 'under_exec_review' || status === 'under_supervisor_review') && (
            <span style={{ fontSize: 12.5, color: T.textMuted }}>Awaiting {status === 'under_exec_review' ? 'executive' : 'supervisor'} review — read-only.</span>
          )}
        </div>
      )}
    >
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 0' }}>
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={36} />)}
        </div>
      )}

      {err && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: T.dangerSoft, border: `1px solid ${T.danger}`, color: T.dangerText, fontSize: 13, marginBottom: 16 }}>
          {err}
        </div>
      )}

      {d && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* ── Verdicts (final touch) ─────────────────────────────────────── */}
          {(isFinal || status === 'ready_to_launch' || status === 'launched') && (d.exec_verdict || d.supervisor_verdict) && (
            <div>
              <SubHead>Review verdicts</SubHead>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <VerdictCard title="Executive (creator)" verdict={d.exec_verdict} by={d.exec_reviewed_by_name} at={d.exec_reviewed_at} comment={d.exec_comment} />
                <VerdictCard title="Supervisor" verdict={d.supervisor_verdict} by={d.supervisor_reviewed_by_name} at={d.supervisor_reviewed_at} comment={d.supervisor_comment} />
              </div>
            </div>
          )}

          {/* ── Rent terms (editable for admin at both touches) ────────────── */}
          <div>
            <SubHead right={canEdit && (
              <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.line}` }}>
                {['keep', 'edit'].map((m) => (
                  <button key={m} onClick={() => setRentMode(m)}
                    style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: rentMode === m ? T.invBg : 'transparent', color: rentMode === m ? T.invText : T.textMuted }}>
                    {m === 'keep' ? 'Keep same' : 'Edit'}
                  </button>
                ))}
              </div>
            )}>Rent terms {canEdit && <span style={{ color: '#E09A3C', fontWeight: 700 }}>· editable</span>}</SubHead>

            <div style={{ padding: '10px 14px', borderRadius: 10, background: T.successSoft, border: `1px solid ${T.line}`, marginBottom: canEdit && rentMode === 'edit' ? 14 : 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint }}>Current</span>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginTop: 2 }}>{rentSummary()}</div>
            </div>

            {canEdit && rentMode === 'edit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <RentTermsForm value={form} onChange={handleRentChange} tokens={AC_TOKENS} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.textFaint }}>Comment on rent (optional)</div>
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                    placeholder="Why these terms…"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.line}`, background: T.surface, color: T.text, fontFamily: 'inherit', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <Button variant="subtle" size="sm" loading={saving} onClick={handleSaveRent}>Save rent changes</Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Department statuses ───────────────────────────────────────── */}
          <div>
            <SubHead>Department status</SubHead>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <DeptChip label="Legal DD" value={dep.legal_dd_status} />
              <DeptChip label="Agreement" value={dep.agreement_status} />
              <DeptChip label="Licensing" value={dep.licensing_status} />
              <DeptChip label="Design" value={dep.design_status} />
              <DeptChip label="Project" value={dep.project_status} />
              <DeptChip label="Finance" value={dep.finance_status} />
              <DeptChip label="KYC" value={dep.kyc_verified ? 'verified' : 'pending'} />
              <DeptChip label="CA code" value={dep.ca_code} />
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.textFaint, margin: '14px 0 8px' }}>NSO licenses</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <DeptChip label="FSSAI" value={dep.fssai_status} />
              <DeptChip label="Health Trade" value={dep.health_trade_status} />
              <DeptChip label="Shops & Estab." value={dep.shops_estab_status} />
              <DeptChip label="Fire NOC" value={dep.fire_noc_status} />
              <DeptChip label="Storage" value={dep.storage_license_status} />
              <DeptChip label="Launch date" value={dep.launch_date ? fmtDate(dep.launch_date) : null} />
            </div>
          </div>

          {/* ── Filled site details (read-only) ───────────────────────────── */}
          <div>
            <SubHead>Site details</SubHead>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, padding: '14px 16px', borderRadius: 10, background: T.surface, border: `1px solid ${T.line}` }}>
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

          {/* ── Validation timeline ───────────────────────────────────────── */}
          <div>
            <SubHead>Rent change history &amp; activity</SubHead>
            <Card style={{ padding: 16 }}><Timeline events={d.events} /></Card>
          </div>

          {status === 'launched' && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: T.successSoft, border: `1px solid ${T.success}`, color: T.successText, fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
              🚀 Site launched on {fmtDate(d.launched_at)}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── Queue row ──────────────────────────────────────────────────────────────────
function QueueRow({ item, onClick }) {
  const info = STATUS_LABELS[item.status] || { label: item.status, color: T.textMuted };
  return (
    <div onClick={onClick} role="button" tabIndex={0} onKeyDown={keyActivate(onClick)}
      style={{ display: 'grid', gridTemplateColumns: '0.7fr 1.4fr 0.8fr 1.4fr 1fr', gap: 12, padding: '13px 18px', borderBottom: `1px solid ${T.line}`, cursor: 'pointer', transition: 'background 0.15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = T.hoverBg || 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: T.textMuted }}>{item.ca_code || item.site_code || '—'}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.site_name}</span>
      <span style={{ fontSize: 13, color: T.textMuted }}>{item.city}</span>
      <span>
        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: info.color, background: `${info.color}22` }}>
          {info.label}
        </span>
      </span>
      <span style={{ fontSize: 11.5, color: T.textFaint, ...TABULAR }}>
        {item.updated_at ? new Date(item.updated_at).toLocaleDateString('en-IN') : '—'}
      </span>
    </div>
  );
}

// ── Main tab component ─────────────────────────────────────────────────────────
export default function LaunchApprovalTab() {
  const [queue, setQueue] = React.useState({ status: 'loading', items: [], error: null });
  const [selectedSiteId, setSelectedSiteId] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('all');

  const load = React.useCallback(async (silent = false) => {
    setQueue((s) => silent ? { ...s, refreshing: true } : { status: 'loading', items: [], error: null });
    try {
      const d = await getLaunchQueue();
      setQueue({ status: 'ready', items: d.items || [], error: null });
    } catch (e) {
      setQueue({ status: 'error', items: [], error: e?.detail || e?.message || 'Failed to load' });
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const STATUS_TABS = [
    { key: 'all',                     label: 'All' },
    { key: 'pending_admin_review',    label: 'Pending Review' },
    { key: 'under_exec_review',       label: 'With Executive' },
    { key: 'under_supervisor_review', label: 'With Supervisor' },
    { key: 'pending_admin_final',     label: 'Final Confirm' },
    { key: 'ready_to_launch',         label: 'Ready to Launch' },
    { key: 'launched',                label: 'Launched' },
  ];

  const displayedItems = statusFilter === 'all' ? queue.items : queue.items.filter((i) => i.status === statusFilter);
  const actionableCount = queue.items.filter((i) => ['pending_admin_review', 'pending_admin_final', 'ready_to_launch'].includes(i.status)).length;

  return (
    <div>
      <SectionHeader
        icon={Icon.flag}
        title="Launch Approvals"
        description="Post-NSO validation loop: admin → executive → supervisor → admin, then launch."
        count={actionableCount}
        tone={actionableCount > 0 ? 'warn' : 'success'}
        onRefresh={() => load(true)}
        refreshing={queue.refreshing}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18, marginTop: 14 }}>
        {STATUS_TABS.map(({ key, label }) => {
          const count = key === 'all' ? queue.items.length : queue.items.filter((i) => i.status === key).length;
          const active = statusFilter === key;
          return (
            <button key={key} onClick={() => setStatusFilter(key)}
              style={{ padding: '5px 14px', borderRadius: 20, border: `1px solid ${active ? T.accent : T.line}`, background: active ? `${T.accent}22` : 'transparent', color: active ? T.accent : T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {label}{count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '0.7fr 1.4fr 0.8fr 1.4fr 1fr', gap: 12, padding: '9px 18px', borderBottom: `1px solid ${T.line}`, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textFaint }}>
          <span>Code</span><span>Site</span><span>City</span><span>Status</span><span>Updated</span>
        </div>

        {queue.status === 'loading' && (
          <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} h={40} />)}
          </div>
        )}

        {queue.status === 'error' && (
          <div style={{ padding: 24 }}><ErrorState message={queue.error} onRetry={() => load(false)} /></div>
        )}

        {queue.status === 'ready' && displayedItems.length === 0 && (
          <div style={{ padding: '36px 24px' }}>
            <EmptyState icon={Icon.check} title="Nothing to show"
              hint={statusFilter === 'all' ? 'Sites will appear here after NSO final approval.' : 'No sites in this status.'} />
          </div>
        )}

        {queue.status === 'ready' && displayedItems.map((item) => (
          <QueueRow key={item.site_id} item={item} onClick={() => setSelectedSiteId(item.site_id)} />
        ))}
      </Card>

      <LaunchDetailDrawer
        siteId={selectedSiteId}
        onClose={() => setSelectedSiteId(null)}
        onRefresh={() => load(true)}
      />
    </div>
  );
}
