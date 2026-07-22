// skipcq: JS-0833
import { describe, it, expect } from 'vitest';
import { isInactive, INACTIVITY_TIMEOUT_MS } from '../useInactivityLogout.js';

const HOUR = 60 * 60 * 1000;

describe('inactivity timeout', () => {
  it('is 8 hours', () => {
    expect(INACTIVITY_TIMEOUT_MS).toBe(8 * HOUR);
  });

  it('not inactive before the window elapses', () => {
    const now = 1_000_000_000;
    expect(isInactive(now - (7 * HOUR + 59 * 60 * 1000), now, INACTIVITY_TIMEOUT_MS)).toBe(false);
  });

  it('inactive exactly at and beyond the window', () => {
    const now = 1_000_000_000;
    expect(isInactive(now - 8 * HOUR, now, INACTIVITY_TIMEOUT_MS)).toBe(true);       // == boundary
    expect(isInactive(now - 9 * HOUR, now, INACTIVITY_TIMEOUT_MS)).toBe(true);
  });

  it('treats a missing/invalid timestamp as active (never logs out on bad data)', () => {
    const now = 1_000_000_000;
    expect(isInactive(null, now, INACTIVITY_TIMEOUT_MS)).toBe(false);
    expect(isInactive(undefined, now, INACTIVITY_TIMEOUT_MS)).toBe(false);
    expect(isInactive(NaN, now, INACTIVITY_TIMEOUT_MS)).toBe(false);
  });
});
