// skipcq: JS-0833
import React from 'react';
import {
  getAuthToken, clearAuthToken, notifySessionExpired, subscribeAuthToken,
} from '../services/api/authToken.js';

export const INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

const ACTIVITY_KEY = 'zm:last-activity';
const CHECK_INTERVAL_MS = 60 * 1000;  
const RECORD_THROTTLE_MS = 30 * 1000;

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown', 'scroll'];

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

export function useInactivityLogout({ timeoutMs = INACTIVITY_TIMEOUT_MS, enabled = true } = {}) {
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

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

    const onForeground = () => { if (document.visibilityState !== 'hidden') check(); };
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);

    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);
    check();

    return () => {
      unsubToken();
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, recordActivity);
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
      window.clearInterval(intervalId);
    };
  }, [timeoutMs, enabled]);
}
