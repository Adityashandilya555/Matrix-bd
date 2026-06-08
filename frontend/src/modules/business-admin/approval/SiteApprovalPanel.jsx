import React from 'react';
import { T, Icon, Card, Button, StatusPill, Skeleton, inr, TABULAR } from '../ui/kit.jsx';

// Everything pending on a single site, grouped by approval type, actionable in
// one place. Rendered inside the Approval Center drawer. Each block owns its own
// busy/comment state; decisions bubble up to the shell which refetches.

const KIND_LABEL = { recce: 'Recce', '2d': '2D design', '3d': '3D design', boq: 'BOQ + estimate' };

function BlockShell({ icon: BIcon, tone, title, amount, children }) {
  const tones = { design: T.accentText, payment: T.warnText, project: T.projectText };
  const toneBg = { design: T.accentSoft, payment: T.warnSoft, project: T.projectSoft };
  return (
    <Card raised style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        paddingBottom: 12, borderBottom: `1px solid ${T.line}` }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', background: toneBg[tone] || T.chip, color: tones[tone] || T.textMuted }}>
          <BIcon size={16} />
        </span>
        <strong style={{ fontSize: 13.5, color: T.text, letterSpacing: '-0.01em' }}>{title}</strong>
        <span style={{ flex: 1 }} />
        {amount != null && (
          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.successText, ...TABULAR }}>{inr(amount)}</span>
        )}
      </div>
      {children}
    </Card>
  );
}

const fileLink = (d) => (d.downloadUrl
  ? <a className="ac-link" href={d.downloadUrl} target="_blank" rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: T.accentText, fontSize: 12.5, wordBreak: 'break-all' }}>
      <Icon.doc size={13} />{d.fileName || 'Open document'}<Icon.external size={12} /></a>
  : <span style={{ fontSize: 12.5, color: T.textMuted }}>{d.fileName || '(no file)'}</span>);

const taStyle = {
  width: '100%', boxSizing: 'border-box', minHeight: 60, padding: '10px 12px', borderRadius: T.radiusSm,
  border: `1px solid ${T.lineStrong}`, background: T.chip, color: T.text, fontSize: 12.5,
  resize: 'vertical', marginBottom: 10, fontFamily: 'inherit', lineHeight: 1.55,
};

// ── Design 2D/3D deliverables ────────────────────────────────────────────────
function DeliverablesBlock({ siteId, deliverables, onDecide }) {
  const [comments, setComments] = React.useState({});
  const [busy, setBusy] = React.useState(null);
  const decide = async (kind, decision) => {
    const c = comments[kind] || '';
    if (decision === 'reject' && !c.trim()) { window.alert('Comments are required to send back.'); return; }
    setBusy(kind);
    try { await onDecide(siteId, kind, { decision, comments: c }); }
    catch (e) { window.alert(e?.detail || e?.message || 'Decision failed'); }
    finally { setBusy(null); }
  };
  return deliverables.map((d, i) => (
    <div key={d.kind} style={{ borderTop: i === 0 ? 'none' : `1px solid ${T.line}`, paddingTop: i === 0 ? 0 : 12, marginTop: i === 0 ? 0 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 9 }}>
        <span style={{ fontWeight: 700, fontSize: 12.5, color: T.text }}>{KIND_LABEL[d.kind] || d.kind}</span>
        {fileLink(d)}
      </div>
      <textarea className="ac-input" style={taStyle} placeholder="Comments (required to send back)"
        value={comments[d.kind] || ''} onChange={(e) => setComments((c) => ({ ...c, [d.kind]: e.target.value }))} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="success" size="sm" loading={busy === d.kind} icon={busy !== d.kind && <Icon.check size={14} />}
          onClick={() => decide(d.kind, 'approve')}>Approve</Button>
        <Button variant="danger" size="sm" disabled={busy === d.kind} icon={<Icon.x size={14} />}
          onClick={() => decide(d.kind, 'reject')}>Send back</Button>
      </div>
    </div>
  ));
}

