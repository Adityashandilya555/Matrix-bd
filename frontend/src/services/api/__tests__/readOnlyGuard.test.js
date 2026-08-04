// The client-side write-deny that both axios instances share.
//
// It is NOT the security boundary — app/core/deps.py refuses the request even
// if this file is deleted. What it is responsible for is that browsing
// read-only does not spray doomed writes at the API, and that it never gets in
// the way of a request that has to go through.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tokenRole = vi.fn();
vi.mock('../authToken.js', () => ({
  getAuthTokenRole: (...a) => tokenRole(...a),
  getAuthToken: () => 'token',
}));

const { assertRequestAllowed, isReadOnlyRole, READ_ONLY_MESSAGE } =
  await import('../readOnlyGuard.js');

class TestError extends Error {
  constructor({ status, detail, code }) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

const check = (config) => assertRequestAllowed(config, TestError);

beforeEach(() => { tokenRole.mockReset().mockReturnValue('observer'); });

describe('readOnlyGuard — an observer', () => {
  it.each(['post', 'patch', 'put', 'delete'])('is refused a %s', (method) => {
    expect(() => check({ method, url: '/sites/s1' })).toThrow(READ_ONLY_MESSAGE);
  });

  it.each(['get', 'head', 'options'])('is allowed a %s', (method) => {
    expect(check({ method, url: '/sites' })).toBeTruthy();
  });

  it('is refused regardless of case, since axios does not normalise it', () => {
    expect(() => check({ method: 'POST', url: '/sites' })).toThrow(READ_ONLY_MESSAGE);
  });

  it('reports 403, not 0 — a 0 reads as "network error" everywhere in this app', () => {
    expect.assertions(2);
    try { check({ method: 'post', url: '/sites' }); }
    catch (e) { expect(e.status).toBe(403); expect(e.code).toBe('READ_ONLY'); }
  });
});

describe('readOnlyGuard — what it must never block', () => {
  it('lets an observer sign out', () => {
    // POST /auth/logout. Blocking it would trap an observer in a session it
    // cannot leave — the failure mode a blanket method rule invites.
    expect(check({ method: 'post', url: '/auth/logout' })).toBeTruthy();
  });

  it('lets the token refresh through', () => {
    expect(check({ method: 'post', url: '/auth/refresh' })).toBeTruthy();
  });

  it('does not match an allowlisted path as a mere substring of another', () => {
    expect(() => check({ method: 'post', url: '/auth/logout/all-devices' }))
      .toThrow(READ_ONLY_MESSAGE);
  });

  it.each(['supervisor', 'executive', 'business_admin', null])(
    'never blocks a %s', (role) => {
      tokenRole.mockReturnValue(role);
      expect(check({ method: 'post', url: '/sites' })).toBeTruthy();
    },
  );
});

describe('readOnlyGuard — it reads the credential, not the override', () => {
  it('keys on the role in the token, which X-Override-Role cannot rewrite', () => {
    // An observer viewing a module "as supervisor" carries the override header
    // on every request. If this read the effective role instead of the token's,
    // entering a module would switch the guard off.
    tokenRole.mockReturnValue('observer');
    expect(() => check({
      method: 'post', url: '/design/s1/allocate',
      headers: { 'X-Override-Role': 'supervisor' },
    })).toThrow(READ_ONLY_MESSAGE);
  });

  it('names exactly one read-only role', () => {
    expect(isReadOnlyRole('observer')).toBe(true);
    expect(isReadOnlyRole('supervisor')).toBe(false);
  });
});

describe('readOnlyGuard — defaults', () => {
  it('treats a config with no method as a GET, the way axios does', () => {
    expect(check({ url: '/sites' })).toBeTruthy();
  });
});
