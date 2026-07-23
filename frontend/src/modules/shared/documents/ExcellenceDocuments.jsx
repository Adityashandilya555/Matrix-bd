// skipcq: JS-0833 — DeepSource parses this newly-added file as sourceType:script
// and false-flags the ESM import (vitest/eslint/build all accept it); the repo
// uses this same band-aid on other ESM files.
import React from 'react';
import Icon from '../primitives/Icon.jsx';
import { usePageContext } from '../../../App.jsx';
import {
  deleteExcellenceDocument,
  listExcellenceDocuments,
  uploadExcellenceDocument,
} from '../../../services/api/projectExcellenceApi.js';

// Budget attachment slot, per phase: kind='excellence' (Project Excellence) or
// kind='closure' (Financial Closure). Each phase holds AT MOST ONE file
// (PNG/JPEG/PDF, ≤5 MB).
//
// Selecting a file only STAGES it locally (a card with a corner × to discard a
// mis-pick). The staged file is persisted when you click "Upload" OR — via the
// imperative `commitStaged()` handle — when the parent Save/Submits the budget,
// so a staged attachment is never silently lost. Choosing a new file while one
// exists REPLACES it: the old row is deleted first (it must not linger in the
// DB), then the new one is uploaded.

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

// Corner ×: shared by the staged card and the uploaded card.
function CornerRemove({ label, disabled, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        position: 'absolute', top: -7, right: -7, width: 20, height: 20,
        borderRadius: '50%', border: '1px solid var(--zm-line)',
        background: 'var(--zm-surface)', color: 'var(--zm-danger)',
        fontSize: 12, fontWeight: 800, lineHeight: 1, cursor: disabled ? 'wait' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'var(--zm-shadow-1)', padding: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      ×
    </button>
  );
}

function DocCard({ children }) {
  return (
    <div style={{ position: 'relative', width: 104 }}>
      {children}
    </div>
  );
}

