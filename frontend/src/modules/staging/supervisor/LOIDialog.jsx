// skipcq: JS-0833
// Preview an uploaded LOI, and send it back if it's the wrong file.
//
// The document is opened via a real <a href>, NOT window.open. The URL only
// exists after an awaited fetch, and a window.open that happens after an await
// has lost the user-gesture the popup blocker requires — it would silently do
// nothing, which is exactly the bug this dialog was written to fix. An anchor
// is a genuine gesture, works for PDFs and images alike, and matches how the
// rest of the app links to signed URLs.
import React from 'react';
import Icon from '../../shared/primitives/Icon.jsx';
import { safeHref } from '../../../lib/safeHref.js';
import { viewLoi } from '../../../services/api/siteService.js';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(11,12,16,0.46)',
  backdropFilter: 'blur(6px)', zIndex: 110,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const card = {
  background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', borderRadius: 14,
  width: 540, maxWidth: 'calc(100vw - 32px)', padding: 26,
  boxShadow: 'var(--zm-shadow-pop)', display: 'flex', flexDirection: 'column', gap: 18,
};
const btn = (bg, fg = '#fff') => ({
  height: 34, padding: '0 14px', border: 'none', borderRadius: 8, background: bg, color: fg,
  fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  textDecoration: 'none',
});

export default function LOIDialog({ site, onClose, onSendBack, canSendBack = false }) {
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const [comments, setComments] = React.useState('');
  const [commentError, setCommentError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const sendingRef = React.useRef(false);
  const textareaId = React.useId();

  const load = React.useCallback(async () => {
    setState({ status: 'loading', data: null, error: null });
    try {
      const data = await viewLoi(site.id);
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      setState({
        status: 'error', data: null,
        error: err?.detail || err?.message || 'Could not load the LOI.',
      });
    }
  }, [site.id]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submitSendBack = async () => {
    const note = comments.trim();
    if (!note) { setCommentError('Comments are required to send back.'); return; }
    // The ref guards the same-tick double-fire a disabled attribute can't —
    // state hasn't re-rendered between two fast clicks.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setCommentError('');
    setBusy(true);
    try {
      await onSendBack(site, note);
      onClose();
    } catch (err) {
      setCommentError(err?.detail || err?.message || 'Could not send the LOI back.');
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };

  const { status, data, error } = state;
  // A resolved response with no file_url AND no uploaded_at means nothing has
  // been uploaded. A stored-but-unsignable file raises 503, landing in `error`.
  const nothingUploaded = status === 'ready' && !data?.fileUrl && !data?.uploadedAt;
  const href = data?.fileUrl ? safeHref(data.fileUrl) : null;

  return (
    <div role="dialog" aria-modal="true" aria-label={`LOI for ${site.name}`} style={overlay}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-accent)' }}>
              LOI · {site.code}
            </span>
            <h2 style={{ margin: '4px 0 6px', fontFamily: 'var(--zm-font-display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--zm-fg)' }}>
              {site.name}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="zm-icon-btn" style={{ background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)', borderRadius: 8, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--zm-fg-2)', cursor: 'pointer' }}>
            <Icon name="x" size={14}/>
          </button>
        </div>

        {status === 'loading' && (
          <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>Fetching the LOI…</p>
        )}

        {status === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p role="alert" style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-danger)' }}>{error}</p>
            <button type="button" onClick={load} style={{ ...btn('var(--zm-surface-2)', 'var(--zm-fg)'), border: '1px solid var(--zm-line)', alignSelf: 'flex-start' }}>
              Try again
            </button>
          </div>
        )}

        {nothingUploaded && (
          <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
            No LOI has been uploaded for this site yet.
          </p>
        )}

        {status === 'ready' && !nothingUploaded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-fg-3)' }}>
              Uploaded {data.uploadedAt || '—'}
            </div>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" style={{ ...btn('var(--zm-accent)'), alignSelf: 'flex-start' }}>
                Open LOI <Icon name="arrow" size={12}/>
              </a>
            ) : (
              // safeHref rejected the scheme. Say so rather than rendering
              // nothing — a silent blank panel is the exact failure this dialog
              // exists to fix.
              <p role="alert" style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 12.5, color: 'var(--zm-danger)' }}>
                This LOI’s stored link is not a valid web address, so it cannot be opened.
                You can still send it back for re-upload.
              </p>
            )}
          </div>
        )}

        {canSendBack && status !== 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--zm-line-faint)', paddingTop: 16 }}>
            <label htmlFor={textareaId} style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, color: 'var(--zm-fg-2)' }}>
              Wrong file? Send it back
            </label>
            <textarea
              id={textareaId}
              value={comments}
              onChange={(e) => { setComments(e.target.value); if (commentError) setCommentError(''); }}
              placeholder="Comments (required to send back)"
              style={{ height: 72, padding: 10, resize: 'vertical', borderRadius: 8, border: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)', color: 'var(--zm-fg)', fontFamily: 'var(--zm-font-body)', fontSize: 12.5 }}
            />
            {commentError && (
              <span role="alert" style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, color: 'var(--zm-danger)' }}>{commentError}</span>
            )}
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 11.5, color: 'var(--zm-fg-3)', lineHeight: 1.5 }}>
              The site returns to “Awaiting LOI” and the executive is notified. The
              days-to-LOI clock keeps running, so this site may show as overdue.
            </p>
            <button
              type="button"
              onClick={submitSendBack}
              disabled={busy}
              style={{ ...btn('var(--zm-danger)'), alignSelf: 'flex-start', opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? 'Sending back…' : 'Send back'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
