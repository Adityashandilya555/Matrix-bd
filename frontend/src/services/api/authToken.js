// authToken — single source of truth for the Supabase access token used by
// the HTTP adapter. The auth provider (Supabase JS client, custom login form,
// etc.) calls `setAuthToken(token)` after a successful sign-in and clears it on
// sign-out; the HTTP adapter calls `getAuthToken()` on every request.
//
// We use a module-level closure rather than React state because the adapter is
// not a component and must read the token synchronously, including from
// non-React callers (CSV exports, background polls, etc.).
//
// The token is mirrored into `sessionStorage` so it survives F5 — `sessionStorage`
// (not `localStorage`) so it doesn't leak across browser tabs and so the
// session naturally ends with the tab. Cross-tab sync can be added later via
// the `storage` event.

const STORAGE_KEY = 'matrix.access_token';
export const SESSION_EXPIRED_EVENT = 'scale:session-expired';

let _token = null;
const _listeners = new Set();

function _readPersisted() {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage.getItem(STORAGE_KEY); }
  catch { return null; }
}

function _writePersisted(token) {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
    else       window.sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* incognito/quota — best-effort only */ }
}

// Lazy hydrate from sessionStorage on first call.
function _ensureHydrated() {
  if (_token !== null) return;
  _token = _readPersisted() || '';
}

export function getAuthToken() {
  _ensureHydrated();
  return _token || null;
}

export function setAuthToken(token) {
  _token = token || '';
  _writePersisted(_token);
  for (const fn of _listeners) {
    try { fn(_token || null); } catch { /* ignore subscriber errors */ }
  }
}

export function clearAuthToken() { setAuthToken(null); }

// Subscribe to token changes. Returns an unsubscribe fn.
export function subscribeAuthToken(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    const json = typeof atob === 'function'
      ? atob(padded)
      : globalThis.Buffer?.from(padded, 'base64').toString('utf8');
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// The role baked into the token at sign-in. This is the user's REAL role: the
// X-Override-Role header rewrites what the backend reports back, but it cannot
// touch the credential itself, so this is the one role reading available to
// non-React callers (the axios interceptors) that an override can't move.
//
// Stale if the role changes in the DB mid-session — the token is only re-minted
// on refresh. Fine for the one thing it drives (not sending a doomed write);
// the backend re-reads the role from the DB on every single request.
export function getAuthTokenRole(token = getAuthToken()) {
  const payload = _decodeJwtPayload(token);
  return payload?.app_metadata?.role || null;
}

export function getAuthTokenExpiryMs(token = getAuthToken()) {
  const payload = _decodeJwtPayload(token);
  return payload?.exp ? Number(payload.exp) * 1000 : null;
}

export function isAuthTokenExpiringSoon(token = getAuthToken(), windowMs = 10 * 60 * 1000) {
  const expiresAt = getAuthTokenExpiryMs(token);
  if (!token || !expiresAt) return false;
  return expiresAt - Date.now() <= windowMs;
}

export function notifySessionExpired(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail }));
}
