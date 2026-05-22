// Supabase auth wiring for the frontend.
//
// We deliberately do NOT bundle `@supabase/supabase-js` as a hard dep here —
// the project may want to lazy-load it. The module exposes a tiny façade with
// the methods the rest of the app needs (sign in, sign out, on-token-change)
// and lets the integrator point it at the real client at startup.
//
// Wire-up at app boot (e.g. in main.jsx):
//
//   import { createClient } from '@supabase/supabase-js';
//   import { configureSupabase } from './services/api/supabaseAuth.js';
//
//   const supabase = createClient(
//     import.meta.env.VITE_SUPABASE_URL,
//     import.meta.env.VITE_SUPABASE_ANON_KEY,
//   );
//   configureSupabase(supabase);
//
// After that, the HTTP adapter automatically picks up the access token because
// configureSupabase subscribes to onAuthStateChange and pushes the token into
// authToken.js (read on every request).

import { clearAuthToken, setAuthToken } from './authToken.js';

let _client = null;

export function configureSupabase(supabaseClient) {
  _client = supabaseClient;

  // Hydrate the token immediately if there's already a session.
  _client.auth.getSession().then(({ data }) => {
    const token = data?.session?.access_token;
    if (token) setAuthToken(token);
  }).catch(() => { /* no session yet — fine */ });

  // Keep the token in sync across refresh / sign-in / sign-out.
  _client.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) setAuthToken(session.access_token);
    else                       clearAuthToken();
  });
}

export async function signInWithPassword(email, password) {
  _assertConfigured();
  const { data, error } = await _client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data?.session?.access_token) setAuthToken(data.session.access_token);
  return data;
}

export async function signOut() {
  _assertConfigured();
  await _client.auth.signOut();
  clearAuthToken();
}

export function getSupabase() {
  _assertConfigured();
  return _client;
}

function _assertConfigured() {
  if (!_client) {
    throw new Error(
      'Supabase client not configured. Call configureSupabase(...) in main.jsx ' +
      'before using auth methods.',
    );
  }
}
