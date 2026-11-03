// skipcq: JS-0833
// The vendor-code list decides whether a code in the shared box opens the
// vendor page. It must be inert when unset, and a malformed entry must never
// turn into a code that routes somewhere.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseVendorCodes, vendorPageUrl, vendorWorkspaceFor } from '../vendorAccess.js';

const A = 'VND-9C2E7A41B03D5F68';
const B = 'VND-31D8F0C6A92B47E5';

afterEach(() => vi.unstubAllEnvs());

describe('parseVendorCodes', () => {
  it('is empty for unset or blank input', () => {
    expect(parseVendorCodes(undefined).size).toBe(0);
    expect(parseVendorCodes('').size).toBe(0);
    expect(parseVendorCodes('   ;  ; ').size).toBe(0);
  });

  it('reads CODE=Name pairs and upper-cases the code', () => {
    const m = parseVendorCodes(`${A.toLowerCase()}=Shreeji Interiors; ${B}=Northline Buildtech`);
    expect([...m.keys()]).toEqual([A, B]);
    expect(m.get(A).name).toBe('Shreeji Interiors');
  });

  it('gives a nameless entry a generic name', () => {
    expect(parseVendorCodes(A).get(A).name).toBe('Vendor workspace');
  });

  it('skips codes without the VND- shape or with a short suffix', () => {
    const m = parseVendorCodes('BTOKAI-4F8A1C9E2B7D60A3=Matrix;VND-ABC=Short;VND-9C2E-7A41B03D5F68=Hyphen;VND-ÄÖ12345678901234=Accents');
    expect(m.size).toBe(0);
  });

  it('keeps the first of duplicate codes', () => {
    const m = parseVendorCodes(`${A}=First;${A}=Second`);
    expect(m.size).toBe(1);
    expect(m.get(A).name).toBe('First');
  });

  it('never exceeds the 32-character workspace-code limit', () => {
    expect(parseVendorCodes(`VND-${'A'.repeat(28)}`).size).toBe(1);
    expect(parseVendorCodes(`VND-${'A'.repeat(29)}`).size).toBe(0);
  });
});

describe('vendorWorkspaceFor', () => {
  it('returns null when no vendor codes are configured', () => {
    vi.stubEnv('VITE_VENDOR_WORKSPACE_CODES', '');
    expect(vendorWorkspaceFor(A)).toBeNull();
  });

  it('finds a configured code regardless of case and spacing', () => {
    vi.stubEnv('VITE_VENDOR_WORKSPACE_CODES', `${A}=Shreeji Interiors`);
    expect(vendorWorkspaceFor(` ${A.toLowerCase()} `)).toEqual({ code: A, name: 'Shreeji Interiors' });
    expect(vendorWorkspaceFor(B)).toBeNull();
    expect(vendorWorkspaceFor('')).toBeNull();
  });
});

describe('vendorPageUrl', () => {
  it('points at the static vendor page under the app base', () => {
    expect(vendorPageUrl()).toBe('/vendor/fit-out-tracker.html');
  });
});
