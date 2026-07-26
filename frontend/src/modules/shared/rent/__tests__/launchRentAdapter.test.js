// launchRentAdapter — the form-boundary translation between RentTermsFormV2's
// canonical snake_case contract and the launch_approvals staging keys the two
// launch-edit surfaces hydrate + submit. These lock the round-trip, the per-year
// split preservation, and — via a source scan — that nothing the form emits can
// silently fall off the launch payload.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LAUNCH_RENT_KEYS, toV2Value, fromV2Key, pickLaunchRentFields, buildLaunchRentPayload,
} from '../launchRentAdapter.js';

describe('launchRentAdapter — key translation', () => {
  it('renames escalation_pct -> expected_escalation_pct for the form, deleting the old key', () => {
    const v2 = toV2Value({ rent_type: 'fixed', escalation_pct: 5, expected_rent: 120000 });
    expect(v2.expected_escalation_pct).toBe(5);
    expect('escalation_pct' in v2).toBe(false); // deleted, so a stray read renders blank
    expect(v2.expected_rent).toBe(120000);       // everything else passes through
  });

  it('maps expected_escalation_pct back to escalation_pct on the way out', () => {
    expect(fromV2Key('expected_escalation_pct')).toBe('escalation_pct');
  });

  it('round-trips a known key through both directions', () => {
    const form = { escalation_pct: 7 };
    const v2 = toV2Value(form);
    // The form emits the V2 key; the surface maps it back before setForm.
    expect(fromV2Key('expected_escalation_pct')).toBe('escalation_pct');
    expect(v2.expected_escalation_pct).toBe(7);
  });

  it('passes launch keys through unchanged', () => {
    for (const k of ['rent_type', 'expected_rent', 'rev_share_pct', 'staggered_escalation', 'rent_free_days']) {
      expect(fromV2Key(k)).toBe(k);
    }
  });

  it('passes an unknown key through but logs it (the canary, not a silent drop)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(fromV2Key('brand_new_field')).toBe('brand_new_field');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('launchRentAdapter — hydrate', () => {
  it('picks exactly the launch rent keys, nulling absent ones', () => {
    const f = pickLaunchRentFields({ rent_type: 'fixed', escalation_pct: 5, unrelated: 'x' });
    expect(Object.keys(f).sort()).toEqual([...LAUNCH_RENT_KEYS].sort());
    expect(f.rent_type).toBe('fixed');
    expect(f.escalation_pct).toBe(5);
    expect(f.rent_free_days).toBeNull();
    expect('unrelated' in f).toBe(false);
  });
});

describe('launchRentAdapter — payload builder', () => {
  it('PRESERVES the per-year dine-in / delivery split (fails against the old {year,percent} strip)', () => {
    const payload = buildLaunchRentPayload({
      rent_type: 'staggered',
      staggered_escalation: [{ year: 1, percent: 5, dine_in_pct: 8, delivery_pct: 4 }],
    });
    expect(payload.staggered_escalation).toEqual([{ year: 1, percent: 5, dine_in_pct: 8, delivery_pct: 4 }]);
  });

  it('OMITS an unset extra rather than nulling it (byte-identical stored row)', () => {
    const payload = buildLaunchRentPayload({
      rent_type: 'staggered',
      staggered_escalation: [{ year: 1, percent: 5, dine_in_pct: '' }],
    });
    expect(payload.staggered_escalation[0]).toEqual({ year: 1, percent: 5 });
  });

  it('filters incomplete rows and keeps percent: 0', () => {
    const payload = buildLaunchRentPayload({
      rent_type: 'staggered',
      staggered_escalation: [{ year: 1, percent: 0 }, { year: 2, percent: '' }, { year: '', percent: 9 }],
    });
    expect(payload.staggered_escalation).toEqual([{ year: 1, percent: 0 }]);
  });

  it('nulls the schedule when the rent is not staggered', () => {
    const payload = buildLaunchRentPayload({ rent_type: 'fixed', staggered_escalation: [{ year: 1, percent: 5 }] });
    expect(payload.staggered_escalation).toBeNull();
  });

  it('clears a stale single rev-share % when converting to a non-rev-share type', () => {
    expect(buildLaunchRentPayload({ rent_type: 'fixed', rev_share_pct: 12 }).rev_share_pct).toBeNull();
    expect(buildLaunchRentPayload({ rent_type: 'staggered', rev_share_pct: 12 }).rev_share_pct).toBeNull();
  });

  it('preserves rev_share_pct for a legacy revshare / mg_revshare edit', () => {
    expect(buildLaunchRentPayload({ rent_type: 'revshare', rev_share_pct: 12 }).rev_share_pct).toBe(12);
    expect(buildLaunchRentPayload({ rent_type: 'mg_revshare', rev_share_pct: 12 }).rev_share_pct).toBe(12);
  });
});

describe('launchRentAdapter — key-set lock (catches a future rename)', () => {
  it('every key RentTermsFormV2 emits maps into a launch rent field', () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../RentTermsFormV2.jsx'), 'utf8',
    );
    // Every top-level change the form emits is `onChange?.('key', …)` or the
    // curried `set('key')`. Per-row keys go through patchRow(idx, 'k', …) and are
    // carried INSIDE staggered_escalation, so they are intentionally not scanned.
    const emitted = new Set(
      [...src.matchAll(/(?:onChange\?\.|set)\(\s*'([a-z_]+)'/g)].map((m) => m[1]),
    );
    expect(emitted.size).toBeGreaterThan(6); // guard: a broken regex must not pass vacuously

    const escaped = [...emitted].map(fromV2Key).filter((k) => !LAUNCH_RENT_KEYS.includes(k));
    expect(escaped, `keys that would be dropped by the launch payload: ${escaped.join(', ')}`).toEqual([]);
  });
});

afterEach(() => vi.restoreAllMocks());
