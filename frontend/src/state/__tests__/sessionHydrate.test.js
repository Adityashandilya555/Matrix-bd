// Batch K — #128: hydrate only drops the token on a real auth rejection.
import { describe, it, expect } from 'vitest';
import { isAuthRejection } from '../SessionContext.jsx';

describe('isAuthRejection (#128)', () => {
  it('treats 401/403 as auth rejections (clear token)', () => {
    expect(isAuthRejection({ status: 401 })).toBe(true);
    expect(isAuthRejection({ status: 403 })).toBe(true);
  });

  it('does NOT treat timeouts / network / 5xx as auth rejections (keep token)', () => {
    expect(isAuthRejection({ status: 0, code: 'TIMEOUT' })).toBe(false); // axios ECONNABORTED
    expect(isAuthRejection({ status: 0 })).toBe(false); // CORS / network
    expect(isAuthRejection({ status: 500 })).toBe(false);
    expect(isAuthRejection({ status: 503 })).toBe(false);
    expect(isAuthRejection(undefined)).toBe(false);
  });
});
