/**
 * LaunchApprovalTab — Business Admin portal tab for the post-NSO validation loop.
 *
 * The admin has TWO touches in the loop:
 *   1. pending_admin_review — review the full filled details + every department
 *      status; rent AND commercial terms shown as "current", each with its own
 *      Keep-same / Edit toggle; leave a rent comment; "Send for review" → exec.
 *   2. pending_admin_final  — see every change from draft → now and BOTH the
 *      executive's and supervisor's verdicts (highlighted); make final edits if
 *      needed; "Confirm" ⇒ commits the agreed terms to the DB. Blocked until a
 *      rent start date is set (the backend 422s it too).
 *   then ready_to_launch → "Launch Site".
 *
 * Between the two touches the record sits with the executive then the
 * supervisor; the admin sees it read-only ("With executive / supervisor").
 *
 * A Documents tab sits beside the review, so the evidence behind the numbers —
 * the LOI, site photos, design deliverables — is readable at the moment of
 * signing off, instead of in another module.
 */
// skipcq: JS-0833
import React from 'react';
import {
  T, Icon, Button, Card, SectionHeader, EmptyState, ErrorState, Skeleton,
  TABULAR, Drawer, ModalPortal, SegmentedNav, inr,
} from '../ui/kit.jsx';
import RentTermsForm, { AC_TOKENS } from '../../shared/rent/RentTermsForm.jsx';
import RentTermsFormV2 from '../../shared/rent/RentTermsFormV2.jsx';
import CommercialTermsForm from '../../shared/rent/CommercialTermsForm.jsx';
import RentScheduleButton from '../../shared/rent/RentScheduleDialog.jsx';
import RentTimeline from './RentTimeline.jsx';
import SiteDocumentsPanel from './SiteDocumentsPanel.jsx';
import { toV2Value, fromV2Key, pickLaunchRentFields, buildLaunchRentPayload } from '../../shared/rent/launchRentAdapter.js';
import { usePageContext } from '../../../App.jsx';
import {
  getLaunchQueue, getLaunchApproval, saveLaunchRentFields,
  sendForReview, finalConfirm, launchSite,
} from '../../../services/api/launchApprovalApi.js';
import { sendForFinancialClosure } from '../../../services/api/financialClosureApi.js';
import { keyActivate, useDialogFocus } from '../../../lib/a11y.js';

// Configurable rent-type UI (FEATURE_RENT_V2). Inlined per the USE_MOCK
// convention (see App.jsx). Flag OFF → the old four-card RentTermsForm (rollback).
const FEATURE_RENT_V2 = import.meta.env.VITE_FEATURE_RENT_V2 === 'true';

