import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import {
  getSiteTrackerView,
  saveFinanceDraft,
  requestFinanceApproval,
  approveFinance,
  rejectFinance,
} from '../../../services/api/siteTrackerApi.js';
import { bdSiteStatusRoute } from '../../../router/routes.js';
import { agreementStatusLabel, normalizeAgreementStatus } from '../../../lib/agreementStatus.js';
import { useSession } from '../../../state/SessionContext.jsx';
import { useSiteDataRefresh } from '../../../hooks/useSiteDataRefresh.js';

// Static LOI-forward hand-over graph. Only the Legal node is interactive in v1;
// the remaining nodes are placeholders that
// will light up as the downstream modules ship.
const NODES = [
  { id: 'loi',     label: 'BD LOI Signed',        icon: 'file',    interactive: false },
  { id: 'legal',   label: 'Legal & Compliance',   icon: 'shield',  interactive: true  },
  { id: 'ca',      label: 'CA / Commercial Code', icon: 'rupee',   interactive: true  },
  { id: 'design',  label: 'Design / Technical',   icon: 'grid',    interactive: false },
  { id: 'project', label: 'Project Execution',    icon: 'box',     interactive: false },
  { id: 'nso',     label: 'NSO',                  icon: 'home',    interactive: false },
  { id: 'launch',  label: 'Site Launched',        icon: 'flag',    interactive: false },
];

const NODE_TONES = {
  complete: {
    bg: 'var(--zm-success-soft, rgba(45,122,72,0.08))',
    border: 'var(--zm-success, #2D7A48)',
    color: 'var(--zm-success, #2D7A48)',
  },
  active: {
    bg: 'var(--zm-warning-soft, #F8EEDC)',
    border: 'var(--zm-warning, #B0712E)',
    color: 'var(--zm-warning, #B0712E)',
  },
  future: {
    bg: 'rgba(255,255,255,0.56)',
    border: 'var(--zm-line-faint)',
    color: 'var(--zm-fg-4)',
  },
};

const ACTIVE_PROJECT_STATUSES = new Set(['pending', 'allocated', 'budgeting', 'in_progress']);

function verdictTone(verdict) {
  if (verdict === 'positive') return { color: 'var(--zm-success, #2D7A48)', label: 'POSITIVE' };
  if (verdict === 'negative') return { color: 'var(--zm-danger,  #B91C1C)', label: 'NEGATIVE' };
  return { color: 'var(--zm-fg-3)', label: 'PENDING' };
}

function NodeCard({ node, selected, onClick, state, statusOverride }) {
  const tone = NODE_TONES[state] || NODE_TONES.future;
  const greyed = state === 'future';
  const defaultLabel =
    state === 'complete' ? (node.id === 'loi' ? 'DONE' : 'COMPLETE') :
    state === 'active' ? (['ca', 'project', 'nso', 'launch'].includes(node.id) ? 'PENDING' : 'OPEN') :
    'QUEUED';
  const statusLabel = statusOverride?.label ?? defaultLabel;
  const statusColor = statusOverride?.color ?? tone.color;
  return (
    <button
      type="button"
      onClick={node.interactive ? onClick : undefined}
      disabled={!node.interactive}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 10px', minWidth: 120,
        borderRadius: 12,
        border: '1px solid ' + (selected ? tone.border : tone.border),
        background: tone.bg,
        color: greyed ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
        cursor: node.interactive ? 'pointer' : 'default',
        opacity: greyed ? 0.7 : 1,
        boxShadow: selected ? '0 0 0 2px rgba(14,91,69,0.12), var(--zm-shadow-1)' : 'none',
        textDecoration: 'none',
      }}
    >
      <span style={{ color: tone.color }}>
        <Icon name={node.icon} size={20}/>
      </span>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        textDecoration: 'none',
      }}>{node.label}</span>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 600,
        color: statusColor,
      }}>
        {statusLabel}
      </span>
    </button>
  );
}

