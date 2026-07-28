// skipcq: JS-0833
// The rent timeline stores each diff as a pre-stringified value. New events carry
// JSON; events recorded before the backend fix carry a Python repr, which
// JSON.parse rejects outright because of the single quotes. Both have to render,
// and neither may throw — the fallback is showing the raw string, which is
// exactly what the timeline did before.
import { describe, it, expect } from 'vitest';
import { parseEventValue, asScheduleRows } from '../RentTimeline.jsx';

const LEGACY = "[{'year': 1, 'percent': 12.0, 'dine_in_pct': 2.0, 'delivery_pct': 3.0}, {'year': 2, 'percent': 4.0}]";
const MODERN = '[{"year": 1, "percent": 12.0}, {"year": 2, "percent": 4.0}]';

describe('parseEventValue', () => {
  it('parses the JSON new events carry', () => {
    expect(parseEventValue(MODERN)).toEqual([{ year: 1, percent: 12.0 }, { year: 2, percent: 4.0 }]);
  });

  it('parses the Python repr already sitting in the database', () => {
    // This is the decision not to migrate an audit trail in place.
    expect(parseEventValue(LEGACY)).toEqual([
      { year: 1, percent: 12, dine_in_pct: 2, delivery_pct: 3 },
      { year: 2, percent: 4 },
    ]);
  });

  it('maps Python None to null', () => {
    expect(parseEventValue("[{'year': 1, 'percent': 5, 'mg': None}]")).toEqual([{ year: 1, percent: 5, mg: null }]);
  });

  it('passes an already-structured value straight through', () => {
    const rows = [{ year: 1, percent: 5 }];
    expect(parseEventValue(rows)).toBe(rows);
  });

  it.each([
    ['a plain scalar', '120000'],
    ['a label', 'staggered'],
    ['null', null],
    ['empty', ''],
    ['broken JSON', '[{"year": 1,'],
  ])('returns null for %s so the caller falls back to the raw string', (_label, input) => {
    expect(parseEventValue(input)).toBeNull();
  });

  it('does NOT quote-swap a string that merely failed JSON.parse', () => {
    // A blanket ' -> " rewrite would corrupt any value containing an apostrophe,
    // so the legacy path is gated on the string looking like a schedule row.
    expect(parseEventValue("[{'note': \"it's fine\"}]")).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    for (const v of [undefined, null, 0, NaN, '{', '[[[', {}, []]) {
      expect(() => parseEventValue(v)).not.toThrow();
    }
  });
});

describe('asScheduleRows', () => {
  it('accepts both formats', () => {
    expect(asScheduleRows(MODERN)).toHaveLength(2);
    expect(asScheduleRows(LEGACY)).toHaveLength(2);
  });

  it('rejects anything that is not a list of objects', () => {
    expect(asScheduleRows('[1, 2, 3]')).toBeNull();
    expect(asScheduleRows('[]')).toBeNull();
    expect(asScheduleRows('{"year": 1}')).toBeNull();
    expect(asScheduleRows('120000')).toBeNull();
  });
});
