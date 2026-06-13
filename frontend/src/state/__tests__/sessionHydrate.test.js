// Batch K — #128: hydrate only drops the token on a real auth rejection.
import { describe, it, expect } from 'vitest';
import { isAuthRejection, isPublicSessionRoute } from '../SessionContext.jsx';

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

// #173 regression: the session-expired modal must NEVER render on a public /
// unauthenticated route, so a stale token can't pop "session paused" over the
// marketing landing or the branded login.
describe('isPublicSessionRoute (#173)', () => {
  it('treats the landing, login and admin portals as public', () => {
    expect(isPublicSessionRoute('/welcome')).toBe(true);
    expect(isPublicSessionRoute('/login')).toBe(true);
    expect(isPublicSessionRoute('/login/BLUETOKAI')).toBe(true); // branded login
    expect(isPublicSessionRoute('/admin')).toBe(true);
    expect(isPublicSessionRoute('/business-admin')).toBe(true);
  });

  it('treats authed app routes as NOT public (modal still allowed mid-session)', () => {
    expect(isPublicSessionRoute('/')).toBe(false);
    expect(isPublicSessionRoute('/pipeline')).toBe(false);
    expect(isPublicSessionRoute('/legal')).toBe(false);
    expect(isPublicSessionRoute('/nso')).toBe(false);
    // A prefix collision must not leak (e.g. a hypothetical /welcomes route).
    expect(isPublicSessionRoute('/welcomes')).toBe(false);
    expect(isPublicSessionRoute(undefined)).toBe(false);
  });
});
