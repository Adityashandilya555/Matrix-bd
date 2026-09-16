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
import ThemedPortal from '../shared/primitives/ThemedPortal.jsx';
import { getFC, getClosureQAReports } from '../../services/api/financialClosureApi.js';
import { getSiteDocuments } from '../../services/api/siteService.js';
import ImageLightbox from '../shared/media/ImageLightbox.jsx';
import { ScheduleTable } from '../shared/rent/RentScheduleDialog.jsx';
import { ZM_TOKENS } from '../shared/rent/RentTermsForm.jsx';
import { formatINR, formatVariation, variationTone, computeRatio } from '../../lib/budgetMetrics.js';
import { CLOSURE_BUDGET_LABELS, CLOSURE_BUDGET_TONES } from '../financial_closure/closureStatus.js';
import { useDialogFocus } from '../../lib/a11y.js';
import { lockBodyScroll } from '../../lib/scrollLock.js';

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

// Rows of a staggered schedule, or [] for every other rent type. A staggered
// rent is rendered as the shared Year / Escalation / Dine-in / Delivery table
// (the same one the schedule dialog uses) rather than crammed onto one line.
const scheduleRows = (d) => (
  d?.rentType === 'staggered' && Array.isArray(d.staggeredEscalation)
    ? d.staggeredEscalation.filter((e) => e && e.percent != null)
    : []
);

function rentSummary(d) {
  if (!d?.rentType) return 'No rent type set';
  if (d.rentType === 'revshare') return `Revenue share · ${pct(d.expectedRevsharePct)} of sales`;
  if (d.rentType === 'mg_revshare') return `MG ${money(d.expectedRent)}/mo + ${pct(d.expectedRevsharePct)} above MG`;
  if (d.rentType === 'staggered') {
    // The per-year steps are in the table below, so this line carries only the
    // base rent the schedule steps up from.
    return `Base rent ${money(d.expectedRent)}/mo · steps up each year of the term`;
  }
  return `Fixed · ${money(d.expectedRent)}/mo · ${pct(d.expectedEscalationPct)} every ${d.expectedEscalationYears || '—'} yr`;
}

// The payload carries no mime type, so images are recognised by extension with
// file_type as the fallback for an extensionless name.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const isImageDoc = (d) => IMAGE_EXT.test(d.fileName || '') || d.fileType === 'photo';

// Fallback grouping for the shared documents endpoint, which sends no `module`.
// Kept in step with the admin endpoint's own map (business_admin_documents_service)
// so a file lands in the same section whichever surface opened the drawer.
const MODULE_FOR_TYPE = {
  loi: 'BD', photo: 'BD', excellence: 'Project Excellence', closure: 'Financial Closure',
  quality_audit: 'Quality audit',
};
const docModule = (d) => d.module
  || MODULE_FOR_TYPE[d.fileType]
  || (String(d.fileType || '').startsWith('design_') ? 'Design' : 'Other');

// Quality-audit reports are not documents in the site_files sense — they live in
// their own table and arrive from a different endpoint. Flattened to the same
// row shape so one list can render both, as SiteApprovalPanel's ClosureBlock does.
//
// Filtered on the report EXISTING, not on its URL. download_url is null in two
// different situations — the report was never uploaded, and the report exists
// but signing failed — and only the first is an absence. Dropping both would
// make an uploaded report silently vanish instead of showing as unavailable,
// which is the row state that exists for exactly this.
const qaAsDocs = (qa) => [qa?.before, qa?.after]
  .filter(Boolean)
  .map((r) => ({
    id: `qa-${r.kind}`,
    module: 'Quality audit',
    fileName: `${r.kind === 'before' ? 'Before' : 'After'} — ${r.fileName || 'report.pdf'}`,
    uploadedAt: r.uploadedAt,
    url: r.downloadUrl,
  }));

