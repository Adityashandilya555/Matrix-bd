// skipcq: JS-0833
// Full-screen preview for a single site photo.
//
// Logic is modelled on business-admin/ui/kit.jsx Drawer (Escape, focus-in,
// click-outside via mousedown target check, portal) but NOT its styling — that
// component pulls in the ac-* admin theme. This one uses zm-* tokens so it sits
// correctly inside the BD surfaces.
//
// It goes further than that Drawer in three ways, deliberately: it traps Tab,
// locks body scroll, and restores focus to the trigger on close. A full-screen
// overlay with a scrolling page behind it is visibly wrong, and there are only
// a couple of focusables to cycle.
import React from 'react';
import { createPortal } from 'react-dom';
import Icon from '../primitives/Icon.jsx';
import { isImage } from '../../../lib/mime.js';
import { safeHref } from '../../../lib/safeHref.js';
import { lockBodyScroll } from '../../../lib/scrollLock.js';
import { useDialogFocus } from '../../../lib/a11y.js';

// Above every in-app dialog (max 120) and the CitySelect dropdown (200), but
// BELOW the toast (300) so upload/error toasts stay readable over it, and well
// below the session-expired modal (9999), which must always win.
const Z = 290;

export default function ImageLightbox({ open, photo, onClose, onRefreshUrl }) {
  const panelRef = React.useRef(null);
  const retriedRef = React.useRef(false);
  const [src, setSrc] = React.useState(photo?.url || null);
  const [failed, setFailed] = React.useState(false);

  // Start from the URL the list was fetched with, and reset the one-shot retry
  // for each newly previewed file.
  //
  // It does NOT re-sign here. Signed URLs live 300s and every caller's
  // onRefreshUrl re-signs the site's WHOLE document list to recover one of them
  // — one storage round-trip per file, capped at 8 concurrent, so a site with 25
  // documents paid 25 of them every time a preview was opened (#499). The URL is
  // usually still valid, and onImgError below already recovers the case where it
  // is not, so the expiry is handled on the path where it actually happens.
  React.useEffect(() => {
    retriedRef.current = false;
    setFailed(false);
    setSrc(photo?.url || null);
  }, [open, photo]);

  // Escape, the Tab trap, focus-in and focus-restore, shared with every other
  // dialog. Using the hook rather than a private copy is what makes the lightbox
  // participate in the overlay stack: opened over a drawer that also uses it,
  // the lightbox is topmost and takes the keys, instead of the drawer behind it
  // closing on an Escape meant for the preview (#497).
  useDialogFocus(open && Boolean(photo), panelRef, onClose);

  // Counted, so the order overlays close in does not matter: save/restore of a
  // "previous" value hands scrolling back to the page whenever the OUTER
  // overlay closes first, while the inner one is still up.
  React.useEffect(() => (open ? lockBodyScroll() : undefined), [open]);

  if (!open || !photo) return null;

  const name = photo.name || 'Site photo';
  const href = safeHref(src);
  // photo.url is legitimately null when the signer failed, and a non-image can
  // reach file_type='photo' because the backend has no allowlist.
  const showImage = Boolean(src) && !failed && (photo.mimeType == null || isImage(photo.mimeType));

  const onImgError = async () => {
    // Exactly one retry — a genuinely missing object must not loop.
    if (retriedRef.current || !onRefreshUrl) { setFailed(true); return; }
    retriedRef.current = true;
    try {
      const fresh = await onRefreshUrl(photo);
      if (fresh) setSrc(fresh); else setFailed(true);
    } catch {
      setFailed(true);
    }
  };

  const node = (
    <div
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: Z,
        background: 'rgba(11,12,16,0.82)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32,
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        style={{
          maxWidth: 'min(1100px, 100%)', maxHeight: '100%',
          display: 'flex', flexDirection: 'column', gap: 10, outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700, color: '#fff', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              Open original
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="x" size={14}/>
          </button>
        </div>

        {showImage ? (
          // onError is a load-lifecycle handler, not a mouse/keyboard listener —
          // the rule does not distinguish them. The image is not interactive;
          // the close button and "Open original" link carry the affordances.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <img
            src={src}
            alt={name}
            onError={onImgError}
            style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 140px)', objectFit: 'contain', borderRadius: 10, background: 'var(--zm-surface-2)' }}
          />
        ) : (
          <div style={{ padding: 40, borderRadius: 10, background: 'var(--zm-surface)', border: '1px solid var(--zm-line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 280 }}>
            <Icon name="file" size={26}/>
            <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-2)', textAlign: 'center' }}>
              {failed || !src
                ? 'This image could not be loaded — it may have been removed.'
                : 'This file is not an image, so it cannot be previewed here.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  // Portal to body: the site drawer's own scrim carries onClick={onClose}, and
  // its panel is position:absolute with no zIndex. Portalling keeps this above
  // the drawer and off that scrim's DOM path.
  return createPortal(node, document.body);
}