function financeStatusOverride(financeStatus) {
  if (financeStatus === 'approved')
    return { label: 'DONE', color: 'var(--zm-success, #2D7A48)' };
  if (financeStatus === 'awaiting_admin' || financeStatus === 'awaiting_supervisor')
    return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  return null; // default 'OPEN'
}

function projectStatusOverride(data) {
  const projectStatus = data?.projectStatus;
  if (projectStatus === 'done') return { label: 'DONE', color: 'var(--zm-success, #2D7A48)' };
  if (data?.designStatus === 'approved' && (ACTIVE_PROJECT_STATUSES.has(projectStatus) || !projectStatus)) {
    return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  }
  return null;
}

function nsoStatusOverride(data) {
  if (data?.nsoStatus === 'complete') return { label: 'DONE', color: 'var(--zm-success, #2D7A48)' };
  if (data?.projectStatus === 'done') return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  return null;
}

function launchStatusOverride(data) {
  if (data?.isLaunched || data?.launchStatus === 'launched') {
    return { label: 'LAUNCHED', color: 'var(--zm-success, #2D7A48)' };
  }
  if (data?.nsoStatus === 'complete') return { label: 'PENDING', color: 'var(--zm-warning, #B45309)' };
  return null;
}

function legalNodeState(data) {
  if (data.siteStatus === 'legal_rejected' || data.legalDdStatus === 'negative') return 'rejected';
  if (
    data.siteStatus === 'legal_approved' ||
    data.siteStatus === 'pushed_to_payments' ||
    (data.legalDdStatus === 'positive' && normalizeAgreementStatus(data) === 'registered' && data.licensingStatus === 'complete')
  ) {
    return 'complete';
  }
  return 'active';
}

function detailNodeState(data, nodeId) {
  if (nodeId === 'loi') return 'complete';
  if (nodeId === 'legal') return legalNodeState(data) === 'rejected' ? 'active' : legalNodeState(data);
  if (nodeId === 'ca') {
    if (data.financeStatus === 'approved' || data.siteStatus === 'pushed_to_payments') return 'complete';
    if (legalNodeState(data) === 'complete') return 'active';
  }
  if (nodeId === 'design') {
    if (data.designStatus === 'approved') return 'complete';
    if (data.financeStatus === 'approved' && data.siteStatus === 'pushed_to_payments') return 'active';
  }
  if (nodeId === 'project') {
    if (data.projectStatus === 'done') return 'complete';
    if (data.designStatus === 'approved') {
      if (!data.projectStatus || ACTIVE_PROJECT_STATUSES.has(data.projectStatus)) return 'active';
    }
  }
  if (nodeId === 'nso') {
    if (data.nsoStatus === 'complete') return 'complete';
    if (data.projectStatus === 'done') return 'active';
  }
  if (nodeId === 'launch') {
    if (data.isLaunched || data.launchStatus === 'launched') return 'complete';
    if (data.nsoStatus === 'complete') return 'active';
  }
  return 'future';
}

function NodeConnector({ complete }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 20,
        height: 2,
        flex: '0 0 20px',
        borderRadius: 999,
        background: complete ? 'var(--zm-success, #2D7A48)' : 'var(--zm-line)',
        opacity: complete ? 0.62 : 0.78,
      }}
    />
  );
}

