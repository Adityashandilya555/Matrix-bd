// skipcq: JS-0833
// Vendor platform entry — which workspace codes open the vendor fit-out page
// instead of a Matrix workspace.
//
// The vendor platform is, for now, the standalone Fit-Out Site Tracker page at
// public/vendor/fit-out-tracker.html. It has its own sign-in, keeps its data in
// the visitor's browser, never calls the Matrix API and never receives a Matrix
// token. This list is therefore NOT an access control (the page is a public
// static file); it only routes a vendor from the shared code box to that page.
//
// Codes are read at build time from VITE_VENDOR_WORKSPACE_CODES:
//
//   VITE_VENDOR_WORKSPACE_CODES="VND-9C2E7A41B03D5F68=Shreeji Interiors;VND-31D8F0C6A92B47E5=Northline Buildtech"
//
// Unset or empty means no vendor codes, and the code box behaves exactly as it
// did before this file existed.
//
// A vendor code must be `VND-` plus 16 to 28 letters or digits. That is always
// longer than the legacy short codes /tenancy/branding answers softly (#84), so
// the server answers `found: false` for it — and callers consult this list only
// AFTER that answer, so a Matrix workspace that happened to share a code would
// still win.

const VENDOR_CODE_RE = /^VND-[A-Z0-9]{16,28}$/;

export const VENDOR_PAGE_PATH = 'vendor/fit-out-tracker.html';

/**
 * Parse `CODE=Name;CODE=Name`. Malformed or duplicate entries are skipped
 * whole, never half-applied, so a typo in the env var can only remove a code,
 * not invent one.
 */
export function parseVendorCodes(raw) {
  const out = new Map();
  if (typeof raw !== 'string' || !raw.trim()) return out;
  for (const part of raw.split(';')) {
    const entry = part.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    const code = (eq === -1 ? entry : entry.slice(0, eq)).trim().toUpperCase();
    const name = eq === -1 ? '' : entry.slice(eq + 1).trim();
    if (!VENDOR_CODE_RE.test(code) || out.has(code)) continue;
    out.set(code, { code, name: name || 'Vendor workspace' });
  }
  return out;
}

/** The configured vendor workspace for `code`, or null. Case-insensitive. */
export function vendorWorkspaceFor(code) {
  if (!code) return null;
  const codes = parseVendorCodes(import.meta.env.VITE_VENDOR_WORKSPACE_CODES);
  return codes.get(String(code).trim().toUpperCase()) || null;
}

export function vendorPageUrl() {
  return `${import.meta.env.BASE_URL || '/'}${VENDOR_PAGE_PATH}`;
}

/**
 * Leave the SPA for the standalone vendor page. replace(), not assign(): the
 * entry route only forwards, so it must not stay in history — otherwise Back
 * from the vendor page would land on the forwarder and bounce straight back.
 */
export function openVendorPage() {
  window.location.replace(vendorPageUrl());
}
