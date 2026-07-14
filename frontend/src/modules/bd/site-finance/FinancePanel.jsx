import React from 'react';
import Icon from '../../shared/primitives/Icon.jsx';
import {
  saveFinanceDraft,
  requestFinanceApproval,
  approveFinance,
  rejectFinance,
} from '../../../services/api/siteTrackerApi.js';

// The CA / Commercial-code finance workflow. Rendered either as a focused full
// page (mode="page", from SiteFinancePage) or — kept for flexibility — as a
// side panel (mode="modal"). The form logic is identical; only the outer chrome
// differs so the page variant fills the content column like the Site status page.

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

export default function FinancePanel({ data, role, onClose, onUpdate, mode = 'modal' }) {
  const isPage = mode === 'page';
  const kycId    = React.useId();
  const caCodeId = React.useId();
  const amountId = React.useId();
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

  const toastTimer = React.useRef(null);
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };
  React.useEffect(() => () => clearTimeout(toastTimer.current), []);

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
      width: isPage ? '100%' : 380,
      maxWidth: isPage ? 560 : undefined,
      flex: isPage ? undefined : '0 0 380px',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, boxShadow: 'var(--zm-shadow-1)',
      display: 'flex', flexDirection: 'column',
      maxHeight: isPage ? undefined : '80vh', overflow: 'hidden',
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
        {!isPage && (
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
        )}
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
              <label htmlFor={kycId} style={{
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
                  id={kycId}
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
                <label htmlFor={caCodeId} style={{
                  fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 11.5,
                  textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--zm-fg-2)',
                }}>
                  Step 2 · CA / Commercial Code
                </label>
                <input
                  id={caCodeId}
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
                <label htmlFor={amountId} style={{
                  fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 11.5,
                  textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--zm-fg-2)',
                }}>
                  Step 3 · Token Amount (₹)
                </label>
                <input
                  id={amountId}
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
