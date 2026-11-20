// skipcq: JS-0833
// Read the role claim from a JWT string without going through authToken.js.
//
// The request interceptors call this with the token they already hold. It lives
// in its own module so the many tests that stub authToken.js keep working, and
// so the interceptors never depend on token-store state. UI hint only: the
// server re-reads the real role on every request.
export function roleFromToken(token) { // skipcq: JS-0833
  if (!token || typeof token !== 'string') return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const raw = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return raw?.app_metadata?.role || null;
  } catch {
    return null;
  }
}
