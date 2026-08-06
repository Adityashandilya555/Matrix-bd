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
