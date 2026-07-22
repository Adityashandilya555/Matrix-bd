// skipcq: JS-0833
import React from 'react';
import { T, Icon, Card, Button, StatusPill, Skeleton, inr, TABULAR } from '../ui/kit.jsx';
import { CIVIL_MEP_IDX, formatRatio, sumByIdx } from '../../../lib/budgetMetrics.js';

// Everything pending on a single site, grouped by approval type, actionable in
// one place. Rendered inside the Approval Center drawer. Each block owns its own
// busy/comment state; decisions bubble up to the shell which refetches.

const KIND_LABEL = { recce: 'Recce', '2d': '2D design', '3d': '3D design', boq: 'BOQ + estimate' };
const DESIGN_CONTEXT_KINDS = ['recce', '2d', '3d'];

// Legal due-diligence status → human label for the finance sign-off card.
// Mirrors the sites.legal_dd_status domain (pending | in_review | positive |
// negative); by the time a site reaches finance it is normally 'positive'.
const LEGAL_DD_LABEL = {
  positive: 'Cleared',
  negative: 'Failed',
  in_review: 'In review',
  pending: 'Pending',
};
const legalDdLabel = (value) => LEGAL_DD_LABEL[value] || (value ? pretty(value) : 'Pending');

const pretty = (value) => {
  if (value == null || value === '') return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

const dateText = (value) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

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
  const [errs, setErrs] = React.useState({}); // per-kind inline error, replaces blocking window.alert (#139)
  const decide = async (kind, decision) => {
    const c = comments[kind] || '';
    setErrs((e) => ({ ...e, [kind]: null }));
    if (decision === 'reject' && !c.trim()) { setErrs((e) => ({ ...e, [kind]: 'Comments are required to send back.' })); return; }
    setBusy(kind);
    try { await onDecide(siteId, kind, { decision, comments: c }); }
    catch (e) { setErrs((er) => ({ ...er, [kind]: e?.detail || e?.message || 'Decision failed' })); }
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
      {errs[d.kind] && <div role="alert" style={{ color: T.dangerText, fontSize: 12, margin: '6px 0' }}>{errs[d.kind]}</div>}
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
  const [err, setErr] = React.useState(null); // inline error, replaces blocking window.alert (#139)
  React.useEffect(() => {
    let live = true;
    fetchReview(siteId).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setDetail({ deliverables: [] }); });
    return () => { live = false; };
  }, [siteId, fetchReview]);
  const decide = async (decision) => {
    setErr(null);
    if (decision === 'reject' && !comments.trim()) { setErr('Comments are required to send back.'); return; }
    setBusy(true);
    try { await onDecide(siteId, { decision, comments }); }
    catch (e) { setErr(e?.detail || e?.message || 'Decision failed'); }
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
      {err && <div role="alert" style={{ color: T.dangerText, fontSize: 12, margin: '6px 0' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <Button variant="success" size="md" loading={busy} icon={!busy && <Icon.check size={15} />}
          onClick={() => decide('approve')}>Approve GFC</Button>
        <Button variant="danger" size="md" disabled={busy} icon={<Icon.x size={15} />}
          onClick={() => decide('reject')}>Send back</Button>
      </div>
    </>
  );
}

// ── Payment / finance (admin final sign-off: approve or send back) ────────────
function PaymentBlock({ site, onApprove, onReject }) {
  const [comments, setComments] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null); // inline error, replaces blocking window.alert (#139)
  const decide = async (decision) => {
    setErr(null);
    if (decision === 'reject' && !comments.trim()) { setErr('Comments are required to send back.'); return; }
    setBusy(true);
    try {
      if (decision === 'approve') await onApprove(site.siteId);
      else await onReject(site.siteId, comments.trim());
    }
    catch (e) { setErr(e?.detail || e?.message || 'Decision failed'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 12.5 }}>
        <RequestMeta label="Submitted by" value={site.payment.submittedByName || site.createdByName} />
        <RequestMeta label="KYC status" value={site.payment.kycVerified ? 'Verified' : 'Pending'} />
        <RequestMeta label="Legal DD" value={legalDdLabel(site.payment.legalDdStatus)} />
        <div><div style={{ color: T.textFaint, fontSize: 11 }}>CA code</div>
          <div style={{ fontFamily: T.mono, color: T.text }}>{site.payment.caCode || '—'}</div></div>
        <div><div style={{ color: T.textFaint, fontSize: 11 }}>Finance amount</div>
          <div style={{ fontFamily: T.mono, color: T.successText, ...TABULAR }}>{inr(site.payment.financeAmount)}</div></div>
      </div>
      <div style={{ fontSize: 11.5, color: T.textFaint, marginBottom: 10 }}>Supervisor-approved — awaiting your final sign-off.</div>
      <textarea className="ac-input" style={taStyle} placeholder="Add comments (required when sending back)"
        value={comments} onChange={(e) => setComments(e.target.value)} />
      {err && <div role="alert" style={{ color: T.dangerText, fontSize: 12, margin: '6px 0' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <Button variant="success" size="md" loading={busy} icon={!busy && <Icon.check size={15} />}
          onClick={() => decide('approve')}>Approve payment</Button>
        <Button variant="danger" size="md" disabled={busy} icon={<Icon.x size={15} />}
          onClick={() => decide('reject')}>Send back</Button>
      </div>
    </>
  );
}

// ── Project budget (tier-2 admin) ────────────────────────────────────────────

const present = (value, fallback = '—') => (value == null || value === '' ? fallback : value);

function RequestMeta({ label, value }) {
  return (
    <div>
      <div style={{ color: T.textFaint, fontSize: 11 }}>{label}</div>
      <div style={{ color: T.text, fontSize: 12.5, fontWeight: 650 }}>{present(value)}</div>
    </div>
  );
}

function metricRow(label, value) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
      <span style={{ flex: 1, color: T.textMuted }}>{label}</span>
      <span style={{ fontFamily: T.mono, color: T.text, ...TABULAR }}>{value}</span>
    </div>
  );
}

function DetailLoadError({ message, onRetry }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 12px',
      borderRadius: T.radiusSm,
      border: `1px solid ${T.danger || '#b91c1c'}`,
      background: 'rgba(185,28,28,0.08)',
      color: T.danger || '#b91c1c',
      fontSize: 12.5,
      marginBottom: 12,
    }}>
      <span>{message}</span>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button>
      )}
    </div>
  );
}

