// skipcq: JS-0833
// roleFromToken decides whether a request skips the workspace-override
// headers (vendor sessions never send them) and where RequireAuth sends a
// signed-in user. It must never throw on a malformed token.
import { describe, it, expect } from 'vitest';
import { roleFromToken } from '../tokenRole.js';

const b64url = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('roleFromToken', () => {
  it('reads app_metadata.role', () => {
    expect(roleFromToken(`h.${b64url({ app_metadata: { role: 'vendor' } })}.s`)).toBe('vendor');
    expect(roleFromToken(`h.${b64url({ app_metadata: { role: 'supervisor' } })}.s`)).toBe('supervisor');
  });

  it('returns null for missing or malformed tokens', () => {
    for (const t of [null, undefined, '', 'nodots', 'a.%%%.b', `h.${b64url({})}.s`]) {
      expect(roleFromToken(t)).toBeNull();
    }
  });
});
