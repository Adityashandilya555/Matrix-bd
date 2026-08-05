// skipcq: JS-0833
// The client-side mirror of the backend's write-deny.
//
// An observer entering a module as its supervisor sees that supervisor's page,
// buttons included — the module pages have no single read-only convention to
// hook (four different ones across ~9 pages), so hiding every write control
// individually would be a large, drifting change. Instead the one thing every
// write has in common is that it leaves through an axios instance, so the check
// lives there: the same shape as the backend, where 106 mutating routes are
// governed by one deny in get_current_user.
//
// THIS IS NOT THE BOUNDARY. It is a client. The boundary is
// app/core/deps.py::_assert_may_write, which refuses the request even if this
// file is deleted. What this buys is that browsing read-only does not spray
// failed writes at the API, and that a stray button reports something true
// ("read-only access") instead of a bare 403.
import { getAuthTokenRole } from './authToken.js';

// Mirrors _READ_METHODS in app/core/deps.py.
const READ_METHODS = new Set(['get', 'head', 'options']);

// Requests that must go through even for an observer. These are session
// lifecycle, not workspace writes — blocking /auth/logout would trap an
// observer in a session they cannot leave, which is exactly the kind of bug a
// blanket rule invites.
const ALWAYS_ALLOWED = ['/auth/logout', '/auth/refresh', '/auth/whoami'];

export const READ_ONLY_MESSAGE = 'Observer access is read-only.';

// The role /auth/whoami last reported, which is re-read from the DB on every
// request. The token is only a fallback: it is minted at sign-in and stays put
// for 24h, so an observer PROMOTED mid-session would keep being refused here
// long after the backend had started allowing its writes. SessionContext pushes
// the fresh value in as soon as it hydrates; until then the token is the only
// thing available, and erring toward read-only is the safe direction.
let _sessionRole;

// skipcq: JS-0833
export function setSessionRole(role) {
  _sessionRole = role || undefined;
}

export function isReadOnlyRole(role) {
  return role === 'observer';
}

// Throws when `config` is a write and the signed-in credential is an observer.
// Called from the request interceptor of both axios instances — shared rather
// than written twice so the two cannot drift, the same reason guards.py uses one
// READ_ALL_ROLES constant for its two bypasses.
export function assertRequestAllowed(config, ReadOnlyError) {
  const method = String(config?.method || 'get').toLowerCase();
  if (READ_METHODS.has(method)) return config;
  if (!isReadOnlyRole(_sessionRole ?? getAuthTokenRole())) return config;

  const url = String(config?.url || '');
  if (ALWAYS_ALLOWED.some((path) => url.endsWith(path))) return config;

  // 403 so callers that already branch on an auth rejection keep behaving the
  // way they would have if the request had actually reached the backend.
  throw new ReadOnlyError({ status: 403, code: 'READ_ONLY', detail: READ_ONLY_MESSAGE });
}
