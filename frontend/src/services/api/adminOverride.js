// skipcq: JS-0833
// Admin override — persists the business_admin role/module simulation in
// sessionStorage so it survives portal navigation but is cleared on tab close.
const STORAGE_KEY = 'zm:admin-override';

// skipcq: JS-0833
export function getStoredOverride() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.role && parsed?.module) return parsed;
  } catch { /* ignore */ }
  return null;
}

// In-memory mirror for the axios interceptor — avoids sessionStorage I/O per request.
let _active = (typeof window !== 'undefined') ? getStoredOverride() : null;

// Subscribers, so React state can track this store instead of shadowing it.
// SessionContext copies the override into state at mount; a panel that writes
// here directly (Workspace Access lives in a portal with its own tree) would
// otherwise leave the mounted provider reporting a simulated role and module
// that no request is carrying any more. Same pattern as authToken.js.
const _listeners = new Set();

// skipcq: JS-0833
export function subscribeOverride(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// skipcq: JS-0833
export function activateOverride(override) {
  _active = override || null;
  try {
    if (override) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(override));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  for (const fn of _listeners) {
    try { fn(_active); } catch { /* ignore subscriber errors */ }
  }
}

// skipcq: JS-0833
export function deactivateOverride() {
  activateOverride(null);
}

// skipcq: JS-0833
export function getActiveOverride() {
  return _active;
}