function DesignArtifactRow({ deliverable, kind }) {
  const status = deliverable?.status || 'pending';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '120px minmax(90px, auto) minmax(0, 1fr)',
      gap: 10,
      alignItems: 'center',
      fontSize: 12.5,
      padding: '8px 0',
      borderTop: `1px solid ${T.line}`,
    }}>
      <span style={{ color: T.textMuted, fontWeight: 750 }}>{KIND_LABEL[kind] || kind}</span>
      <StatusPill status={status} />
      {deliverable ? fileLink(deliverable) : <span style={{ color: T.textFaint }}>No artifact yet</span>}
    </div>
  );
}

// ── BOQ approval: final Design-completion gate ───────────────────────────────
function BoqApprovalBlock({ siteId, deliverable, fetchReview, onDecide }) {
  const [detail, setDetail] = React.useState(null);
  const [detailError, setDetailError] = React.useState(null);
  const [comments, setComments] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState(null);

  const loadDetail = React.useCallback(() => {
    let live = true;
    setDetailError(null);
    if (!fetchReview) {
      setDetail({ deliverables: deliverable ? [deliverable] : [] });
      return () => { live = false; };
    }
    fetchReview(siteId)
      .then((d) => {
        if (!live) return;
        setDetail(d || { deliverables: [] });
      })
      .catch((err) => {
        if (!live) return;
        setDetail({ deliverables: deliverable ? [deliverable] : [] });
        setDetailError(err?.detail || err?.message || 'Could not load BOQ approval details.');
      });
    return () => { live = false; };
  }, [deliverable, fetchReview, siteId]);

  React.useEffect(() => loadDetail(), [loadDetail]);

  const decide = async (decision) => {
    setActionError(null);
    if (decision === 'reject' && !comments.trim()) {
      setActionError('Comments are required to send BOQ back.');
      return;
    }
    setBusy(true);
    try {
      await onDecide(siteId, 'boq', { decision, comments });
    } catch (e) {
      setActionError(e?.detail || e?.message || 'Decision failed');
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton h={14} w="65%" /><Skeleton h={14} w="92%" /><Skeleton h={14} w="50%" />
    </div>
  );

  const deliverables = detail.deliverables || [];
  const byKind = Object.fromEntries(deliverables.map((d) => [d.kind, d]));
  const boq = byKind.boq || deliverable || {};
  const boqAmount = boq.estimatedAmount ?? deliverable?.estimatedAmount ?? null;

  return (
    <>
      {detailError && <DetailLoadError message={detailError} onRetry={loadDetail} />}

      <div style={{
        display: 'grid',
        gap: 10,
        padding: 12,
        borderRadius: T.radiusSm,
        background: T.chip,
        border: `1px solid ${T.line}`,
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <RequestMeta label="GFC status" value={pretty(detail.gfcStatus)} />
          <RequestMeta label="GFC decided" value={dateText(detail.gfcDecidedAt)} />
          <RequestMeta label="Submitted by" value={detail.submittedByName || '—'} />
        </div>
        {detail.gfcComments && (
          <div style={{ color: T.textMuted, fontSize: 12.5, lineHeight: 1.5 }}>
            <strong style={{ color: T.text }}>GFC comments:</strong> {detail.gfcComments}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: T.textFaint,
          marginBottom: 4,
        }}>
          Design context package
        </div>
        {DESIGN_CONTEXT_KINDS.map((kind) => (
          <DesignArtifactRow key={kind} kind={kind} deliverable={byKind[kind]} />
        ))}
      </div>

      <div style={{
        display: 'grid',
        gap: 10,
        borderTop: `1px solid ${T.line}`,
        paddingTop: 12,
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 12.5, color: T.text }}>BOQ + estimate</span>
          <StatusPill status={boq.status || 'approved'} />
          {fileLink(boq)}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <RequestMeta label="BOQ amount" value={boqAmount == null ? '—' : inr(boqAmount)} />
          <RequestMeta label="Supervisor reviewed" value={dateText(boq.reviewedAt || deliverable?.reviewedAt)} />
          <RequestMeta label="Submitted" value={dateText(boq.submittedAt || deliverable?.submittedAt)} />
        </div>
        {boq.supervisorComments && (
          <div style={{ color: T.textMuted, fontSize: 12.5, lineHeight: 1.5 }}>
            <strong style={{ color: T.text }}>Supervisor comments:</strong> {boq.supervisorComments}
          </div>
        )}
      </div>

      <textarea
        className="ac-input"
        style={taStyle}
        placeholder="Add comments (required when sending BOQ back)"
        value={comments}
        onChange={(e) => setComments(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <Button
          variant="success"
          size="md"
          loading={busy}
          icon={!busy && <Icon.check size={15} />}
          onClick={() => decide('approve')}
        >
          Approve BOQ
        </Button>
        <Button
          variant="danger"
          size="md"
          disabled={busy}
          icon={<Icon.x size={15} />}
          onClick={() => decide('reject')}
        >
          Send back
        </Button>
      </div>
      {actionError && (
        <div style={{ marginTop: 8, color: T.dangerText, fontSize: 12.5 }}>{actionError}</div>
      )}
    </>
  );
}

// Local (timezone-safe) yyyy-mm-dd for `today + n days`.
function plusDaysISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function BudgetBlock({ site, fetchDetail, fetchDocuments, onDecide }) {
  const [detail, setDetail] = React.useState(null);
  const [detailError, setDetailError] = React.useState(null);
  // Budget attachment(s) uploaded in PE — read-only, non-fatal if unavailable.
  const [docs, setDocs] = React.useState([]);
  const [comments, setComments] = React.useState('');
  // The admin sets the project initialization date as part of approving the
  // budget; defaults to 2 days out, overridable via the calendar.
  const [initDate, setInitDate] = React.useState(() => plusDaysISO(2));
  const [busy, setBusy] = React.useState(false);
  const [actionErr, setActionErr] = React.useState(null); // inline decide error, replaces blocking window.alert (#139)
  const acTheme = (typeof document !== 'undefined'
    && document.querySelector('.ac-root[data-theme]')?.getAttribute('data-theme')) || 'dark';
  const request = site.project || {};
  const fallback = React.useMemo(() => ({
    items: [],
    budgetStatus: request.budgetStatus,
    budgetTotal: request.budgetTotal,
    totalIndoorAreaSqft: request.totalIndoorAreaSqft,
    totalAreaSqft: request.totalAreaSqft,
    covers: request.covers,
    submittedByName: request.submittedByName || site.createdByName,
  }), [
    request.budgetStatus,
    request.budgetTotal,
    request.totalIndoorAreaSqft,
    request.totalAreaSqft,
    request.covers,
    request.submittedByName,
    site.createdByName,
  ]);
  const loadDetail = React.useCallback(() => {
    let live = true;
    setDetailError(null);
    if (!fetchDetail) {
      setDetail(fallback);
      return () => { live = false; };
    }
    fetchDetail(site.siteId)
      .then((d) => {
        if (!live) return;
        setDetail({ ...fallback, ...d });
      })
      .catch((err) => {
        if (!live) return;
        setDetail(fallback);
        setDetailError(err?.detail || err?.message || 'Could not load full project budget details.');
      });
    return () => { live = false; };
  }, [fallback, fetchDetail, site.siteId]);
  React.useEffect(() => loadDetail(), [loadDetail]);
  React.useEffect(() => {
    let live = true;
    if (!fetchDocuments) return undefined;
    fetchDocuments(site.siteId)
      .then((d) => { if (live) setDocs(Array.isArray(d) ? d : []); })
      .catch(() => { /* non-fatal — the row just doesn't render */ });
    return () => { live = false; };
  }, [fetchDocuments, site.siteId]);
  const decide = async (decision) => {
    setActionErr(null);
    if (decision === 'reject' && !comments.trim()) { setActionErr('Comments are required to send back.'); return; }
    if (decision === 'approve' && !initDate) { setActionErr('Set the project initialization date to approve.'); return; }
    setBusy(true);
    try { await onDecide(site.siteId, { decision, comments, initializationDate: initDate }); }
    catch (e) { setActionErr(e?.detail || e?.message || 'Decision failed'); }
    finally { setBusy(false); }
  };
  if (!detail) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton h={14} w="70%" /><Skeleton h={14} w="85%" /><Skeleton h={14} w="55%" />
    </div>
  );
  const items = detail.items || [];
  const total = detail.budgetTotal != null
    ? detail.budgetTotal
    : items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const civilMepSum = sumByIdx(items, CIVIL_MEP_IDX);
  const dim = (v, suffix = '') => (v != null ? `${v}${suffix}` : '—');
  return (
    <>
      {detailError && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: T.radiusSm,
          border: `1px solid ${T.dangerText}`,
          color: T.dangerText,
          background: T.dangerSoft,
          fontSize: 12.5,
        }}>
          <Icon.alert size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Full budget detail could not load: {detailError}</span>
          <Button size="sm" onClick={loadDetail}>Retry</Button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
        <RequestMeta label="Submitted by" value={detail.submittedByName} />
        <RequestMeta label="Budget status" value={detail.budgetStatus} />
      </div>

      {items.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          {items.map((it) => (
            <div key={it.idx} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5 }}>
              <span style={{ flex: 1, color: T.textMuted }}>{it.idx}. {it.label}</span>
              <span style={{ fontFamily: T.mono, color: T.text, ...TABULAR }}>{inr(it.amount)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5,
            borderTop: `1px solid ${T.line}`, marginTop: 4, paddingTop: 8 }}>
            <span style={{ flex: 1, color: T.text, fontWeight: 700 }}>Total investment</span>
            <span style={{ fontFamily: T.mono, color: T.successText, fontWeight: 700, ...TABULAR }}>{inr(total)}</span>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: T.radiusSm,
          border: `1px dashed ${T.lineStrong}`,
          color: T.textMuted,
          fontSize: 12.5,
        }}>
          Budget line items were not returned for this request.
        </div>
      )}

      {/* Area & covers — part of the budget submission, distinct from the heads. */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12, padding: '10px 12px',
        borderRadius: T.radiusSm, background: T.chip }}>
        <div><div style={{ color: T.textFaint, fontSize: 11 }}>Total Indoor Area</div>
          <div style={{ fontFamily: T.mono, color: T.text, fontSize: 12.5 }}>{dim(detail.totalIndoorAreaSqft, ' sqft')}</div></div>
        <div><div style={{ color: T.textFaint, fontSize: 11 }}>Total Area</div>
          <div style={{ fontFamily: T.mono, color: T.text, fontSize: 12.5 }}>{dim(detail.totalAreaSqft, ' sqft')}</div></div>
        <div><div style={{ color: T.textFaint, fontSize: 11 }}>Covers</div>
          <div style={{ fontFamily: T.mono, color: T.text, fontSize: 12.5 }}>{dim(detail.covers)}</div></div>
      </div>

      {/* Derived, read-only metrics. */}
      <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        {metricRow('Civil, Interior & MEP / sqft', formatRatio(civilMepSum, detail.totalIndoorAreaSqft))}
        {metricRow('CAPEX / sqft', formatRatio(total, detail.totalAreaSqft))}
        {metricRow('CAPEX / cover', formatRatio(total, detail.covers))}
      </div>

      {/* Budget attachment uploaded in PE — click-through to the signed URL. */}
      {docs.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: T.textFaint, fontSize: 11, marginBottom: 6 }}>Attachments</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {docs.map((d) => (
              <a
                key={d.id}
                href={d.url || undefined}
                target="_blank"
                rel="noreferrer"
                title={d.fileName}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: T.radiusSm,
                  border: `1px solid ${T.lineStrong}`, background: T.chip,
                  color: T.text, fontSize: 12.5, textDecoration: 'none',
                  maxWidth: 280,
                }}
              >
                <Icon.doc size={14} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.fileName}
                </span>
                {d.fileSizeKb ? (
                  <span style={{ color: T.textFaint, fontSize: 11, flexShrink: 0 }}>
                    {d.fileSizeKb < 1024 ? `${d.fileSizeKb} KB` : `${(d.fileSizeKb / 1024).toFixed(1)} MB`}
                  </span>
                ) : null}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Admin sets the project initialization date as part of approval. */}
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={{ display: 'block', color: T.textFaint, fontSize: 11, marginBottom: 4 }}>
          Project initialization date (sent to the executive on approval)
        </span>
        <input
          type="date"
          value={initDate}
          onChange={(e) => setInitDate(e.target.value)}
          style={{
            height: 36,
            width: '100%',
            boxSizing: 'border-box',
            padding: '0 10px',
            borderRadius: T.radiusSm,
            border: `1px solid ${T.lineStrong}`,
            background: T.chip,
            color: T.text,
            fontSize: 12.5,
            fontFamily: 'inherit',
            colorScheme: acTheme,
          }}
        />
      </label>
      <textarea className="ac-input" style={taStyle} placeholder="Add comments (required when sending back)"
        value={comments} onChange={(e) => setComments(e.target.value)} />
      {actionErr && <div role="alert" style={{ color: T.dangerText, fontSize: 12, margin: '6px 0' }}>{actionErr}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button variant="success" size="md" loading={busy} icon={!busy && <Icon.check size={15} />}
          onClick={() => decide('approve')}>Approve budget</Button>
        <Button variant="danger" size="md" disabled={busy} icon={<Icon.x size={15} />}
          onClick={() => decide('reject')}>Send back</Button>
      </div>
    </>
  );
}

