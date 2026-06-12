// Scheme allowlist for user-supplied URLs rendered as <a href> (#87).
// React does NOT sanitise href — a stored `javascript:` URL renders as a
// clickable link that executes script (and can read the JWT in
// sessionStorage). Backed by the server-side validator on google_maps_url;
// this guards legacy rows and any future unvalidated field.
const ALLOWED = ['http:', 'https:', 'mailto:'];

export function safeHref(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return ALLOWED.includes(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}