function NodeDiagram({ selected, onSelect, data }) {
  return (
    <div style={{
      position: 'relative',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, padding: '24px 16px',
      overflowX: 'auto',
    }}>
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: 1040,
      }}>
        {NODES.map((n, index) => {
          const state = detailNodeState(data, n.id);
          const prev = index > 0 ? detailNodeState(data, NODES[index - 1].id) : null;
          return (
            <React.Fragment key={n.id}>
              {index > 0 && <NodeConnector complete={prev === 'complete' && (state === 'complete' || state === 'active')}/>}
              <NodeCard
                node={n}
                selected={selected === n.id}
                onClick={() => onSelect(n.id)}
                state={state}
                statusOverride={
                  n.id === 'ca'
                    ? financeStatusOverride(data.financeStatus)
                    : n.id === 'project'
                      ? projectStatusOverride(data)
                      : n.id === 'nso'
                        ? nsoStatusOverride(data)
                        : n.id === 'launch'
                          ? launchStatusOverride(data)
                          : undefined
                }
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

const PAYMENT_READY_STATUSES = new Set([
  'loi_uploaded', 'legal_review', 'legal_approved', 'pushed_to_payments',
]);

const FINANCE_STATUS_LABELS = {
  pending:              'Not started',
  awaiting_supervisor:  'Awaiting supervisor',
  awaiting_admin:       'Awaiting admin',
  approved:             'Approved',
};

function FinanceStatusBadge({ status }) {
  const colors = {
    pending:             { bg: 'var(--zm-surface-2)', fg: 'var(--zm-fg-3)' },
    awaiting_supervisor: { bg: 'rgba(180,83,9,0.10)',  fg: 'var(--zm-warning, #B45309)' },
    awaiting_admin:      { bg: 'rgba(180,83,9,0.10)',  fg: 'var(--zm-warning, #B45309)' },
    approved:            { bg: 'rgba(45,122,72,0.10)', fg: 'var(--zm-success, #2D7A48)' },
  };
  const { bg, fg } = colors[status] || colors.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px',
      borderRadius: 4, background: bg, color: fg,
      fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      {FINANCE_STATUS_LABELS[status] || status}
    </span>
  );
}

function FinancePanel({ data, role, onClose, onUpdate }) {
  const siteStatus   = data.siteStatus ?? '';
  const accessible   = PAYMENT_READY_STATUSES.has(siteStatus) || Boolean(data.loiUploadedAt);
  const financeStatus = data.financeStatus ?? 'pending';
  const isLocked     = financeStatus !== 'pending';
  const isApproved   = financeStatus === 'approved';

  // Local form state — initialised from data (re-init if data changes via onUpdate)
  const [kycVerified,  setKycVerified]  = React.useState(data.kycVerified  ?? false);
  const [caCode,       setCaCode]       = React.useState(data.caCode       ?? '');
  const [amount,       setAmount]       = React.useState(
    data.financeAmount != null ? String(data.financeAmount) : '',
  );
  const [saving,       setSaving]       = React.useState(false);
  const [requesting,   setRequesting]   = React.useState(false);
  const [approving,    setApproving]    = React.useState(false);
  const [toast,        setToast]        = React.useState(null); // { msg, type }

  // Sync form state when parent data updates (after onUpdate re-fetch)
  React.useEffect(() => {
    setKycVerified(data.kycVerified ?? false);
    setCaCode(data.caCode ?? '');
    setAmount(data.financeAmount != null ? String(data.financeAmount) : '');
  }, [data.kycVerified, data.caCode, data.financeAmount, data.financeStatus]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Save draft ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveFinanceDraft(data.siteId, {
        kycVerified,
        caCode:        caCode.trim() || null,
        financeAmount: amount !== '' ? Number(amount) : undefined,
      });
      showToast('Draft saved.');
      await onUpdate();
    } catch (err) {
      showToast(err?.detail || err?.message || 'Save failed.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  // ── Request approval ──────────────────────────────────────────────────────
  const handleRequestApproval = async () => {
    setRequesting(true);
    try {
      await requestFinanceApproval(data.siteId, {
        kycVerified,
        caCode:        caCode.trim() || null,
        financeAmount: amount !== '' ? Number(amount) : undefined,
      });
      showToast('Approval requested — supervisor notified.');
      await onUpdate();
    } catch (err) {
      showToast(err?.detail || err?.message || 'Request failed.', 'danger');
    } finally {
      setRequesting(false);
    }
  };

  // ── Approve ───────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    setApproving(true);
    try {
      await approveFinance(data.siteId);
      showToast('Finance approved.');
      await onUpdate();
    } catch (err) {
      showToast(err?.detail || err?.message || 'Approval failed.', 'danger');
    } finally {
      setApproving(false);
    }
  };

  const [rejecting, setRejecting] = React.useState(false);
  const handleReject = async () => {
    const reason = window.prompt('Reason for rejection (optional):');
    if (reason === null) return; // user cancelled
    setRejecting(true);
    try {
      await rejectFinance(data.siteId, reason || undefined);
      showToast('Finance sent back for correction.');
      await onUpdate();
    } catch (err) {
      showToast(err?.detail || err?.message || 'Rejection failed.', 'danger');
    } finally {
      setRejecting(false);
    }
  };

  const canSave    = !isLocked && accessible;
  const canRequest = !isLocked && accessible && kycVerified && caCode.trim() && amount !== '';
  const canApproveSupervisor  = role === 'supervisor'      && financeStatus === 'awaiting_supervisor';
  const canApproveAdmin       = role === 'business_admin'  && financeStatus === 'awaiting_admin';
  const canApprove = canApproveSupervisor || canApproveAdmin;

  const inputStyle = (disabled) => ({
    width: '100%', boxSizing: 'border-box',
    height: 34, padding: '0 10px',
    border: '1px solid var(--zm-line)',
    borderRadius: 7,
    background: disabled ? 'var(--zm-surface-2)' : 'var(--zm-surface)',
    color: disabled ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
    fontFamily: 'var(--zm-font-body)', fontSize: 13,
    outline: 'none',
    cursor: disabled ? 'not-allowed' : 'text',
  });

  const btnStyle = (primary, disabled) => ({
    height: 32, padding: '0 14px',
    border: primary ? 'none' : '1px solid var(--zm-line)',
    borderRadius: 7,
    background: primary ? 'var(--zm-accent)' : 'var(--zm-surface)',
    color: primary ? '#fff' : 'var(--zm-fg)',
    fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <aside style={{
      width: 380, flex: '0 0 380px',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, boxShadow: 'var(--zm-shadow-1)',
      display: 'flex', flexDirection: 'column', maxHeight: '80vh', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--zm-line)',
        background: 'var(--zm-surface-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="rupee" size={14}/>
          <span style={{
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11.5,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Finance · CA code
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close finance panel"
          style={{
            width: 28, height: 28, padding: 0, border: '1px solid var(--zm-line)',
            borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="x" size={12}/>
        </button>
      </div>

      <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{
            fontFamily: 'var(--zm-font-body)', fontSize: 11,
            color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>Status</span>
          <FinanceStatusBadge status={financeStatus}/>
        </div>

        {!accessible && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)',
          }}>
            Finance / CA unlocks after LOI upload and can run in parallel with Legal.
          </div>
        )}

        {accessible && (
          <>
            {/* Step 1 — KYC */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{
                fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 11.5,
                textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--zm-fg-2)',
              }}>
                Step 1 · KYC Verification
              </label>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8,
                cursor: isLocked ? 'not-allowed' : 'pointer',
                opacity: isLocked ? 0.6 : 1,
              }}>
                <input
                  type="checkbox"
                  checked={kycVerified}
                  disabled={isLocked}
                  onChange={(e) => setKycVerified(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: 'var(--zm-accent)', cursor: isLocked ? 'not-allowed' : 'pointer' }}
                />
                <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
                  KYC documents verified
                </span>
              </label>
              {kycVerified && !isLocked && (
                <span style={{ fontSize: 11.5, color: 'var(--zm-success, #2D7A48)' }}>
                  ✓ KYC verified — you can now enter the CA code
                </span>
              )}
            </div>

            {/* Step 2 — CA Code (visible only when KYC checked) */}
            {kycVerified && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{
                  fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 11.5,
                  textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--zm-fg-2)',
                }}>
                  Step 2 · CA / Commercial Code
                </label>
                <input
                  type="text"
                  value={caCode}
                  disabled={isLocked}
                  placeholder="e.g. BT-MUM-0042"
                  onChange={(e) => setCaCode(e.target.value)}
                  style={inputStyle(isLocked)}
                />
                {isLocked && data.caCode && (
                  <span style={{ fontSize: 11.5, color: 'var(--zm-fg-3)' }}>
                    Site tracked as <strong>{data.caCode}</strong> across all modules.
                  </span>
                )}
              </div>
            )}

            {/* Step 3 — Amount (visible only when CA code is set) */}
            {kycVerified && caCode.trim() && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{
                  fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 11.5,
                  textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--zm-fg-2)',
                }}>
                  Step 3 · Token Amount (₹)
                </label>
                <input
                  type="number"
                  value={amount}
                  disabled={isLocked}
                  placeholder="Enter token amount in ₹"
                  min={0}
                  onChange={(e) => setAmount(e.target.value)}
                  style={inputStyle(isLocked)}
                />
                {isLocked && data.financeAmount != null && (
                  <span style={{ fontSize: 11.5, color: 'var(--zm-fg-2)' }}>
                    Token amount: <strong>₹{Number(data.financeAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                  </span>
                )}
              </div>
            )}

            {/* Save draft button (only when pending) */}
            {canSave && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={btnStyle(false, saving)}
              >
                {saving ? 'Saving…' : 'Save draft'}
              </button>
            )}

            {/* Request approval (exec / supervisor, pending state, all fields filled) */}
            {!isLocked && (role === 'executive' || role === 'exec' || role === 'supervisor') && (
              <button
                type="button"
                onClick={handleRequestApproval}
                disabled={!canRequest || requesting}
                style={btnStyle(true, !canRequest || requesting)}
              >
                {requesting ? 'Requesting…' : 'Request supervisor approval'}
              </button>
            )}

            {/* Approve button — supervisor seeing awaiting_supervisor */}
            {canApprove && (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approving || rejecting}
                  style={btnStyle(true, approving || rejecting)}
                >
                  {approving
                    ? 'Approving…'
                    : canApproveSupervisor ? 'Forward to admin' : 'Approve finance'}
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={approving || rejecting}
                  style={{
                    ...btnStyle(false, approving || rejecting),
                    color: 'var(--zm-danger, #B91C1C)',
                    borderColor: 'var(--zm-danger, #B91C1C)',
                  }}
                >
                  {rejecting ? 'Rejecting…' : 'Send back'}
                </button>
              </>
            )}

            {/* Final approved state */}
            {isApproved && (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(45,122,72,0.08)', border: '1px solid var(--zm-success, #2D7A48)',
                fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-success, #2D7A48)',
                fontWeight: 700,
              }}>
                ✓ Finance approved — CA code <strong>{data.caCode}</strong> active.
              </div>
            )}
          </>
        )}

        {/* Inline toast */}
        {toast && (
          <div style={{
            padding: '8px 12px', borderRadius: 7, fontSize: 12.5,
            background: toast.type === 'danger'
              ? 'rgba(185,28,28,0.08)'
              : 'rgba(45,122,72,0.08)',
            color: toast.type === 'danger'
              ? 'var(--zm-danger, #B91C1C)'
              : 'var(--zm-success, #2D7A48)',
            border: `1px solid ${toast.type === 'danger'
              ? 'var(--zm-danger, #B91C1C)'
              : 'var(--zm-success, #2D7A48)'}`,
            fontFamily: 'var(--zm-font-body)',
          }}>
            {toast.msg}
          </div>
        )}
      </div>
    </aside>
  );
}

