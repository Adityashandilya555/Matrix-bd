// skipcq: JS-0833
// Admin override — persists the business_admin role/module simulation in
// sessionStorage so it survives portal navigation but is cleared on tab close.
const STORAGE_KEY = 'zm:admin-override';

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

export function activateOverride(override) {
  _active = override || null;
  try {
    if (override) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(override));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

export function deactivateOverride() {
  activateOverride(null);
}

export function getActiveOverride() {
  return _active;
}
