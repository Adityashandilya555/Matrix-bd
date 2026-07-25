// FEATURE_RENT_V2 — the service layer must preserve the per-year rev-share split
// and scope the flat split to fixed. This file previously had ZERO coverage,
// which is why the split was silently stripped here and still passed CI.
// skipcq: JS-0833
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { patchSiteStatusMock, patchSiteDetailsMock } = vi.hoisted(() => ({
  patchSiteStatusMock: vi.fn(),
  patchSiteDetailsMock: vi.fn(),
}));
vi.mock('./adapters/index.js', () => ({
  adapter: { patchSiteStatus: patchSiteStatusMock, patchSiteDetails: patchSiteDetailsMock },
}));

import { submitDetails, saveDraftDetails } from './siteService.js';

describe('siteService — rent-share split (FEATURE_RENT_V2)', () => {
  beforeEach(() => { patchSiteStatusMock.mockReset(); patchSiteDetailsMock.mockReset(); });

  it('submitDetails preserves the per-year split and drops the flat split on staggered', async () => {
    await submitDetails('s1', {
      rentType: 'staggered', rent: '150000',
      staggeredEscalation: [{ year: 1, percent: '5', dine_in_pct: 10, delivery_pct: 4 }],
      revshareDineinPct: '8', // must NOT leak onto a staggered site
    }, 'me');
    const details = patchSiteStatusMock.mock.calls[0][2].details;
    expect(details.staggeredEscalation[0]).toMatchObject({ year: 1, percent: 5, dine_in_pct: 10, delivery_pct: 4 });
    expect(details.revshareDineinPct).toBeUndefined();
  });

  it('submitDetails sends the flat split on the fixed path', async () => {
    await submitDetails('s1', {
      rentType: 'fixed', rent: '120000', escalation: '5',
      revshareDineinPct: '8', revshareDeliveryPct: '5',
    }, 'me');
    const details = patchSiteStatusMock.mock.calls[0][2].details;
    expect(details.revshareDineinPct).toBe(8);
    expect(details.revshareDeliveryPct).toBe(5);
  });

  it('saveDraftDetails preserves the per-year split keys', async () => {
    await saveDraftDetails('s1', {
      rentType: 'staggered', staggeredEscalation: [{ year: 1, percent: '5', dine_in_pct: 10 }],
    });
    const details = patchSiteDetailsMock.mock.calls[0][1];
    expect(details.staggeredEscalation[0]).toMatchObject({ year: 1, percent: 5, dine_in_pct: 10 });
  });
});
