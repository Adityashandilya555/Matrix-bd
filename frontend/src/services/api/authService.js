// Auth service — thin wrapper exposing the auth lifecycle to the rest of
// the app. Production sign-in goes through Supabase (see ./supabaseAuth.js);
// this module keeps the SessionContext bootstrap surface unchanged.
import { adapter } from './adapters/index.js';
import { DEFAULT_SESSION } from './mock/mockAuth.js';

export { DEFAULT_SESSION };

// Returns the decoded session for the current bearer token. In HTTP mode this
// hits /auth/whoami; in mock mode it returns the mock adapter's `me()` shape.
export async function me() {
  return adapter.me();
}

export async function logout() {
  return adapter.logout();
}

export async function requestExecutiveAccess() {
  return adapter.requestExecutiveAccess();
}

// `login` is intentionally absent in HTTP mode: the user signs in directly
// against Supabase (see supabaseAuth.signInWithPassword). The mock adapter
// still exposes a `login` for offline UI dev.
export async function login(credentials) {
  if (typeof adapter.login !== 'function') {
    throw new Error(
      'HTTP adapter does not expose `login` — sign in via Supabase ' +
      '(see services/api/supabaseAuth.js).',
    );
  }
  return adapter.login(credentials);
}
