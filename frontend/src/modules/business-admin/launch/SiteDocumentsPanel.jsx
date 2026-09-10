// skipcq: JS-0833
// SiteDocumentsPanel — every document uploaded for a site, for the admin's final
// review before committing the terms.
//
// The admin is signing off on numbers negotiated across the whole pipeline, and
// the evidence for them — the LOI, site photos, design deliverables, audit
// reports — was already uploaded by other modules. Nothing new is stored here;
// GET /business-admin/sites/{id}/documents aggregates site_files and
// design_deliverables and hands back signed URLs, and this is the surface that
// finally shows them at the point of decision. It is read-only by design: the
// launch loop reviews, it does not collect.
//
// Signed URLs expire (300s), so the list is re-fetched on every open rather than
// cached across drawer sessions, and ImageLightbox re-signs through onRefreshUrl
// for a panel left sitting open.
//
// COMMENT STYLE: line comments only, no JSDoc blocks — see launchRentAdapter.js.
import React from 'react';
import { T, Icon, Card, EmptyState, ErrorState, Skeleton, TABULAR } from '../ui/kit.jsx';
import ImageLightbox from '../../shared/media/ImageLightbox.jsx';
import { getAdminSiteDocuments } from '../../../services/api/businessAdminApi.js';
import { keyActivate } from '../../../lib/a11y.js';

// The documents payload carries no mime type, so images are recognised by
// extension, with file_type='photo' as the fallback for an extensionless name.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const isImageDoc = (doc) => IMAGE_EXT.test(doc.fileName || '') || doc.fileType === 'photo';

const TYPE_LABEL = {
  loi: 'LOI',
  photo: 'Site photo',
  quality_audit: 'Quality audit',
  excellence: 'Excellence',
  closure: 'Closure',
  design: 'Design',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function DocRow({ doc, onOpen }) {
  const image = isImageDoc(doc);
  // A document whose signing failed has no URL; say so rather than offering a
  // dead click.
  const openable = Boolean(doc.url);
  const activate = openable ? () => onOpen(doc) : undefined;
  return (
    <div
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={activate}
      onKeyDown={openable ? keyActivate(activate) : undefined}
      style={{
        display: 'grid', gridTemplateColumns: '28px 1fr auto auto', alignItems: 'center', gap: 12,
        padding: '10px 14px', borderBottom: `1px solid ${T.line}`,
        cursor: openable ? 'pointer' : 'default', opacity: openable ? 1 : 0.55,
      }}
      onMouseEnter={(e) => { if (openable) e.currentTarget.style.background = T.chip; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ color: T.textMuted, display: 'inline-flex' }}>
        <Icon.doc size={16} />
      </span>
      <span style={{ fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.fileName || 'Untitled'}</span>
        {/* Images preview in place; everything else opens a new tab, so say which. */}
        {openable && !image && <Icon.external size={12} />}
        {!openable && <span style={{ color: T.textFaint, fontSize: 11.5 }}>· unavailable</span>}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.textMuted, background: T.chip, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
        {TYPE_LABEL[doc.fileType] || doc.fileType || 'File'}
      </span>
      <span style={{ fontSize: 11.5, color: T.textFaint, whiteSpace: 'nowrap', ...TABULAR }}>
        {fmtDate(doc.uploadedAt)}
      </span>
    </div>
  );
}

export default function SiteDocumentsPanel({ siteId }) {
  const [state, setState] = React.useState({ status: 'loading', documents: [], error: null });
  const [preview, setPreview] = React.useState(null);

  const load = React.useCallback(async () => {
    if (!siteId) return;
    setState({ status: 'loading', documents: [], error: null });
    try {
      const d = await getAdminSiteDocuments(siteId);
      setState({ status: 'ready', documents: d.documents || [], error: null });
    } catch (e) {
      setState({ status: 'error', documents: [], error: e?.detail || e?.message || 'Failed to load documents' });
    }
  }, [siteId]);

  React.useEffect(() => { load(); }, [load]);

  // ImageLightbox re-signs on open. Re-fetching the list is the only way to get a
  // fresh URL, since signing is server-side and keyed by storage path.
  const refreshUrl = React.useCallback(async (photo) => {
    const d = await getAdminSiteDocuments(siteId);
    return (d.documents || []).find((x) => x.id === photo?.id)?.url || null;
  }, [siteId]);

  const openDoc = (doc) => {
    if (isImageDoc(doc)) { setPreview(doc); return; }
    // Non-images (PDFs and the rest) go to the browser's own viewer. noopener so
    // the opened tab cannot reach back into this one through window.opener.
    window.open(doc.url, '_blank', 'noopener,noreferrer');
  };

  if (state.status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} h={40} />)}
      </div>
    );
  }

  if (state.status === 'error') {
    return <div style={{ padding: 20 }}><ErrorState message={state.error} onRetry={load} /></div>;
  }

  if (!state.documents.length) {
    return (
      <div style={{ padding: '36px 24px' }}>
        <EmptyState icon={Icon.doc} title="No documents"
          hint="Nothing has been uploaded for this site yet. Documents added by BD, Design or Project will appear here." />
      </div>
    );
  }

  // Grouped by the module that produced them, so the admin can find the one they
  // want without reading every filename.
  const groups = state.documents.reduce((acc, doc) => {
    const key = doc.module || 'Other';
    (acc[key] = acc[key] || []).push(doc);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {Object.entries(groups).map(([module, docs]) => (
        <div key={module}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.textMuted, marginBottom: 10 }}>
            {module} · {docs.length}
          </div>
          <Card style={{ overflow: 'hidden' }}>
            {docs.map((doc) => <DocRow key={doc.id} doc={doc} onOpen={openDoc} />)}
          </Card>
        </div>
      ))}

      <ImageLightbox
        open={Boolean(preview)}
        photo={preview}
        onClose={() => setPreview(null)}
        onRefreshUrl={refreshUrl}
      />
    </div>
  );
}
