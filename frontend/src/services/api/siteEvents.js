export const SITE_DATA_CHANGED_EVENT = 'matrix:sites-changed';

export function notifySiteDataChanged(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SITE_DATA_CHANGED_EVENT, { detail }));
}

export function subscribeSiteDataChanged(handler) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => handler(event.detail || {});
  window.addEventListener(SITE_DATA_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SITE_DATA_CHANGED_EVENT, listener);
}