// ── Design GFC (Good-For-Construction) ───────────────────────────────────────
function GfcBlock({ siteId, fetchReview, onDecide }) {
  const [detail, setDetail] = React.useState(null);
  const [comments, setComments] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    fetchReview(siteId).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setDetail({ deliverables: [] }); });
    return () => { live = false; };
  }, [siteId, fetchReview]);
  const decide = async (decision) => {
    if (decision === 'reject' && !comments.trim()) { window.alert('Comments are required to send back.'); return; }
    setBusy(true);
    try { await onDecide(siteId, { decision, comments }); }
    catch (e) { window.alert(e?.detail || e?.message || 'Decision failed'); }
    finally { setBusy(false); }
  };
  if (!detail) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton h={14} w="60%" /><Skeleton h={14} w="80%" /><Skeleton h={14} w="48%" />
    </div>
  );
  const deliverables = detail.deliverables || [];
  return (
    <>
      {deliverables.length > 0 ? (
        <div style={{ display: 'grid', gap: 10, marginBottom: 14, padding: '10px 0' }}>
          {deliverables.map((d) => (
            <div key={d.kind} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, flexWrap: 'wrap' }}>
              <span style={{ width: 110, color: T.textMuted, flexShrink: 0, fontWeight: 600 }}>{KIND_LABEL[d.kind] || d.kind}</span>
              <StatusPill status={d.status} />
              {fileLink(d)}
              {d.kind === 'boq' && d.estimatedAmount != null && (
                <span style={{ fontFamily: T.mono, color: T.successText, ...TABULAR }}>{inr(d.estimatedAmount)}</span>)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '10px 12px',
          borderRadius: T.radiusSm, background: T.accentSoft, color: T.accentText, fontSize: 12.5 }}>
          <Icon.shield size={14} style={{ flexShrink: 0 }} />
          All supervisor-approved deliverables are attached. Approve to issue Good-For-Construction.
        </div>
      )}
      <textarea className="ac-input" style={taStyle} placeholder="Add comments (required when sending back)"
        value={comments} onChange={(e) => setComments(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <Button variant="success" size="md" loading={busy} icon={!busy && <Icon.check size={15} />}
          onClick={() => decide('approve')}>Approve GFC</Button>
        <Button variant="danger" size="md" disabled={busy} icon={<Icon.x size={15} />}
          onClick={() => decide('reject')}>Send back</Button>
      </div>
    </>
  );
}

// ── Payment / finance (admin final approval — approve-only per backend) ───────
function PaymentBlock({ site, onApprove }) {
  const [busy, setBusy] = React.useState(false);
  const approve = async () => {
    setBusy(true);
    try { await onApprove(site.siteId); }
    catch (e) { window.alert(e?.detail || e?.message || 'Approval failed'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 12.5 }}>
        <div><div style={{ color: T.textFaint, fontSize: 11 }}>CA code</div>
          <div style={{ fontFamily: T.mono, color: T.text }}>{site.payment.caCode || '—'}</div></div>
        <div><div style={{ color: T.textFaint, fontSize: 11 }}>Amount</div>
          <div style={{ fontFamily: T.mono, color: T.successText, ...TABULAR }}>{inr(site.payment.financeAmount)}</div></div>
      </div>
      <div style={{ fontSize: 11.5, color: T.textFaint, marginBottom: 10 }}>Supervisor-approved — awaiting your final sign-off.</div>
      <Button variant="success" size="md" loading={busy} icon={!busy && <Icon.check size={15} />}
        onClick={approve}>Approve payment</Button>
    </>
  );
}

// ── Project budget (tier-2 admin) ────────────────────────────────────────────
function BudgetBlock({ site, onDecide }) {
  const [comments, setComments] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const decide = async (decision) => {
    if (decision === 'reject' && !comments.trim()) { window.alert('Comments are required to send back.'); return; }
    setBusy(true);
    try { await onDecide(site.siteId, { decision, comments }); }
    catch (e) { window.alert(e?.detail || e?.message || 'Decision failed'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <textarea className="ac-input" style={taStyle} placeholder="Add comments (required when sending back)"
        value={comments} onChange={(e) => setComments(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button variant="success" size="md" loading={busy} icon={!busy && <Icon.check size={15} />}
          onClick={() => decide('approve')}>Approve budget</Button>
        <Button variant="danger" size="md" disabled={busy} icon={<Icon.x size={15} />}
          onClick={() => decide('reject')}>Send back</Button>
      </div>
    </>
  );
}

export default function SiteApprovalPanel({ site, handlers }) {
  const { design, payment, project } = site;
  const hasDeliverables = design?.deliverables?.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {hasDeliverables && (
        <BlockShell icon={Icon.layers} tone="design" title="2D / 3D approvals">
          <DeliverablesBlock siteId={site.siteId} deliverables={design.deliverables} onDecide={handlers.onDeliverableDecide} />
        </BlockShell>
      )}
      {design?.gfcPending && (
        <BlockShell icon={Icon.shield} tone="design" title="GFC approval" amount={design.boqAmount}>
          <GfcBlock siteId={site.siteId} fetchReview={handlers.fetchGfcReview} onDecide={handlers.onGfcDecide} />
        </BlockShell>
      )}
      {payment && (
        <BlockShell icon={Icon.wallet} tone="payment" title="Payment approval" amount={payment.financeAmount}>
          <PaymentBlock site={site} onApprove={handlers.onApproveFinance} />
        </BlockShell>
      )}
      {project && (
        <BlockShell icon={Icon.wrench} tone="project" title="Project budget approval" amount={project.budgetTotal}>
          <BudgetBlock site={site} onDecide={handlers.onBudgetDecide} />
        </BlockShell>
      )}
    </div>
  );
}
