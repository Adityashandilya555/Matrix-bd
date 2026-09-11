// skipcq: JS-0833
// ClosureDetailsDrawer — one site's financial closure record, read-only, opened
// from the Launch Sites closure tab.
//
// Shows what the site drawer does not: GFC baseline against closure actual, the
// variation, the budget lines behind those totals, the derived metrics and the
// agreed rent. Documents, activity and payments stay in the site drawer, which
// the footer links to.
//
// Read-only by construction — every mutating closure endpoint still requires the
// project module, which this page's users generally do not hold.
import React from 'react';
import Icon from '../shared/primitives/Icon.jsx';
import { getFC } from '../../services/api/financialClosureApi.js';
import { formatINR, formatVariation, variationTone, computeRatio } from '../../lib/budgetMetrics.js';
import { CLOSURE_BUDGET_LABELS, CLOSURE_BUDGET_TONES } from '../financial_closure/closureStatus.js';

const RENT_TYPE_LABEL = {
  fixed: 'Fixed + escalation',
  revshare: 'Revenue share',
  mg_revshare: 'MG + Revenue share',
  staggered: 'Staggered',
};

const pct = (n) => (n == null ? '—' : `${Number(n)}%`);
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
// formatINR(null) returns ₹0, since Number(null) is 0 and finite. A missing
// figure must not render as zero rupees.
const money = (n) => (n == null ? '—' : formatINR(n));
const ratio = (a, b) => {
  const r = computeRatio(a, b);
  return r == null ? '—' : formatINR(r);
};

function Field({ label, children, tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 600, color: tone || 'var(--zm-fg)', wordBreak: 'break-word' }}>
        {children == null || children === '' ? '—' : children}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-3)', marginBottom: 10 }}>{children}</div>;
}

function rentSummary(d) {
  if (!d?.rentType) return 'No rent type set';
  if (d.rentType === 'revshare') return `Revenue share · ${pct(d.expectedRevsharePct)} of sales`;
  if (d.rentType === 'mg_revshare') return `MG ${money(d.expectedRent)}/mo + ${pct(d.expectedRevsharePct)} above MG`;
  if (d.rentType === 'staggered') {
    const sched = Array.isArray(d.staggeredEscalation) ? d.staggeredEscalation : [];
    const years = sched.filter((e) => e && e.percent != null)
      .map((e, i) => `Yr${e.year ?? i + 1} ${pct(e.percent)}`).join(' · ');
    return `Staggered · base ${money(d.expectedRent)}/mo${years ? ` · ${years}` : ''}`;
  }
  return `Fixed · ${money(d.expectedRent)}/mo · ${pct(d.expectedEscalationPct)} every ${d.expectedEscalationYears || '—'} yr`;
}

