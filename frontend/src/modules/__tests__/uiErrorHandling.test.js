// Batch G/H — these are presentational error-handling fixes on context-heavy
// pages; we validate them as source contracts (the blocking alert is gone, the
// non-blocking surface is wired) rather than via brittle full-page renders.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, rel), 'utf8');
// Strip line comments so the explanatory "replaces window.alert" notes don't match.
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('alert() removed from error paths (#138/#139/#140)', () => {
  it('DesignReviewPage uses an error banner, not alert()', () => {
    const src = code('../design/DesignReviewPage.jsx');
    expect(src).not.toMatch(/alert\(/);
    expect(src).toContain('setActionError');
  });

  it('SiteApprovalPanel uses inline panel errors, not alert()', () => {
    expect(code('../business-admin/approval/SiteApprovalPanel.jsx')).not.toMatch(/alert\(/);
  });

  it('LaunchPage routes errors through showToast, not alert()', () => {
    const src = code('../launch/LaunchPage.jsx');
    expect(src).not.toMatch(/alert\(/);
    expect(src).toContain('showToast(');
  });
});

describe('silent load failures now surface (#142/#143)', () => {
  it('DesignReviewPage surfaces team/allocation load failures', () => {
    const src = read('../design/DesignReviewPage.jsx');
    expect(src).toContain('setTeamError');
    expect(src).not.toContain('catch { /* silent */ }');
  });

  it('DdrPage surfaces a delegation load failure', () => {
    expect(read('../legal/ddr/DdrPage.jsx')).toContain('setDelegationsError');
  });
});