const ExcellenceDocuments = React.forwardRef(function ExcellenceDocuments({
  siteId,
  kind = 'excellence',
  canEdit = false,
  title = 'Attachments',
  showHeader = true,
  emptyText = 'No attachments yet.',
}, ref) {
  const { showToast } = usePageContext() || {};
  const [docs, setDocs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [staged, setStaged] = React.useState(null);       // File | null
  const [stagedPreview, setStagedPreview] = React.useState(null); // object URL
  const [uploading, setUploading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState(null);
  const uploadingRef = React.useRef(false);
  const fileRef = React.useRef(null);

  const load = React.useCallback(async () => {
    if (!siteId) return;
    try {
      const d = await listExcellenceDocuments(siteId, kind);
      setDocs(d.documents || []);
    } catch {
      /* non-fatal — the section just shows empty */
    } finally {
      setLoading(false);
    }
  }, [siteId, kind]);

  React.useEffect(() => { load(); }, [load]);

  // Revoke the staged object URL whenever it's replaced or on unmount.
  React.useEffect(() => () => {
    if (stagedPreview) URL.revokeObjectURL(stagedPreview);
  }, [stagedPreview]);

  const clearStaged = () => {
    setStaged(null);
    setStagedPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  // Selecting a file only stages it — no network until commit (Upload button or
  // the parent's Save/Submit). Choosing a file while one exists stages a
  // REPLACEMENT; the existing doc is deleted at commit time.
  const handleSelect = (e) => {
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
    setStagedPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return isImage(file.type) ? URL.createObjectURL(file) : null;
    });
    setStaged(file);
  };

  // Persist the staged file. Replace semantics: delete any current doc FIRST
  // (max-1 per phase; the backend 409s a second upload, and a replaced file must
  // not linger in the DB), then upload. THROWS on failure so callers can react.
  const doUpload = async () => {
    for (const d of docs) {
      await deleteExcellenceDocument(siteId, d.id);
    }
    const created = await uploadExcellenceDocument(siteId, staged, kind);
    if (created?.id) {
      setDocs([{
        id: created.id, file_name: created.file_name,
        file_size_kb: created.file_size_kb, mime_type: created.mime_type, url: created.url,
      }]);
    }
    clearStaged();
    await load();
    return created;
  };

  const handleUpload = async () => {
    if (!staged || uploadingRef.current) return; // guard the same-tick double-fire
    const name = staged.name;
    uploadingRef.current = true;
    setUploading(true);
    try {
      await doUpload();
      showToast?.(`Uploaded · ${name}`, 'success');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Upload failed', 'danger');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const handleDelete = async (doc) => {
    if (deletingId) return;
    setDeletingId(doc.id);
    try {
      await deleteExcellenceDocument(siteId, doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      showToast?.(`Removed · ${doc.file_name}`, 'success');
      await load();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Could not remove the attachment', 'danger');
    } finally {
      setDeletingId(null);
    }
  };

  // Imperative handle so the parent form can flush a staged attachment as part
  // of Save/Submit (never lose it). commitStaged RETHROWS so the parent can
  // abort the save when the upload fails. Read state through refs so the handle
  // stays stable while always seeing the latest staged file / docs.
  const stagedRef = React.useRef(null);
  stagedRef.current = staged;
  const commitStaged = async () => {
    if (!staged || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      await doUpload();
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };
  const commitRef = React.useRef(commitStaged);
  commitRef.current = commitStaged;
  React.useImperativeHandle(ref, () => ({
    hasStaged: () => Boolean(stagedRef.current),
    commitStaged: () => commitRef.current(),
  }), []);

  const labelStyle = {
    fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--zm-fg-3)',
  };

  // The picker is available whenever editing and nothing is staged — including
  // when a doc already exists (choosing another replaces it).
  const showPicker = canEdit && !staged;
  const hasDoc = docs.length > 0;

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
      ) : docs.length === 0 && !staged ? (
        <div style={{ fontSize: 12, color: 'var(--zm-fg-3)', marginBottom: canEdit ? 12 : 0 }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: canEdit ? 12 : 0 }}>
          {docs.map((d) => (
            <DocCard key={d.id}>
              <a
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
              {canEdit && (
                <CornerRemove
                  label="Delete attachment"
                  disabled={deletingId === d.id}
                  onClick={() => handleDelete(d)}
                />
              )}
            </DocCard>
          ))}

          {/* Staged (not yet uploaded) pick — × discards it locally. */}
          {staged && (
            <DocCard>
              <div style={{
                display: 'flex', flexDirection: 'column', width: 104,
                border: '1px dashed var(--zm-accent)', borderRadius: 8, overflow: 'hidden',
                background: 'var(--zm-surface)',
              }}>
                <div style={{ height: 72, background: 'var(--zm-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {stagedPreview
                    ? <img src={stagedPreview} alt={staged.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Icon name="file" size={22} />}
                </div>
                <div style={{ padding: '5px 7px', minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--zm-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{staged.name}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--zm-copper, var(--zm-fg-3))' }}>
                    {fmtSize(Math.max(1, Math.round(staged.size / 1024)))} · {hasDoc ? 'will replace on save' : 'uploads on save'}
                  </div>
                </div>
              </div>
              <CornerRemove
                label="Remove selected file"
                disabled={uploading}
                onClick={clearStaged}
              />
            </DocCard>
          )}
        </div>
      )}

      {canEdit && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={handleSelect}
          />
          {staged ? (
            <button
              type="button"
              onClick={handleUpload}
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
              {uploading ? 'Uploading…' : <><Icon name="upload" size={12} /> {hasDoc ? 'Upload replacement' : 'Upload'}</>}
            </button>
          ) : showPicker ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="zm-btn-primary"
              style={{
                height: 32, padding: '0 12px', borderRadius: 7,
                border: hasDoc ? '1px solid var(--zm-line)' : 'none',
                background: hasDoc ? 'var(--zm-surface)' : 'var(--zm-accent)',
                color: hasDoc ? 'var(--zm-fg)' : '#fff',
                fontFamily: 'var(--zm-font-body)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                boxShadow: 'var(--zm-shadow-1)',
              }}
            >
              <Icon name="upload" size={12} /> {hasDoc ? 'Replace file' : 'Choose file'}
            </button>
          ) : null}
          <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', marginTop: 6 }}>
            PNG, JPEG or PDF, up to 5 MB. One file — saved when you upload or Save/Submit.
          </div>
        </>
      )}
    </div>
  );
});

export default ExcellenceDocuments;