export default function ClosureDetailsDrawer({
  siteId, onClose, onOpenSiteRecord, fetchDetail = getFC,
}) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    if (!siteId) return undefined;
    let alive = true;
    setLoading(true);
    setErr(null);
    fetchDetail(siteId)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e?.detail || e?.message || 'Failed to load the closure record'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [siteId, fetchDetail]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = data;
  const indoor = d?.totalIndoorAreaSqft;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.50)', backdropFilter: 'blur(6px)', zIndex: 120, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end' }}>
      <div role="dialog" aria-modal="true" aria-label="Financial closure details"
        style={{ background: 'var(--zm-bg)', borderLeft: '1px solid var(--zm-line)', width: 760, maxWidth: '96%', display: 'flex', flexDirection: 'column', boxShadow: 'var(--zm-shadow-pop)' }}>

        <header style={{ padding: '18px 26px', background: 'var(--zm-surface)', borderBottom: '1px solid var(--zm-line)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>
              Financial closure
            </span>
            <h2 style={{ margin: '4px 0 0', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 21, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>
              {loading ? 'Loading…' : `${d?.siteCode || ''} · ${d?.siteName || ''}`}
            </h2>
            {!loading && d && (
              <p style={{ margin: '3px 0 0', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>
                {d.city}
                {d.allocatedToName ? ` · Prepared by ${d.allocatedToName}` : ''}
              </p>
            )}
          </div>
          {!loading && d && (
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: CLOSURE_BUDGET_TONES[d.closureStatus] || 'var(--zm-accent)' }}>
              {CLOSURE_BUDGET_LABELS[d.closureStatus] || d.closureStatus}
            </span>
          )}
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer', flex: '0 0 30px' }}>
            <Icon name="x" size={14} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>Loading…</div>}

          {err && !loading && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--zm-danger-soft)', border: '1px solid var(--zm-danger)', color: 'var(--zm-danger)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>{err}</div>
          )}

          {d && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              <div>
                <SectionLabel>Budget</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, padding: '14px 16px', borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)' }}>
                  <Field label="GFC baseline">{money(d.gfcBudgetTotal)}</Field>
                  <Field label="Closure actual">{money(d.closureBudgetTotal)}</Field>
                  <Field label="Variation" tone={variationTone(d.variationTotal)}>
                    {d.variationTotal == null ? '—' : formatVariation(d.variationTotal)}
                  </Field>
                </div>
              </div>

              <div>
                <SectionLabel>Area &amp; metrics</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, padding: '14px 16px', borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)' }}>
                  <Field label="Indoor area">{indoor ? `${num(indoor)} sqft` : '—'}</Field>
                  <Field label="Total area">{d.totalAreaSqft ? `${num(d.totalAreaSqft)} sqft` : '—'}</Field>
                  <Field label="Covers">{num(d.covers)}</Field>
                  <Field label="Cost / indoor sqft">{ratio(d.closureBudgetTotal, indoor)}</Field>
                  <Field label="Cost / total sqft">{ratio(d.closureBudgetTotal, d.totalAreaSqft)}</Field>
                  <Field label="Cost / cover">{ratio(d.closureBudgetTotal, d.covers)}</Field>
                </div>
              </div>

              <div>
                <SectionLabel>Agreed rent</SectionLabel>
                <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)' }}>
                  <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
                    {RENT_TYPE_LABEL[d.rentType] || d.rentType || 'Rent'}
                  </div>
                  <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, fontWeight: 600, color: 'var(--zm-fg)', marginTop: 3 }}>{rentSummary(d)}</div>
                </div>
              </div>

              <div>
                <SectionLabel>Budget lines</SectionLabel>
                <div style={{ borderRadius: 10, border: '1px solid var(--zm-line)', overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, padding: '9px 14px', background: 'var(--zm-surface-2)', borderBottom: '1px solid var(--zm-line)', fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>
                    <span>Line</span><span>GFC</span><span>Closure</span><span>Variation</span>
                  </div>
                  {(d.lines || []).map((line) => (
                    <div key={line.idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--zm-line-faint)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg)' }}>
                      <span>{line.label || `Line ${line.idx}`}</span>
                      <span>{money(line.gfcAmount)}</span>
                      <span>{money(line.closureAmount)}</span>
                      <span style={{ color: variationTone(line.variation), fontWeight: 600 }}>
                        {line.variation == null ? '—' : formatVariation(line.variation)}
                      </span>
                    </div>
                  ))}
                  {(!d.lines || d.lines.length === 0) && (
                    <div style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
                      No budget lines were recorded.
                    </div>
                  )}
                </div>
              </div>

              {(d.supervisorComments || d.adminComments) && (
                <div>
                  <SectionLabel>Comments</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {d.supervisorComments && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)' }}>
                        <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Supervisor</span>
                        <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', marginTop: 3 }}>“{d.supervisorComments}”</div>
                      </div>
                    )}
                    {d.adminComments && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)' }}>
                        <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--zm-fg-3)' }}>Business admin</span>
                        <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)', marginTop: 3 }}>“{d.adminComments}”</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {onOpenSiteRecord && (
          <footer style={{ padding: '14px 26px', borderTop: '1px solid var(--zm-line)', background: 'var(--zm-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1, fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-fg-3)' }}>
              Documents, activity and payments live in the site record.
            </span>
            <button onClick={() => onOpenSiteRecord(siteId)}
              style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Documents &amp; site record <Icon name="arrow" size={13} />
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