// ── Status display map ─────────────────────────────────────────────────────────
const STATUS_LABELS = {
  pending_admin_review:    { label: 'Pending Admin Review',  color: '#E09A3C' },
  under_exec_review:       { label: 'With Executive',        color: '#6C9FE6' },
  under_supervisor_review: { label: 'With Supervisor',       color: '#9B8AF2' },
  pending_admin_final:     { label: 'Final Admin Confirm',   color: '#E0B33C' },
  ready_to_launch:         { label: 'Ready to Launch',       color: '#58E0A4' },
  launched:                { label: 'LAUNCHED',              color: '#58E0A4' },
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

// Keep-same / Edit. Extracted when the commercial terms gained their own copy —
// two identical inline toggles would have drifted the moment one was restyled.
function ModeToggle({ mode, onChange, group }) {
  return (
    <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.line}` }}>
      {['keep', 'edit'].map((m) => {
        const label = m === 'keep' ? 'Keep same' : 'Edit';
        return (
          <button key={m} onClick={() => onChange(m)}
            aria-pressed={mode === m}
            aria-label={`${label} ${group}`}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: mode === m ? T.invBg : 'transparent', color: mode === m ? T.invText : T.textMuted }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// The statuses where the ball is in the business admin's court. Exported so the
// portal's sidebar badge counts exactly what this tab's own header counts —
// two copies of this list would drift the first time a status is added.
export const LAUNCH_ACTIONABLE_STATUSES = ['pending_admin_review', 'pending_admin_final', 'ready_to_launch'];

const ACTION_LABEL = {
  send: 'Send for review',
  final: 'Confirm & commit',
  launch: 'Launch Site',
};

// Checked before the final commit, which is what makes the staged terms
// canonical — the last point at which a gap can still be filled in.
//
// Rent start date is `required` because the backend 422s the commit without it;
// the rest are commercial terms a committed site is expected to carry, so they
// are listed but can be confirmed past. Read off the STAGED form, which is what
// the reviewer is looking at, not the last-hydrated record.
const COMMIT_FIELDS = [
  { key: 'rent_start_date', label: 'Rent start date', required: true },
  { key: 'carpet_area_sqft', label: 'Carpet area' },
  { key: 'cam_charges', label: 'CAM' },
  { key: 'capex', label: 'Capex' },
  { key: 'security_deposit', label: 'Security deposit' },
  { key: 'brokerage', label: 'Brokerage' },
];

const missingCommitFields = (form) => COMMIT_FIELDS.filter(({ key }) => {
  const v = form?.[key];
  return v == null || v === '';
});

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

// ── Site detail drawer ───────────────────────────────────────────────────────────
function LaunchDetailDrawer({ siteId, onClose, onRefresh }) {
  const { showToast } = usePageContext();
  const [data, setData] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [rentMode, setRentMode] = React.useState('keep'); // 'keep' | 'edit'
  const [commercialMode, setCommercialMode] = React.useState('keep'); // 'keep' | 'edit'
  const [comment, setComment] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [err, setErr] = React.useState(null);
  // Set by any edit, cleared by every hydrate (load and save both re-hydrate).
  // Guards the stage-advancing actions, which move the record on and leave no
  // way back to save.
  const [dirty, setDirty] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState(null);
  // Non-empty while the pre-commit check is holding back a final confirm.
  const [missingFields, setMissingFields] = React.useState(null);
  const [tab, setTab] = React.useState('review');

  const hydrate = React.useCallback((d) => {
    setData(d);
    setForm(pickLaunchRentFields(d));
    setDirty(false);
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
  // A drawer reopened on another site should start on the review, not wherever
  // the last one was left. The unsaved-changes dialog is cleared for the same
  // reason: left armed, it greets whoever opens the drawer next — including the
  // same user coming back, who then sees a warning about edits already gone.
  React.useEffect(() => { setTab('review'); setPendingAction(null); setMissingFields(null); }, [siteId]);

  // aria-modal promises focus containment; the hook keeps it and, as the topmost
  // overlay, owns Escape — so one press does not also close the Drawer beneath.
  const unsavedRef = React.useRef(null);
  const dismissPending = React.useCallback(() => setPendingAction(null), []);
  useDialogFocus(Boolean(pendingAction), unsavedRef, dismissPending);

  const missingRef = React.useRef(null);
  const dismissMissing = React.useCallback(() => setMissingFields(null), []);
  useDialogFocus(Boolean(missingFields), missingRef, dismissMissing);

  const status = data?.status;
  // Closure is one-way (pending → open) and the backend 409s a re-send, so the
  // action is offered only while it's still pending — on a fresh drawer open too,
  // not just right after this session sent it.
  const closureSent = (data?.financial_closure_status || 'pending') !== 'pending';
  const canEdit = status === 'pending_admin_review' || status === 'pending_admin_final';
  const isFinal = status === 'pending_admin_final';
  const handleRentChange = (key, val) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: val }));
  };
  // RentTermsFormV2 speaks the canonical snake_case contract; translate its keys
  // back to the launch staging keys the form state + PATCH body use.
  const handleRentV2Change = (key, val) => handleRentChange(fromV2Key(key), val);

  // `section` is the one whose Save button was pressed. On success its toggle
  // returns to "Keep same" and its fields collapse back to the read-only
  // summary: the edit is committed to staging, so leaving the form open read as
  // though it were still unsaved. The other section keeps whatever mode it was
  // in — the reviewer may still be working in it.
  const handleSaveRent = async (section) => {
    setSaving(true); setErr(null); setSavedFlash(false);
    try {
      hydrate(await saveLaunchRentFields(siteId, buildLaunchRentPayload(form)));
      if (section === 'commercial') setCommercialMode('keep');
      else setRentMode('keep');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch (e) {
      setErr(e?.detail || e?.message || 'Failed to save rent changes');
    } finally {
      setSaving(false);
    }
  };

  // Every action here advances the stage, so an unsaved edit would be lost with
  // no way back. Confirm first. 'send_closure' is excluded: it happens after the
  // terms are committed, when nothing is editable any more.
  const requestAction = (action) => {
    if (dirty && action !== 'send_closure') { setPendingAction(action); return; }
    handleAction(action);
  };

  // `skipFieldCheck` is set only by the missing-fields dialog's own confirm, and
  // only when nothing REQUIRED is missing — it can never wave through a commit
  // the backend would 422 anyway.
  const handleAction = async (action, { skipFieldCheck = false } = {}) => {
    setPendingAction(null);
    setMissingFields(null);
    // The commit makes the staged terms canonical, so this is the last point at
    // which a gap can still be filled. Catching it here keeps the reviewer in
    // the drawer with the fields they need rather than round-tripping an error.
    if (action === 'final' && !skipFieldCheck) {
      const missing = missingCommitFields(form);
      if (missing.length) {
        setMissingFields(missing);
        // Open the section that holds them, so "Back" lands on the inputs.
        setCommercialMode('edit');
        return;
      }
    }
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

  // Current commercial terms, as label/value pairs laid out on the same 3-column
  // grid the edit form uses — six figures joined by separators into one sentence
  // read as a run-on and made the numbers hard to compare at a glance.
  //
  // Reads the STAGED values off `form` (not `det`), so an edit is reflected
  // before the final commit writes it to site_details — the rule rent follows.
  const commercialRows = () => [
    ['Carpet area', form.carpet_area_sqft != null ? `${num(form.carpet_area_sqft)} sqft` : null],
    ['CAM', inr(form.cam_charges)],
    ['Capex', inr(form.capex)],
    ['Security deposit', inr(form.security_deposit)],
    ['Brokerage', inr(form.brokerage)],
    // The one field whose absence blocks the final confirm, so say so rather
    // than printing the same em dash as an ordinary empty value.
    ['Rent start date', form.rent_start_date ? fmtDate(form.rent_start_date) : 'Not set'],
  ];

  // Current rent summary line.
  const rentSummary = () => {
    if (!d?.rent_type) return 'No rent type set';
    if (d.rent_type === 'fixed') return `Fixed · ${inr(d.expected_rent)}/mo · ${pct(d.escalation_pct)} every ${d.expected_escalation_years || '—'} yr`;
    if (d.rent_type === 'revshare') return `Revenue share · ${pct(d.rev_share_pct)} of sales`;
    if (d.rent_type === 'mg_revshare') return `MG ${inr(d.expected_rent)}/mo + ${pct(d.rev_share_pct)} above MG`;
    if (d.rent_type === 'staggered') {
      const sched = Array.isArray(d.staggered_escalation) ? d.staggered_escalation : [];
      const years = sched.filter((e) => e && e.percent != null).map((e, i) => `Yr${e.year ?? i + 1} ${pct(e.percent)}`).join(' · ');
      return `Staggered · base ${inr(d.expected_rent)}/mo${years ? ' · ' + years : ''}`;
    }
    return RENT_TYPE_LABEL[d.rent_type] || d.rent_type;
  };

  return (
    <>
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
            <Button variant="accent" size="md" loading={acting} onClick={() => requestAction('send')}>
              Send for review →
            </Button>
          )}
          {status === 'pending_admin_final' && (
            <Button variant="success" size="md" loading={acting} onClick={() => requestAction('final')}>
              Confirm &amp; commit
            </Button>
          )}
          {status === 'ready_to_launch' && (
            <Button variant="success" size="md" loading={acting} onClick={() => requestAction('launch')}
              style={{ background: '#2EA86A', color: '#fff' }}>
              Launch Site
            </Button>
          )}
          {status === 'launched' && (closureSent ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: T.successText }}>
              <Icon.check size={14} /> Sent for financial closure
            </span>
          ) : (
            <Button variant="accent" size="md" loading={acting} onClick={() => requestAction('send_closure')}>
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
        <div style={{ marginBottom: 20 }}>
          <SegmentedNav
            tabs={[
              { key: 'review', label: 'Review', icon: Icon.check },
              { key: 'documents', label: 'Documents', icon: Icon.doc },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
      )}

      {d && !loading && tab === 'documents' && <SiteDocumentsPanel siteId={siteId} />}

      {d && !loading && tab === 'review' && (
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
            <SubHead right={canEdit && <ModeToggle mode={rentMode} onChange={setRentMode} group="rent terms" />}>
              Rent terms {canEdit && <span style={{ color: '#E09A3C', fontWeight: 700 }}>· editable</span>}
            </SubHead>

            <div style={{ padding: '10px 14px', borderRadius: 10, background: T.successSoft, border: `1px solid ${T.line}`, marginBottom: canEdit && rentMode === 'edit' ? 14 : 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint }}>Current</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>{rentSummary()}</span>
                {d?.rent_type === 'staggered' && <RentScheduleButton schedule={d.staggered_escalation} baseRent={d.expected_rent} tokens={AC_TOKENS} />}
              </div>
            </div>

            {canEdit && rentMode === 'edit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {FEATURE_RENT_V2 ? (
                  <RentTermsFormV2 value={toV2Value(form)} onChange={handleRentV2Change}
                    tokens={AC_TOKENS} showRentLinkedTerms legacyMode="edit" />
                ) : (
                  <RentTermsForm value={form} onChange={handleRentChange} tokens={AC_TOKENS} />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.textFaint }}>Comment on rent (optional)</div>
                  {/* ac-input supplies the focus ring and placeholder colour
                      that inline styles can't; sizing matches SiteApprovalPanel's
                      taStyle so every admin textarea reads the same. */}
                  <textarea className="ac-input" value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                    placeholder="Why these terms…"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: T.radiusSm, border: `1px solid ${T.lineStrong}`, background: T.chip, color: T.text, fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.55, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <Button variant="solid" size="sm" loading={saving} onClick={() => handleSaveRent('rent')}>Save rent changes</Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Commercial terms (editable for admin at both touches) ─────── */}
          <div>
            <SubHead right={canEdit && <ModeToggle mode={commercialMode} onChange={setCommercialMode} group="commercial terms" />}>
              Commercial terms {canEdit && <span style={{ color: '#E09A3C', fontWeight: 700 }}>· editable</span>}
            </SubHead>

            <div style={{ padding: '12px 16px', borderRadius: 10, background: T.successSoft, border: `1px solid ${T.line}`, marginBottom: canEdit && commercialMode === 'edit' ? 14 : 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint }}>Current</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, marginTop: 10 }}>
                {commercialRows().map(([label, value]) => (
                  <Field key={label} label={label}>{value}</Field>
                ))}
              </div>
            </div>

            {canEdit && commercialMode === 'edit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <CommercialTermsForm value={form} onChange={handleRentChange} tokens={AC_TOKENS} />
                <div>
                  <Button variant="solid" size="sm" loading={saving} onClick={() => handleSaveRent('commercial')}>Save commercial changes</Button>
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
              {/* Carpet area / CAM / Capex / Security deposit / Brokerage moved to
                  the editable Commercial terms section above — showing them here
                  too would put the canonical value beside the staged one. */}
            </div>
          </div>

          {/* ── Validation timeline ───────────────────────────────────────── */}
          <div>
            <SubHead>Rent change history &amp; activity</SubHead>
            <Card style={{ padding: 16 }}><RentTimeline events={d.events} /></Card>
          </div>

          {status === 'launched' && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: T.successSoft, border: `1px solid ${T.success}`, color: T.successText, fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
              Site launched on {fmtDate(d.launched_at)}
            </div>
          )}
        </div>
      )}
    </Drawer>

      {siteId && pendingAction && (
        <ModalPortal>
          {/* pointerEvents is explicit: .ac-portal-root is pointer-events:none and
              the value inherits, so without this every button here is dead to the
              mouse and clicks fall through to the Drawer (#495). */}
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,10,14,0.62)', backdropFilter: 'blur(3px)', zIndex: 200, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div ref={unsavedRef} role="dialog" aria-modal="true" aria-labelledby="ac-unsaved-title" tabIndex={-1}
              style={{ width: 430, maxWidth: '100%', outline: 'none' }}>
            <Card style={{ padding: '20px 22px' }}>
              <h3 id="ac-unsaved-title" style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: T.text }}>
                You have unsaved changes
              </h3>
              <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: T.textMuted }}>
                Your edits have not been saved. “{ACTION_LABEL[pendingAction] || pendingAction}” moves this
                site to the next stage and those changes will be lost.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <Button variant="subtle" size="md" onClick={() => setPendingAction(null)}>Back</Button>
                <Button variant="danger" size="md" onClick={() => handleAction(pendingAction)}>
                  {ACTION_LABEL[pendingAction] || 'Continue'} anyway
                </Button>
              </div>
            </Card>
            </div>
          </div>
        </ModalPortal>
      )}

      {siteId && missingFields && missingFields.length > 0 && (
        <ModalPortal>
          {/* pointerEvents is explicit, exactly as on the dialog above:
              .ac-portal-root is pointer-events:none and the value inherits, so
              without this both buttons here are dead to the mouse and the clicks
              fall through to the Drawer (#495). jsdom never applies
              approval-center.css, so only an inline-style assertion catches it. */}
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,10,14,0.62)', backdropFilter: 'blur(3px)', zIndex: 200, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div ref={missingRef} role="alertdialog" aria-modal="true" aria-labelledby="ac-missing-title" tabIndex={-1}
              style={{ width: 430, maxWidth: '100%', outline: 'none' }}>
            <Card style={{ padding: '20px 22px' }}>
              <h3 id="ac-missing-title" style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: T.text }}>
                {missingFields.some((f) => f.required) ? 'Required field missing' : 'Some terms are not set'}
              </h3>
              <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: T.textMuted }}>
                {missingFields.some((f) => f.required)
                  ? 'This site cannot be committed until every required field is filled in. Open Commercial terms → Edit to complete them.'
                  : 'These terms have no value. You can go back and fill them in, or commit the site as it stands.'}
              </p>
              <ul style={{ margin: '12px 0 0', padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.7, color: T.text }}>
                {missingFields.map((f) => (
                  <li key={f.key}>
                    {f.label}
                    {f.required && <span style={{ color: T.dangerText, fontWeight: 700 }}> · required</span>}
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <Button variant="subtle" size="md" onClick={() => setMissingFields(null)}>Back</Button>
                {/* Offered only when nothing REQUIRED is missing — the backend
                    refuses that commit, so an override here would just surface
                    the same rejection a step later. */}
                {!missingFields.some((f) => f.required) && (
                  <Button variant="danger" size="md" onClick={() => handleAction('final', { skipFieldCheck: true })}>
                    Commit anyway
                  </Button>
                )}
              </div>
            </Card>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
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
  const [query, setQuery] = React.useState('');

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

  const needle = query.trim().toLowerCase();
  const displayedItems = queue.items.filter((i) => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (!needle) return true;
    return `${i.ca_code || ''} ${i.site_code || ''} ${i.site_name || ''} ${i.city || ''}`
      .toLowerCase().includes(needle);
  });
  const actionableCount = queue.items.filter((i) => LAUNCH_ACTIONABLE_STATUSES.includes(i.status)).length;

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

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18, marginTop: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.textFaint }}><Icon.search size={16} /></span>
          <input className="ac-input" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sites by name, code, or city" aria-label="Search sites by name, code, or city"
            style={{ width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px 0 36px', borderRadius: T.radiusSm,
              border: `1px solid ${T.lineStrong}`, background: T.surfaceInset, color: T.text, fontSize: 13, outline: 'none' }} />
        </div>
        {STATUS_TABS.map(({ key, label }) => {
          const inSearch = (i) => !needle
            || `${i.ca_code || ''} ${i.site_code || ''} ${i.site_name || ''} ${i.city || ''}`.toLowerCase().includes(needle);
          const count = queue.items.filter((i) => (key === 'all' || i.status === key) && inSearch(i)).length;
          const active = statusFilter === key;
          return (
            <button key={key} onClick={() => setStatusFilter(key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 12px',
                borderRadius: 8, border: `1px solid ${active ? T.accent : T.line}`,
                background: active ? `${T.accent}1F` : T.surface,
                color: active ? T.accent : T.textMuted,
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background .12s, border-color .12s, color .12s',
              }}>
              {label}
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, fontFeatureSettings: "'tnum' 1",
                background: active ? `${T.accent}33` : T.chip, color: active ? T.accent : T.textFaint,
              }}>{count}</span>
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
              hint={needle
                ? 'No sites match your search.'
                : statusFilter === 'all' ? 'Sites will appear here after NSO final approval.' : 'No sites in this status.'} />
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