export default function ClosureDetailsDrawer({
  siteId, onClose, fetchDetail = getFC,
  // Injected per surface, like fetchDetail. The business admin's documents
  // endpoint also returns design deliverables; the shared one does not.
  fetchDocuments = getSiteDocuments,
  fetchQAReports = getClosureQAReports,
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

  // aria-modal is a promise that focus is contained. The hook moves focus in,
  // keeps Tab inside the panel, restores it on close, and owns Escape while this
  // is the topmost overlay — it yields both to the image preview opened over it.
  const panelRef = React.useRef(null);
  const dismiss = React.useCallback(() => onClose?.(), [onClose]);
  useDialogFocus(true, panelRef, dismiss);

  // Lock the page behind. Counted, so closing this drawer while another overlay
  // is still open does not hand scrolling back to the page underneath it.
  React.useEffect(() => lockBodyScroll(), []);

  const [tab, setTab] = React.useState('closure');
  const [docs, setDocs] = React.useState({ status: 'idle', items: [] });
  const [preview, setPreview] = React.useState(null);

  // Each source is caught on its own, because the two surfaces have different
  // reach: a supervisor cannot call the admin documents endpoint, and an
  // executive not delegated onto the site gets 404 for the reports. One failing
  // has to hide its own group rather than empty the tab.
  //
  // But swallowing BOTH failures would render "No documents have been uploaded"
  // over an auth error or an outage — telling the reader a site has no paperwork
  // when the truth is we could not ask. If neither source answered, that is an
  // error, and it says so with a retry.
  const loadDocs = React.useCallback(() => {
    if (!siteId) return undefined;
    let alive = true;
    setDocs({ status: 'loading', items: [] });
    const failed = { docs: false, qa: false };
    Promise.all([
      Promise.resolve(fetchDocuments(siteId))
        .then((r) => r?.documents || [])
        .catch(() => { failed.docs = true; return []; }),
      Promise.resolve(fetchQAReports(siteId))
        .then(qaAsDocs)
        .catch(() => { failed.qa = true; return []; }),
    ]).then(([files, qa]) => {
      if (!alive) return;
      if (failed.docs && failed.qa) {
        setDocs({ status: 'error', items: [] });
        return;
      }
      // A quality-audit report can reach the tab from both sources at once —
      // its own endpoint and, on surfaces whose documents endpoint includes
      // them, as a site_files row. Keyed on the storage object rather than the
      // row id, since the two sources give the same file different ids; two
      // genuinely separate uploads have separate objects and both survive.
      const seen = new Set();
      const items = [...qa, ...files].filter((doc) => {
        const key = String(doc.url || '').split('?')[0] || `id:${doc.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setDocs({ status: 'ready', items });
    });
    return () => { alive = false; };
  }, [siteId, fetchDocuments, fetchQAReports]);

  // Load once per site, the first time Documents is opened. Keyed on a latch
  // rather than `tab`: listing signs one storage object per file, so re-running
  // on every tab switch re-signed the whole set (#499) — and tearing the effect
  // down mid-request cancelled the load, leaving the tab stuck on "Loading".
  const [docsOpened, setDocsOpened] = React.useState(false);
  React.useEffect(() => { if (tab === 'documents') setDocsOpened(true); }, [tab]);
  React.useEffect(() => (docsOpened ? loadDocs() : undefined), [docsOpened, loadDocs]);

  // Re-signing is server-side and keyed by storage path, so the whole list has
  // to be re-fetched. Called only from the lightbox's error path.
  const refreshUrl = React.useCallback(async (photo) => {
    const r = await fetchDocuments(siteId);
    return (r?.documents || []).find((x) => x.id === photo?.id)?.url || null;
  }, [siteId, fetchDocuments]);

  const openDoc = (doc) => {
    if (isImageDoc(doc)) { setPreview(doc); return; }
    window.open(doc.url, '_blank', 'noopener,noreferrer');
  };

  const groups = docs.items.reduce((acc, doc) => {
    const key = docModule(doc);
    (acc[key] = acc[key] || []).push(doc);
    return acc;
  }, {});

  const d = data;
  const indoor = d?.totalIndoorAreaSqft;

  return (
    <ThemedPortal>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.50)', backdropFilter: 'blur(6px)', zIndex: 120, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end' }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Financial closure details" tabIndex={-1}
        style={{ background: 'var(--zm-bg)', borderLeft: '1px solid var(--zm-line)', width: 760, maxWidth: '96%', height: '100%', display: 'flex', flexDirection: 'column', boxShadow: 'var(--zm-shadow-pop)', outline: 'none' }}>

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

        <div style={{ flexShrink: 0, display: 'flex', gap: 6, padding: '12px 26px 0', background: 'var(--zm-surface)', borderBottom: '1px solid var(--zm-line)' }}>
          {[
            { key: 'closure', label: 'Closure' },
            { key: 'documents', label: 'Documents' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} aria-pressed={tab === key}
              style={{ padding: '8px 14px', border: 'none', borderBottom: `2px solid ${tab === key ? 'var(--zm-accent)' : 'transparent'}`, background: 'transparent', color: tab === key ? 'var(--zm-fg)' : 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {label}
              {key === 'documents' && docs.status === 'ready' && docs.items.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--zm-fg-3)' }}>{docs.items.length}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'documents' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
            {docs.status === 'loading' && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>Loading documents…</div>
            )}
            {docs.status === 'error' && (
              <div style={{ padding: 40, textAlign: 'center', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
                <div style={{ color: 'var(--zm-danger)' }}>Could not load documents.</div>
                <button onClick={loadDocs}
                  style={{ marginTop: 12, height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                  Retry
                </button>
              </div>
            )}
            {docs.status === 'ready' && docs.items.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--zm-fg-3)', fontFamily: 'var(--zm-font-body)', fontSize: 13 }}>
                No documents have been uploaded for this site yet.
              </div>
            )}
            {docs.status === 'ready' && Object.entries(groups).map(([module, items]) => (
              <div key={module} style={{ marginBottom: 18 }}>
                <SectionLabel>{module} · {items.length}</SectionLabel>
                <div style={{ background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 10, overflow: 'hidden' }}>
                  {items.map((doc, i) => {
                    const openable = Boolean(doc.url);
                    const Row = openable ? 'button' : 'div';
                    return (
                      <Row key={doc.id || i}
                        {...(openable ? { type: 'button', onClick: () => openDoc(doc) } : {})}
                        aria-label={openable ? `Open ${doc.fileName}` : undefined}
                        style={{
                          display: 'grid', gridTemplateColumns: '28px 1fr 110px', alignItems: 'center', gap: 14,
                          width: '100%', textAlign: 'left', padding: '12px 16px',
                          background: 'transparent', font: 'inherit', color: 'inherit',
                          border: 'none', borderBottom: i < items.length - 1 ? '1px solid var(--zm-line-faint)' : 'none',
                          cursor: openable ? 'pointer' : 'default', opacity: openable ? 1 : 0.55,
                        }}>
                        <span style={{ color: 'var(--zm-fg-3)', display: 'inline-flex' }}><Icon name="file" size={16} /></span>
                        <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 500, color: 'var(--zm-fg)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {doc.fileName || 'Untitled document'}
                          {!openable && <span style={{ color: 'var(--zm-fg-3)', fontSize: 11.5 }}> · unavailable</span>}
                        </span>
                        <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>
                          {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('en-IN') : '—'}
                        </span>
                      </Row>
                    );
                  })}
                </div>
              </div>
            ))}
            <ImageLightbox open={Boolean(preview)} photo={preview}
              onClose={() => setPreview(null)} onRefreshUrl={refreshUrl} />
          </div>
        )}

        {tab === 'closure' && (
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
                  {scheduleRows(d).length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <ScheduleTable rows={scheduleRows(d)} tokens={ZM_TOKENS} />
                    </div>
                  )}
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
        )}
      </div>
    </div>
    </ThemedPortal>
  );
}
