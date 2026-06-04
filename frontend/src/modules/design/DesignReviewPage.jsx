import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { ROUTES } from '../../router/routes.js';
import { listMyTeam } from '../../services/api/adapters/httpAdapter.js';
import {
  getDesignReview, allocateDesign, revokeDesignAllocation,
  listDesignDelegationsForSite, submitDeliverable, uploadDeliverable, reviewDeliverable,
} from '../../services/api/designApi.js';

const KINDS = ['recce', '2d', '3d', 'boq'];
const KIND_LABEL = { recce: 'Recce', '2d': '2D design', '3d': '3D design', boq: 'BOQ + estimate' };
const KIND_NUM = { recce: '01', '2d': '02', '3d': '03', boq: '04' };

const DELIV_TONE = {
  pending:   { label: 'Not uploaded', color: 'var(--zm-fg-3)' },
  submitted: { label: 'In review',    color: 'var(--zm-accent)' },
  approved:  { label: 'Approved',     color: 'var(--zm-success)' },
  rejected:  { label: 'Sent back',    color: 'var(--zm-danger)' },
};

function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 9px',
      borderRadius: 4, border: `1px solid ${color}`, color,
      fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 9.5,
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }}>{label}</span>
  );
}

const btn = (bg) => ({
  height: 32, padding: '0 14px', border: 'none', borderRadius: 7,
  background: bg, color: '#fff', fontFamily: 'var(--zm-font-body)',
  fontSize: 12, fontWeight: 800, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
});
const input = {
  height: 32, padding: '0 10px', borderRadius: 7, boxSizing: 'border-box', maxWidth: '100%',
  border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
  color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, width: '100%',
};

function CommentBlock({ who, text, danger }) {
  return (
    <div style={{
      fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)',
      background: 'var(--zm-surface-2)', borderRadius: 7, padding: '8px 10px', margin: '6px 0',
      borderLeft: `2px solid ${danger ? 'var(--zm-danger)' : 'var(--zm-success)'}`,
      wordBreak: 'break-word', overflowWrap: 'anywhere',
    }}>
      <strong>{who}:</strong> {text}
    </div>
  );
}

