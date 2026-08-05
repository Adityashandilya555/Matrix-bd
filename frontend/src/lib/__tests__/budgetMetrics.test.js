import { describe, it, expect } from 'vitest';
import {
  CIVIL_MEP_IDX,
  FITOUT_FURNITURE_IDX,
  computeBudgetTotal,
  computeDerivedMetrics,
  formatRatio,
  sumByIdx,
} from '../budgetMetrics.js';

// Budget J.P. Nagar — area 1275 sqft, 39 covers, total ₹1,06,14,822.
const AREA = 1275;
const COVERS = 39;
const ITEMS = [
  { idx: 1, label: 'Professional Fees', amount: 59000 },
  { idx: 2, label: 'HVAC', amount: 388515 },
  { idx: 3, label: 'Furniture, Light & Planters', amount: 784405 },
  { idx: 4, label: 'Civil & Interiors', amount: 2966686 },
  { idx: 5, label: 'Kitchen Equipment', amount: 3388781 },
  { idx: 6, label: 'Branding', amount: 634835 },
  { idx: 7, label: 'Crockery & Small Equipments', amount: 48106 },
  { idx: 8, label: 'Utilities', amount: 371534 },
  { idx: 9, label: 'Licencing', amount: 202960 },
  { idx: 10, label: 'BD Cost', amount: 1770000 },
  { idx: 11, label: 'Misc', amount: 0 },
];

describe('budgetMetrics — index sets', () => {
  it('CIVIL_MEP_IDX is fitout only: HVAC + Civil & Interiors', () => {
    expect(CIVIL_MEP_IDX).toEqual([2, 4]);
  });

  it('FITOUT_FURNITURE_IDX adds Furniture, Light & Planters', () => {
    expect(FITOUT_FURNITURE_IDX).toEqual([2, 3, 4]);
  });
});

describe('budgetMetrics — J.P. Nagar sheet values', () => {
  it('totals ₹1,06,14,822 across the 11 line items', () => {
    expect(computeBudgetTotal(ITEMS)).toBe(10614822);
  });

  it('Per sqft fitout = ₹2,632', () => {
    const sum = sumByIdx(ITEMS, CIVIL_MEP_IDX);
    expect(sum).toBe(3355201); // 388515 + 2966686
    expect(formatRatio(sum, AREA)).toBe('₹2,632');
  });

  it('Per sqft fitout + Furniture/Light = ₹3,247', () => {
    const sum = sumByIdx(ITEMS, FITOUT_FURNITURE_IDX);
    expect(sum).toBe(4139606); // + 784405
    expect(formatRatio(sum, AREA)).toBe('₹3,247');
  });

  it('Per sft cost = ₹8,325 and per cover = ₹2,72,175', () => {
    const total = computeBudgetTotal(ITEMS);
    expect(formatRatio(total, AREA)).toBe('₹8,325');
    expect(formatRatio(total, COVERS)).toBe('₹2,72,175');
  });

  it('does not fold Kitchen Equipment or Utilities into fitout', () => {
    // The exact shape of the old bug: [2,3,4,5,8] gave ₹6,196.
    expect(formatRatio(sumByIdx(ITEMS, [2, 3, 4, 5, 8]), AREA)).toBe('₹6,196');
    expect(formatRatio(sumByIdx(ITEMS, CIVIL_MEP_IDX), AREA)).not.toBe('₹6,196');
  });
});

describe('budgetMetrics — computeDerivedMetrics stays in lockstep', () => {
  it('reports the same four sheet values as the inlined call sites', () => {
    const m = computeDerivedMetrics({
      items: ITEMS, totalIndoorAreaSqft: AREA, totalAreaSqft: AREA, covers: COVERS,
    });
    expect(m.budgetTotal).toBe(10614822);
    expect(m.civilMepPerSqft).toBe('₹2,632');
    expect(m.fitoutFurniturePerSqft).toBe('₹3,247');
    expect(m.capexPerSqft).toBe('₹8,325');
    expect(m.capexPerCover).toBe('₹2,72,175');
  });

  it('exposes raw ratios for the Financial Closure GFC-vs-actual diff', () => {
    const m = computeDerivedMetrics({
      items: ITEMS, totalIndoorAreaSqft: AREA, totalAreaSqft: AREA, covers: COVERS,
    });
    expect(m.civilMepPerSqftRaw).toBeCloseTo(3355201 / AREA, 6);
    expect(m.fitoutFurniturePerSqftRaw).toBeCloseTo(4139606 / AREA, 6);
  });
});

describe('budgetMetrics — missing divisors never render Infinity/NaN', () => {
  it.each([[0], [null], [undefined], ['']])('formatRatio(x, %p) is "—"', (divisor) => {
    expect(formatRatio(3355201, divisor)).toBe('—');
  });

  it('an empty budget is ₹0, not a crash', () => {
    expect(computeBudgetTotal([])).toBe(0);
    expect(sumByIdx([], CIVIL_MEP_IDX)).toBe(0);
    expect(sumByIdx(null, FITOUT_FURNITURE_IDX)).toBe(0);
  });
});