// ── Quality-audit confirmation (tier-2 business-admin) ───────────────────────
// Read-only in the admin portal: the final quality-audit sign-off moved to the
// Project Excellence supervisor ("Completed" button). The admin only sees status.
function QualityAuditBlock({ site }) {
  const qa = site.qualityAudit || {};
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <RequestMeta label="Inspection date" value={qa.inspectionDate || '—'} />
      <RequestMeta label="Status" value="Supervisor approved — awaiting Project Excellence completion" />
    </div>
  );
}

// ── Financial closure finalize (tier-2 business-admin) ───────────────────────
function ClosureBlock({ site, onFinalize }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const fc = site.financialClosure || {};
  const decide = async (decision) => {
    setBusy(true); setErr(null);
    try { await onFinalize(site.siteId, { decision }); }
    catch (e) { setErr(e?.detail || e?.message || 'Action failed'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
        <RequestMeta label="GFC budget" value={inr(fc.gfcBudgetTotal)} />
        <RequestMeta label="Closure actual" value={inr(fc.closureBudgetTotal)} />
        <RequestMeta label="Variation" value={inr(fc.variationTotal)} />
      </div>
      {err && <div role="alert" style={{ color: T.dangerText, fontSize: 12, margin: '6px 0' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <Button variant="success" size="md" loading={busy} icon={!busy && <Icon.check size={15} />}
          onClick={() => decide('approve')}>Financial Closure</Button>
        <Button variant="danger" size="md" disabled={busy} icon={<Icon.x size={15} />}
          onClick={() => decide('reject')}>Send back</Button>
      </div>
    </>
  );
}

export default function SiteApprovalPanel({ site, handlers }) {
  const { design, payment, project } = site;
  const deliverables = design?.deliverables || [];
  const standardDeliverables = deliverables.filter((d) => d.kind !== 'boq');
  const boqDeliverables = deliverables.filter((d) => d.kind === 'boq');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {standardDeliverables.length > 0 && (
        <BlockShell icon={Icon.layers} tone="design" title="2D / 3D approvals">
          <DeliverablesBlock siteId={site.siteId} deliverables={standardDeliverables} onDecide={handlers.onDeliverableDecide} />
        </BlockShell>
      )}
      {boqDeliverables.map((boq) => (
        <BlockShell key={boq.id || boq.kind} icon={Icon.wrench} tone="design" title="BOQ approval" amount={boq.estimatedAmount}>
          <BoqApprovalBlock
            siteId={site.siteId}
            deliverable={boq}
            fetchReview={handlers.fetchGfcReview}
            onDecide={handlers.onDeliverableDecide}
          />
        </BlockShell>
      ))}
      {design?.gfcPending && (
        <BlockShell icon={Icon.shield} tone="design" title="GFC approval" amount={design.boqAmount}>
          <GfcBlock siteId={site.siteId} fetchReview={handlers.fetchGfcReview} onDecide={handlers.onGfcDecide} />
        </BlockShell>
      )}
      {payment && (
        <BlockShell icon={Icon.wallet} tone="payment" title="Payment approval" amount={payment.financeAmount}>
          <PaymentBlock site={site} onApprove={handlers.onApproveFinance} onReject={handlers.onRejectFinance} />
        </BlockShell>
      )}
      {project && (
        <BlockShell icon={Icon.wrench} tone="project" title="Project budget approval" amount={project.budgetTotal}>
          <BudgetBlock site={site} fetchDetail={handlers.fetchBudgetDetail} fetchDocuments={handlers.fetchBudgetDocuments} onDecide={handlers.onBudgetDecide} />
        </BlockShell>
      )}
      {site.qualityAudit && (
        <BlockShell icon={Icon.check} tone="project" title="Quality audit status">
          <QualityAuditBlock site={site} />
        </BlockShell>
      )}
      {site.financialClosure && (
        <BlockShell icon={Icon.wallet} tone="payment" title="Financial closure" amount={site.financialClosure.closureBudgetTotal}>
          <ClosureBlock site={site} onFinalize={handlers.onClosureFinalize} />
        </BlockShell>
      )}
    </div>
  );
}
