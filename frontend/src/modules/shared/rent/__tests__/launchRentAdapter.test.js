// skipcq: JS-0833
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
  LAUNCH_RENT_KEYS, LAUNCH_COMMERCIAL_KEYS, LAUNCH_ALL_KEYS,
  toV2Value, fromV2Key, pickLaunchRentFields, buildLaunchRentPayload,
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
  it('picks exactly the launch staging keys, nulling absent ones', () => {
    const f = pickLaunchRentFields({ rent_type: 'fixed', escalation_pct: 5, unrelated: 'x' });
    expect(Object.keys(f).sort()).toEqual([...LAUNCH_ALL_KEYS].sort());
    expect(f.rent_type).toBe('fixed');
    expect(f.escalation_pct).toBe(5);
    expect(f.rent_free_days).toBeNull();
    expect('unrelated' in f).toBe(false);
  });

  it('hydrates the commercial terms from the TOP LEVEL, not from details', () => {
    // The staged values are what the reviewer edits; details.* stays canonical
    // until the admin's final confirm, so reading it would show a stale number.
    const f = pickLaunchRentFields({
      carpet_area_sqft: 1400, cam_charges: 5000, capex: 250000,
      security_deposit: 1350000, brokerage: 120950, rent_start_date: '2026-05-01',
      details: { carpet_area_sqft: 1200, cam_charges: 0 },
    });
    expect(f.carpet_area_sqft).toBe(1400);
    expect(f.cam_charges).toBe(5000);
    expect(f.rent_start_date).toBe('2026-05-01');
  });

  it('keeps the two groups disjoint and their union complete', () => {
    const overlap = LAUNCH_RENT_KEYS.filter((k) => LAUNCH_COMMERCIAL_KEYS.includes(k));
    expect(overlap).toEqual([]);
    expect(LAUNCH_ALL_KEYS).toHaveLength(LAUNCH_RENT_KEYS.length + LAUNCH_COMMERCIAL_KEYS.length);
  });
});

describe('launchRentAdapter — commercial keys survive the payload builder', () => {
  it('carries every commercial key through untouched', () => {
    // The builder exists to normalise the RENT side (staggered rows, cleared
    // rev-share). The commercial fields must ride along unmodified, or the
    // backend's extra="forbid" turns a dropped key into a silently discarded edit.
    const payload = buildLaunchRentPayload({
      rent_type: 'fixed', expected_rent: 120000,
      carpet_area_sqft: 1400, cam_charges: 5000, capex: 250000,
      security_deposit: 1350000, brokerage: 120950, rent_start_date: '2026-05-01',
    });
    expect(payload.carpet_area_sqft).toBe(1400);
    expect(payload.cam_charges).toBe(5000);
    expect(payload.capex).toBe(250000);
    expect(payload.security_deposit).toBe(1350000);
    expect(payload.brokerage).toBe(120950);
    expect(payload.rent_start_date).toBe('2026-05-01');
  });

  it('does not log the unmapped-key canary for a commercial key', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    LAUNCH_COMMERCIAL_KEYS.forEach((k) => expect(fromV2Key(k)).toBe(k));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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

  it('clears the FLAT dine-in/delivery split once the rent is staggered', () => {
    // V2 renders the top-level split only for rent_type='fixed'; staggered edits
    // it per year. Switching fixed -> staggered would otherwise keep submitting
    // scalars the user can no longer see, and the final confirm writes them to
    // site.revshare_dinein_pct / _delivery_pct.
    const payload = buildLaunchRentPayload({
      rent_type: 'staggered',
      revshare_dinein_pct: 8,
      revshare_delivery_pct: 5,
      staggered_escalation: [{ year: 1, percent: 5, dine_in_pct: 9 }],
    });
    expect(payload.revshare_dinein_pct).toBeNull();
    expect(payload.revshare_delivery_pct).toBeNull();
    // ...and the PER-YEAR split is untouched — that is the one the user edits.
    expect(payload.staggered_escalation).toEqual([{ year: 1, percent: 5, dine_in_pct: 9 }]);
  });

  it('keeps the flat split on a fixed rent', () => {
    const payload = buildLaunchRentPayload({
      rent_type: 'fixed', revshare_dinein_pct: 8, revshare_delivery_pct: 5,
    });
    expect(payload.revshare_dinein_pct).toBe(8);
    expect(payload.revshare_delivery_pct).toBe(5);
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
