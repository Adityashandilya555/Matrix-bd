// Best-effort JWT payload decode. Returns `{}` on any failure — callers should
// not rely on this for security (the backend is the source of truth on every
// request); it's used purely to drive UI gating before the first API call.

export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return {};
  try {
    return JSON.parse(atob(token.split('.')[1])) || {};
  } catch {
    return {};
  }
}
