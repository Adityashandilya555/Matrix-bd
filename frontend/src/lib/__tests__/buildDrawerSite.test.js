// buildDrawerSite feeds the supervisor's approval drawer — it must surface the
// revenue-share split (FEATURE_RENT_V2), or the feature captures data nobody reads.
// skipcq: JS-0833
import { describe, it, expect } from 'vitest';
import { buildDrawerSite } from '../buildDrawerSite.js';

describe('buildDrawerSite — revenue-share split', () => {
  it('surfaces the flat split from the top-level row', () => {
    const site = buildDrawerSite({ revshareDineinPct: 8, revshareDeliveryPct: 5 });
    expect(site.revshareDinein).toBe(8);
    expect(site.revshareDelivery).toBe(5);
  });

  it('falls back to the details blob', () => {
    const site = buildDrawerSite({ details: { revshareDineinPct: 7, revshareDeliveryPct: 3 } });
    expect(site.revshareDinein).toBe(7);
    expect(site.revshareDelivery).toBe(3);
  });

  it('is undefined when the split was never set (legacy rows)', () => {
    const site = buildDrawerSite({});
    expect(site.revshareDinein).toBeUndefined();
    expect(site.revshareDelivery).toBeUndefined();
  });
});
