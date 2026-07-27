// skipcq: JS-0833
// Frontend half of "one site, one code". The backend resolves it in
// _common.display_code() for response shaping; this covers the surfaces that
// receive both fields on the wire and have to pick.
import { describe, it, expect } from 'vitest';
import { displayCode } from '../displayCode.js';

describe('displayCode', () => {
  it('prefers the commercial code over the generated one', () => {
    // The reported site: code BT-BEG-XFDF, ca_code 201.
    expect(displayCode({ code: 'BT-BEG-XFDF', ca_code: '201' })).toBe('201');
  });

  it('falls back to the generated code before Finance mints one', () => {
    expect(displayCode({ code: 'BT-BEG-XFDF', ca_code: null })).toBe('BT-BEG-XFDF');
  });

  it.each([
    ['snake_case wire', { ca_code: '201' }],
    ['camelCase adapter', { caCode: '201' }],
    ['launch payload', { site_code: '201' }],
    ['camelCase launch payload', { siteCode: '201' }],
    ['bare code', { code: '201' }],
  ])('reads the %s shape', (_label, site) => {
    expect(displayCode(site)).toBe('201');
  });

  it('treats an empty ca_code as absent, matching the backend', () => {
    // The ca_code pattern permits '', so it must fall through rather than win.
    expect(displayCode({ code: 'BT-BEG-XFDF', ca_code: '' })).toBe('BT-BEG-XFDF');
  });

  it('returns an em dash for a codeless or missing site', () => {
    expect(displayCode({})).toBe('—');
    expect(displayCode(null)).toBe('—');
    expect(displayCode(undefined)).toBe('—');
  });

  it('takes a caller-supplied fallback', () => {
    expect(displayCode({}, 'Not set')).toBe('Not set');
  });

  it('never falls back to the site id on its own', () => {
    // Three surfaces append `|| site.id` themselves to get a handle on a codeless
    // row. That renders a raw UUID — right there, wrong everywhere else.
    expect(displayCode({ id: 'b3f1c0de-0000-4000-8000-000000000000' })).toBe('—');
  });
});