function ComingSoonPanel({ node, onClose }) {
  return (
    <aside style={{
      width: 380, flex: '0 0 380px',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, boxShadow: 'var(--zm-shadow-1)',
      padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11.5,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
        }}>{node.label}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          style={{
            width: 28, height: 28, padding: 0, border: '1px solid var(--zm-line)',
            borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="x" size={12}/>
        </button>
      </div>
      <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
        Coming soon — this node will become interactive once the {node.label} module ships.
      </p>
    </aside>
  );
}

export default function SiteTrackerDetailPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { role } = useSession();
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const requestedNode = searchParams.get('node');
  const [selectedNode, setSelectedNode] = React.useState(
    NODES.some((node) => node.id === requestedNode) && requestedNode !== 'legal'
      ? requestedNode
      : null,
  );

  const load = React.useCallback((silent = false) => {
    if (!siteId) return;
    if (!silent) setState((s) => ({ ...s, status: 'loading' }));
    getSiteTrackerView(siteId)
      .then((data) => setState({ status: 'ready', data, error: null }))
      .catch((err) => setState({
        status: 'error', data: null,
        error: err?.detail || err?.message || 'Failed to load site flow',
      }));
  }, [siteId]);

  React.useEffect(() => { load(); }, [load]);
  useSiteDataRefresh(React.useCallback(() => load(true), [load]), { siteId });
  React.useEffect(() => {
    // Legal is its own full page now; if a stale ?node=legal link arrives,
    // forward to the canonical Legal status page instead of selecting a node.
    if (requestedNode === 'legal') {
      navigate(bdSiteStatusRoute(siteId), { replace: true });
    } else if (NODES.some((node) => node.id === requestedNode)) {
      setSelectedNode(requestedNode);
    }
  }, [requestedNode, navigate, siteId]);

  if (state.status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading…</div>;
  }
  if (state.status === 'error') {
    return <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger, #B91C1C)' }}>{state.error}</div>;
  }

  const data = state.data;
  const verdict = verdictTone(data.dd?.final_verdict);
  const activeNode = NODES.find((n) => n.id === selectedNode);
  // Use CA code as the display identifier once it's set
  const displayCode = data.caCode || data.siteCode || data.siteId;

  // Legal opens the single canonical Legal status page (same page the staging
  // "View" button opens); the other nodes still open their in-place panel.
  const handleNodeSelect = (nodeId) => {
    if (nodeId === 'legal') { navigate(bdSiteStatusRoute(siteId)); return; }
    setSelectedNode(nodeId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow={`Site · ${displayCode}`}
        title={`${data.siteName} flow`}
        lede={`${data.city}${data.submittedByName ? ' · drafted by ' + data.submittedByName : ''}`}
        right={<HeaderTag icon="shield" label={`DD ${verdict.label}`}/>}
      />

      <NodeDiagram
        selected={selectedNode}
        onSelect={handleNodeSelect}
        data={data}
      />

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <div className="zm-glass" style={{
            padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8,
            border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
          }}>
            <div style={{
              fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
            }}>
              Mirror columns (read-only)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Legal DD</div>
                <div style={{ fontWeight: 700 }}>{data.legalDdStatus || 'pending'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Agreement</div>
                <div style={{ fontWeight: 700 }}>{agreementStatusLabel(normalizeAgreementStatus(data))}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Licensing</div>
                <div style={{ fontWeight: 700 }}>{data.licensingStatus || 'pending'}</div>
              </div>
            </div>
            {data.caCode && (
              <div style={{
                marginTop: 4, padding: '6px 10px', borderRadius: 6,
                background: 'rgba(45,122,72,0.07)', border: '1px solid var(--zm-success, #2D7A48)',
                fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-success, #2D7A48)',
              }}>
                CA code active: <strong>{data.caCode}</strong>
                {' '}— site is tracked as this code across all modules.
              </div>
            )}
            <p style={{ margin: 0, fontSize: 12, color: 'var(--zm-fg-3)' }}>
              Click <strong>Legal</strong> to open the full legal status page — DD,
              agreement, licensing &amp; flip-to-Yes requests. Click{' '}
              <strong>CA / Commercial Code</strong> to manage the finance workflow.
            </p>
          </div>
        </div>

        {activeNode?.id === 'ca' && (
          <FinancePanel
            data={data}
            role={role}
            onClose={() => setSelectedNode(null)}
            onUpdate={() => load(true)}
          />
        )}
        {activeNode && !activeNode.interactive && activeNode.id !== 'legal' && activeNode.id !== 'ca' && (
          <ComingSoonPanel node={activeNode} onClose={() => setSelectedNode(null)}/>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            height: 32, padding: '0 14px', border: '1px solid var(--zm-line)',
            borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg)',
            fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ← Back to flow
        </button>
      </div>
    </div>
  );
}
