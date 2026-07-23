// skipcq: JS-0833
import React from 'react';
import {
  getAuthToken, clearAuthToken, notifySessionExpired, subscribeAuthToken,
} from '../services/api/authToken.js';

// Sign a session out after this long with no user interaction.
export const INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

const ACTIVITY_KEY = 'zm:last-activity';
const CHECK_INTERVAL_MS = 60 * 1000;   // re-evaluate every minute
const RECORD_THROTTLE_MS = 30 * 1000;  // persist activity at most this often
// Real user-interaction events only. Background polling and token refreshes are
// deliberately NOT counted — otherwise an idle user's queues (which keep
// refetching every 30s) would reset the clock forever and the timeout could
// never fire.
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown', 'scroll'];

// Pure predicate, exported for tests: has the session been idle >= timeoutMs?
export function isInactive(lastActivityMs, nowMs, timeoutMs) {
  if (lastActivityMs == null || !Number.isFinite(lastActivityMs)) return false;
  return nowMs - lastActivityMs >= timeoutMs;
}

function readLastActivity() {
  try {
    const raw = window.sessionStorage.getItem(ACTIVITY_KEY);
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
function writeLastActivity(ts) {
  try { window.sessionStorage.setItem(ACTIVITY_KEY, String(ts)); } catch { /* storage disabled */ }
}
function clearLastActivity() {
  try { window.sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* storage disabled */ }
}

// Logs the user out after `timeoutMs` of inactivity on the current tab/session.
//
// The last-activity timestamp lives in sessionStorage (per-tab), so it survives
// an F5 within the same tab — a page reload does NOT hand out a fresh idle
// window. It is reset only on a genuine sign-in (token absent -> present), never
// on the silent token refreshes that keep an active session alive. When the
// window elapses we clear the token and raise the existing session-expired
// event, which surfaces the "sign in again" modal.
export function useInactivityLogout({ timeoutMs = INACTIVITY_TIMEOUT_MS, enabled = true } = {}) {
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    // Seed on mount only if there is a live session without a timestamp yet
    // (keeps a running clock across F5; a fresh sign-in is handled below).
    if (getAuthToken() && readLastActivity() == null) writeLastActivity(Date.now());

    let lastRecordAt = 0;
    const recordActivity = () => {
      if (!getAuthToken()) return;
      const now = Date.now();
      if (now - lastRecordAt < RECORD_THROTTLE_MS) return;
      lastRecordAt = now;
      writeLastActivity(now);
    };

    const check = () => {
      if (!getAuthToken()) return;
      const last = readLastActivity();
      if (last == null) { writeLastActivity(Date.now()); return; }
      if (isInactive(last, Date.now(), timeoutMs)) {
        clearLastActivity();
        clearAuthToken();
        notifySessionExpired({ reason: 'inactivity' });
      }
    };

    // Reset the clock only on a real sign-in (absent -> present); a token
    // refresh (present -> present) must NOT reset it, or inactivity never trips.
    let prevHadToken = !!getAuthToken();
    const unsubToken = subscribeAuthToken((token) => {
      const hasToken = !!token;
      if (hasToken && !prevHadToken) { lastRecordAt = 0; writeLastActivity(Date.now()); }
      else if (!hasToken) clearLastActivity();
      prevHadToken = hasToken;
    });

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, recordActivity, { passive: true });
    }
    // A tab returning to the foreground may have been idle in the background
    // past the window — re-check immediately.
    const onForeground = () => { if (document.visibilityState !== 'hidden') check(); };
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);

    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);
    check(); // catch a tab restored past the window on first mount

    return () => {
      unsubToken();
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, recordActivity);
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
      window.clearInterval(intervalId);
    };
  }, [timeoutMs, enabled]);
}
