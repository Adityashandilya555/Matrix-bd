// skipcq: JS-0833 — DeepSource parses this newly-added file as sourceType:script
// and false-flags the ESM import (vitest/eslint/build all accept it); the repo
// uses this same band-aid on other ESM files.
import React from 'react';
import Icon from '../primitives/Icon.jsx';
import { usePageContext } from '../../../App.jsx';
import { listExcellenceDocuments, uploadExcellenceDocument } from '../../../services/api/projectExcellenceApi.js';

// Shared site-level image attachments for Project Excellence, also surfaced (and
// extendable) in Financial Closure. Uploads are PNG/JPEG, ≤5 MB, and reuse the
// exact Upload-LOI busy state: the button disables + reads "Uploading…" until
// the request settles, and more files can always be added.

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const ACCEPT = '.png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf';

function fmtSize(kb) {
  if (!kb || kb <= 0) return '';
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

export default function ExcellenceDocuments({ siteId, canUpload = true, title = 'Attachments', showHeader = true }) {
  const { showToast } = usePageContext() || {};
  const [docs, setDocs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const uploadingRef = React.useRef(false);
  const fileRef = React.useRef(null);

  const load = React.useCallback(async () => {
    if (!siteId) return;
    try {
      const d = await listExcellenceDocuments(siteId);
      setDocs(d.documents || []);
    } catch {
      /* non-fatal — the section just shows empty */
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  React.useEffect(() => { load(); }, [load]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast?.('Only PNG, JPEG or PDF files are allowed.', 'danger');
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast?.('File too large — maximum size is 5 MB.', 'danger');
      return;
    }
    if (uploadingRef.current) return; // guard the same-tick double-fire
    uploadingRef.current = true;
    setUploading(true);
    try {
      await uploadExcellenceDocument(siteId, file);
      showToast?.(`Uploaded · ${file.name}`, 'success');
      await load();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Upload failed', 'danger');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const labelStyle = {
    fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--zm-fg-3)',
  };

  return (
    <div style={showHeader ? { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--zm-line)' } : undefined}>
      {showHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <Icon name="file" size={13} />
          <span style={labelStyle}>{title}{!loading ? ` · ${docs.length}` : ''}</span>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--zm-fg-3)' }}>Loading attachments…</div>
      ) : docs.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--zm-fg-3)', marginBottom: canUpload ? 12 : 0 }}>
          No attachments yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: canUpload ? 12 : 0 }}>
          {docs.map((d) => (
            <a
              key={d.id}
              href={d.url || undefined}
              target="_blank"
              rel="noreferrer"
              title={d.file_name}
              style={{
                display: 'flex', flexDirection: 'column', width: 104, textDecoration: 'none',
                border: '1px solid var(--zm-line)', borderRadius: 8, overflow: 'hidden',
                background: 'var(--zm-surface)',
              }}
            >
              <div style={{ height: 72, background: 'var(--zm-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {isImage(d.mime_type) && d.url
                  ? <img src={d.url} alt={d.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Icon name="file" size={22} />}
              </div>
              <div style={{ padding: '5px 7px', minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.file_name}</div>
                <div style={{ fontSize: 9.5, color: 'var(--zm-fg-3)' }}>{fmtSize(d.file_size_kb)}</div>
              </div>
            </a>
          ))}
        </div>
      )}

      {canUpload && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={handleFile}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-busy={uploading}
            className="zm-btn-primary"
            style={{
              height: 32, padding: '0 12px', border: 'none', borderRadius: 7,
              background: 'var(--zm-accent)', color: '#fff', fontFamily: 'var(--zm-font-body)',
              fontSize: 12, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer',
              opacity: uploading ? 0.65 : 1, display: 'inline-flex', alignItems: 'center', gap: 6,
              boxShadow: 'var(--zm-shadow-1)',
            }}
          >
            {uploading ? 'Uploading…' : <><Icon name="upload" size={12} /> {docs.length ? 'Upload more' : 'Upload file'}</>}
          </button>
          <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', marginTop: 6 }}>PNG, JPEG or PDF, up to 5 MB.</div>
        </>
      )}
    </div>
  );
}
