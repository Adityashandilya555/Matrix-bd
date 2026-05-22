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
