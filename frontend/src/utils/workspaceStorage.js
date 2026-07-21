// ── Workspace code persistence (localStorage) ──────────────────────────────
// Stores the most-recent workspace codes so the user doesn't have to re-type
// them on every login.  Limit: 3 entries (most-recent-first).

const STORAGE_KEY = 'zm_workspace_codes';
const MAX = 3;

/** Return previously-used workspace codes (most-recent first). */
export function getStoredWorkspaceCodes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Return the most-recently used code, or null. */
export function getLastWorkspaceCode() {
  const codes = getStoredWorkspaceCodes();
  return codes.length > 0 ? codes[0] : null;
}

/** Add (or promote) a code to the front of the list, deduped, max 3. */
export function addWorkspaceCode(code) {
  if (!code) return;
  const upper = code.trim().toUpperCase();
  if (!upper) return;
  const existing = getStoredWorkspaceCodes().filter((c) => c !== upper);
  const next = [upper, ...existing].slice(0, MAX);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full / disabled — silently ignore.
  }
}
