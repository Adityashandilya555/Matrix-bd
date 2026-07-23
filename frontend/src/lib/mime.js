// skipcq: JS-0833
// Shared MIME helpers. Hoisted out of ExcellenceDocuments so the site-photo
// lightbox can make the same image-vs-other decision.
//
// This matters even where the picker is `accept="image/*"`: that is a client
// hint only, and photo_service has no server-side allowlist, so a crafted
// request can store a non-image under file_type='photo'. Callers should render
// a non-image fallback rather than an <img> that will never load.

export function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}
