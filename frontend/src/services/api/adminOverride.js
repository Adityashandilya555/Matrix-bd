// skipcq: JS-0833
// Admin override — persists role/module simulation for business_admin users.
// Written to sessionStorage so it survives navigation between the business-admin
// portal (/business-admin) and the main workspace (/), but is cleared on tab close.
// skipcq: JS-0833
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

// skipcq: JS-0833
export function activateOverride(override) {
  _active = override || null;
  try {
    if (override) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(override));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

// skipcq: JS-0833
export function deactivateOverride() {
  activateOverride(null);
}

// skipcq: JS-0833
export function getActiveOverride() {
  return _active;
}
