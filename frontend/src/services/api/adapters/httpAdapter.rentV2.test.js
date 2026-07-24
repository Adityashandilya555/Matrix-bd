// FEATURE_RENT_V2 — the revenue-share split (Dine-in % / Delivery %) must thread
// through both the outbound create payload and the inbound response shaping, and
// the per-year split keys must ride verbatim inside staggered_escalation.
// skipcq: JS-0833
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSite, siteFromServer } from './httpAdapter.js';

// Hoisted so the axios factory (hoisted by vi.mock) can capture the POST body.
const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    create: () => ({
      post: postMock,
      patch: vi.fn(),
      get: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));

describe('httpAdapter — revenue-share split (FEATURE_RENT_V2)', () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ data: { id: 'site_1' } });
  });

  it('createSite sends the flat dine-in/delivery split as snake_case', async () => {
    await createSite({
      name: 'X', city: 'Y', visitDate: '2026-07-23',
      rentType: 'fixed', expectedRent: 120000, expectedEscalationPct: 5, expectedEscalationYears: 3,
      revshareDineinPct: 8, revshareDeliveryPct: 5,
    });
    const body = postMock.mock.calls[0][1];
    expect(body.revshare_dinein_pct).toBe(8);
    expect(body.revshare_delivery_pct).toBe(5);
  });

  it('createSite carries per-year split keys inside staggered_escalation', async () => {
    await createSite({
      name: 'X', city: 'Y', visitDate: '2026-07-23', rentType: 'staggered', expectedRent: 150000,
      staggeredEscalation: [{ year: 1, percent: 5, dine_in_pct: 10, delivery_pct: 4 }],
    });
    const body = postMock.mock.calls[0][1];
    expect(body.staggered_escalation[0]).toMatchObject({ year: 1, percent: 5, dine_in_pct: 10, delivery_pct: 4 });
  });

  it('createSite defaults the split to null when the flag-off UI omits it', async () => {
    await createSite({ name: 'X', city: 'Y', visitDate: '2026-07-23', rentType: 'revshare', expectedRevsharePct: 12 });
    const body = postMock.mock.calls[0][1];
    expect(body.revshare_dinein_pct).toBeNull();
    expect(body.revshare_delivery_pct).toBeNull();
  });

  it('siteFromServer surfaces the split top-level and in the details blob', () => {
    const site = siteFromServer({
      id: 's1', revshare_dinein_pct: 8, revshare_delivery_pct: 5,
      // details_saved_at marks the row as having saved details, so the inbound
      // `details` blob is populated (that is what the Add Details form reads).
      details_saved_at: '2026-07-23T00:00:00Z',
      staggered_escalation: [{ year: 1, percent: 5, dine_in_pct: 10 }],
    });
    expect(site.revshareDineinPct).toBe(8);
    expect(site.revshareDeliveryPct).toBe(5);
    expect(site.details.revshareDineinPct).toBe(8);
    expect(site.details.revshareDeliveryPct).toBe(5);
    // Per-year superset keys ride through untouched for re-hydration.
    expect(site.staggeredEscalation[0].dine_in_pct).toBe(10);
  });

  it('siteFromServer keeps the split null on legacy rows that never set it', () => {
    const site = siteFromServer({ id: 's1' });
    expect(site.revshareDineinPct).toBeNull();
    expect(site.revshareDeliveryPct).toBeNull();
  });
});