function DeliverableCard({ kind, deliverable, isActive, isExecutive, isSupervisor, canSelfUpload, busy, onSubmit, onUpload, onReview }) {
  const status = deliverable?.status || 'pending';
  const adminStatus = deliverable?.adminStatus || 'pending';
  const tone = DELIV_TONE[status] || DELIV_TONE.pending;
  const isBoq = kind === 'boq';
  const needsAdmin = kind === '2d' || kind === '3d';
  const [file, setFile] = React.useState(null);
  const [amount, setAmount] = React.useState('');
  const [comments, setComments] = React.useState('');

  // Only show the upload form when a file hasn't been submitted yet (or was sent back).
  // Hide it once the file is 'submitted' (awaiting review) to avoid confusion.
  const canUpload = (isExecutive || canSelfUpload) && isActive && (status === 'pending' || status === 'rejected');
  const canReview = isSupervisor && isActive && status === 'submitted';
  const awaitingAdmin = needsAdmin && status === 'approved' && adminStatus !== 'approved';
  const dim = !isActive && status === 'pending';

  return (
    <div className="zm-glass" style={{
      borderRadius: 12, padding: 16, opacity: dim ? 0.55 : 1, minWidth: 0,
      border: isActive ? '1px solid var(--zm-accent-line)' : '1px solid var(--zm-line)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11, color: 'var(--zm-fg-3)' }}>{KIND_NUM[kind]}</span>
        <strong style={{ fontFamily: 'var(--zm-font-body)', fontSize: 14, color: 'var(--zm-fg)' }}>{KIND_LABEL[kind]}</strong>
        {isActive && <Badge label="Active" color="var(--zm-accent)"/>}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexShrink: 0 }}>
          {awaitingAdmin && <Badge label="Awaiting admin" color="var(--zm-copper)"/>}
          <Badge label={tone.label} color={tone.color}/>
        </span>
      </div>

      {(deliverable?.fileName || deliverable?.downloadUrl) && (
        <div style={{ fontSize: 12.5, color: 'var(--zm-fg-2)', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
          <span style={{ flexShrink: 0, marginTop: 2 }}><Icon name="file" size={12}/></span>
          {deliverable.downloadUrl
            ? <a href={deliverable.downloadUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--zm-accent)', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{deliverable.fileName || 'Open document'}</a>
            : <span style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{deliverable.fileName}</span>}
        </div>
      )}
      {isBoq && deliverable?.estimatedAmount != null && (
        <div style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 13, color: 'var(--zm-fg)', marginBottom: 6 }}>
          Estimate: ₹{Number(deliverable.estimatedAmount).toLocaleString('en-IN')}
        </div>
      )}
      {deliverable?.supervisorComments && <CommentBlock who="Supervisor" text={deliverable.supervisorComments} danger={status === 'rejected'}/>}
      {deliverable?.adminComments && <CommentBlock who="Admin" text={deliverable.adminComments} danger={status === 'rejected'}/>}

      {awaitingAdmin && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--zm-fg-3)', lineHeight: 1.5 }}>
          Approved by the supervisor — waiting for the business-admin's approval before the next stage.
        </p>
      )}

      {canUpload && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {isBoq ? (
            <input style={input} type="number" placeholder="Estimated amount (₹)" value={amount} onChange={(e) => setAmount(e.target.value)}/>
          ) : (
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ ...input, height: 'auto', padding: '7px 10px', cursor: 'pointer' }}
            />
          )}
          <button
            type="button"
            disabled={busy || (!isBoq && !file)}
            style={{ ...btn('var(--zm-accent)'), alignSelf: 'flex-start', opacity: (busy || (!isBoq && !file)) ? 0.6 : 1 }}
            onClick={() => (isBoq ? onSubmit(kind, { estimatedAmount: amount }) : onUpload(kind, file))}
          >
            {status === 'rejected'
              ? (isBoq ? 'Re-submit' : 'Re-upload')
              : isBoq
                ? (canSelfUpload ? 'Submit & approve' : 'Submit for review')
                : (canSelfUpload ? 'Upload & approve' : 'Upload & submit')}
            <Icon name="arrow-right" size={12}/>
          </button>
        </div>
      )}

      {canReview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <textarea
            placeholder="Comments (required to send back)"
            value={comments} onChange={(e) => setComments(e.target.value)}
            style={{ ...input, height: 64, padding: 10, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} style={{ ...btn('var(--zm-success)'), opacity: busy ? 0.6 : 1 }}
              onClick={() => onReview(kind, { decision: 'approve', comments })}>
              Approve
            </button>
            <button type="button" disabled={busy} style={{ ...btn('var(--zm-danger)'), opacity: busy ? 0.6 : 1 }}
              onClick={() => onReview(kind, { decision: 'reject', comments })}>
              Send back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DesignReviewPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { role } = useSession();
  const isSupervisor = role === 'supervisor';
  const isExecutive = role === 'executive' || role === 'exec';

  const [review, setReview] = React.useState(null);
  const [status, setStatus] = React.useState('loading'); // loading | ready | error
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const [team, setTeam] = React.useState([]);
  const [allocation, setAllocation] = React.useState(null);
  const [chosenExec, setChosenExec] = React.useState('');

  const load = React.useCallback(async () => {
    setStatus('loading'); setError(null);
    try {
      const r = await getDesignReview(siteId);
      setReview(r); setStatus('ready');
    } catch (err) {
      setError(err?.detail || err?.message || 'Failed to load design review'); setStatus('error');
    }
  }, [siteId]);

  React.useEffect(() => { load(); }, [load]);

  // Supervisor: load their design team + the active allocation for this site.
  const designStatus = review?.designStatus;
  React.useEffect(() => {
    if (!isSupervisor) return;
    let cancelled = false;
    (async () => {
      try { const t = await listMyTeam('design'); if (!cancelled) setTeam(t); } catch { /* silent */ }
      try { const d = await listDesignDelegationsForSite(siteId); if (!cancelled) setAllocation(d.items?.[0] || null); } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [isSupervisor, siteId, designStatus]);

  const onAllocate = async () => {
    if (!chosenExec) return;
    setBusy(true);
    try {
      const r = await allocateDesign(siteId, chosenExec);
      setReview(r); setChosenExec('');
      const d = await listDesignDelegationsForSite(siteId);
      setAllocation(d.items?.[0] || null);
    } catch (err) { window.alert(err?.detail || err?.message || 'Allocation failed'); }
    finally { setBusy(false); }
  };

  const onRevoke = async () => {
    if (!allocation) return;
    setBusy(true);
    try { await revokeDesignAllocation(siteId, allocation.delegateUserId); setAllocation(null); await load(); }
    catch (err) { window.alert(err?.detail || err?.message || 'Revoke failed'); }
    finally { setBusy(false); }
  };

  const onSubmit = async (kind, payload) => {
    setBusy(true);
    try { const r = await submitDeliverable(siteId, kind, payload); setReview(r); }
    catch (err) { window.alert(err?.detail || err?.message || 'Submit failed'); }
    finally { setBusy(false); }
  };

  const onUpload = async (kind, file) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadDeliverable(siteId, kind, file);
      setReview(r);
      // After a successful upload the DeliverableCard hides its file input
      // (status flips to 'submitted'), so we don't need to reset local file
      // state explicitly — the card unmounts/remounts with fresh state.
    }
    catch (err) { window.alert(err?.detail || err?.message || 'Upload failed'); }
    finally { setBusy(false); }
  };

  const onReview = async (kind, payload) => {
    if (payload.decision === 'reject' && !payload.comments?.trim()) {
      window.alert('Comments are required to send a deliverable back.'); return;
    }
    setBusy(true);
    try { const r = await reviewDeliverable(siteId, kind, payload); setReview(r); }
    catch (err) { window.alert(err?.detail || err?.message || 'Review failed'); }
    finally { setBusy(false); }
  };

  if (status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading…</div>;
  }
  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button type="button" onClick={() => navigate(ROUTES.DESIGN)} style={{ ...btn('var(--zm-fg-3)'), alignSelf: 'flex-start' }}>
          <Icon name="arrow-right" size={12}/> Back to queue
        </button>
        <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{error}</div>
      </div>
    );
  }

  const r = review;
  const deliverableFor = (kind) => r.deliverables.find((d) => d.kind === kind);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file={`Site · ${r.siteCode || ''}`}
        eyebrow="Design module"
        title={<>{r.siteName}</>}
        lede={`${r.city || ''} · stage: ${r.currentStage} · design ${r.designStatus}`}
        right={<HeaderTag icon="box" label={(r.designStatus || '').toUpperCase()}/>}
      />

      <button type="button" onClick={() => navigate(ROUTES.DESIGN)} style={{ ...btn('var(--zm-surface-2)'), color: 'var(--zm-fg-2)', alignSelf: 'flex-start' }}>
        ← Back to queue
      </button>

      {/* Allocation — supervisor only */}
      {isSupervisor && (
        <div className="zm-glass" style={{ borderRadius: 12, padding: 16 }}>
          <div style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 10 }}>
            Allocation
          </div>
          {allocation ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Badge label={`Allocated · ${allocation.delegateName || allocation.delegateEmail}`} color="var(--zm-accent)"/>
              <button type="button" disabled={busy} onClick={onRevoke} style={{ ...btn('var(--zm-danger)'), opacity: busy ? 0.6 : 1 }}>Revoke</button>
            </div>
          ) : r.designStatus === 'pending' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select value={chosenExec} onChange={(e) => setChosenExec(e.target.value)} style={{ ...input, width: 240 }}>
                  <option value="">Select a design executive…</option>
                  {team.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
                <button type="button" disabled={busy || !chosenExec} onClick={onAllocate} style={{ ...btn('var(--zm-accent)'), opacity: (busy || !chosenExec) ? 0.6 : 1 }}>
                  Allocate
                </button>
                {team.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--zm-fg-3)' }}>No design executives on your team yet.</span>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--zm-fg-3)' }}>
                — or just upload the deliverables below to handle this site yourself (only the admin's GFC approval is then required).
              </span>
            </div>
          ) : (
            <Badge label="Handling directly · no executive" color="var(--zm-accent)"/>
          )}
        </div>
      )}

      {/* Deliverables */}
      <div style={{ display: 'grid', gap: 12 }}>
        {KINDS.map((kind) => (
          <DeliverableCard
            key={kind}
            kind={kind}
            deliverable={deliverableFor(kind)}
            isActive={r.currentStage === kind}
            isExecutive={isExecutive}
            isSupervisor={isSupervisor}
            canSelfUpload={isSupervisor && !allocation}
            busy={busy}
            onSubmit={onSubmit}
            onUpload={onUpload}
            onReview={onReview}
          />
        ))}
      </div>

      {/* GFC gate (read-only here — the business admin approves it in their portal) */}
      <div className="zm-glass" style={{ borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <strong style={{ fontFamily: 'var(--zm-font-body)', fontSize: 14, color: 'var(--zm-fg)' }}>GFC · Good-For-Construction</strong>
          <span style={{ marginLeft: 'auto' }}>
            <Badge
              label={r.gfcStatus === 'approved' ? 'Approved' : r.gfcStatus === 'rejected' ? 'Sent back' : (r.designStatus === 'gfc_pending' ? 'Awaiting admin' : 'Pending')}
              color={r.gfcStatus === 'approved' ? 'var(--zm-success)' : r.gfcStatus === 'rejected' ? 'var(--zm-danger)' : 'var(--zm-copper)'}
            />
          </span>
        </div>
        <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>
          {r.designStatus === 'gfc_pending'
            ? 'BOQ approved — the business admin gives the final GFC sign-off from the Business Admin portal.'
            : r.gfcStatus === 'approved'
              ? 'Design complete — Good-For-Construction approved.'
              : 'Becomes active once the BOQ is approved.'}
        </p>
        {r.gfcComments && (
          <div style={{ marginTop: 8, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-2)', background: 'var(--zm-surface-2)', borderRadius: 7, padding: '8px 10px' }}>
            <strong>Admin:</strong> {r.gfcComments}
          </div>
        )}
      </div>
    </div>
  );
}
