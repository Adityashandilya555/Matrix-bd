// skipcq: JS-0833
// Date rendering in the launch timeline.
//
// Regression for a real bug: `new Date('2026-05-01')` parses a bare YYYY-MM-DD as
// UTC MIDNIGHT, and toLocaleDateString then prints it in the viewer's local zone.
// Anyone west of UTC read a contractual date one day early — 2026-05-01 showed as
// 30/4/2026 in New York. IST is east of UTC so it looked fine in dev.
//
// TZ is forced west of UTC before anything imports, and the first test asserts the
// environment really is skewed, so this file cannot quietly stop testing anything.
process.env.TZ = 'America/New_York';

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RentTimeline from '../RentTimeline.jsx';

const event = (changes) => ([{
  id: 'e1', actor_name: 'Admin', actor_role: 'business_admin',
  stage: 'admin_review', action: 'edited', changes,
  created_at: '2026-09-10T10:00:00Z',
}]);

describe('RentTimeline — date fields', () => {
  it('the test environment is genuinely west of UTC (guards the guard)', () => {
    // If this ever fails the timezone stub stopped working and the assertions
    // below would pass for the wrong reason.
    expect(new Date('2026-05-01').toLocaleDateString('en-IN')).toBe('30/4/2026');
  });

  it('renders rent_start_date as the day written, not shifted a day back', () => {
    render(<RentTimeline events={event([
      { field: 'rent_start_date', label: 'Rent start date', from: null, to: '"2026-05-01"' },
    ])} />);
    expect(screen.getByText('1/5/2026')).toBeTruthy();
    expect(screen.queryByText('30/4/2026')).toBeNull();
  });

  it('renders escalation_date the same way', () => {
    render(<RentTimeline events={event([
      { field: 'escalation_date', label: 'Escalation date', from: '"2027-01-01"', to: '"2028-01-01"' },
    ])} />);
    expect(screen.getByText('1/1/2027')).toBeTruthy();
    expect(screen.getByText('1/1/2028')).toBeTruthy();
  });

  it('falls back to the raw string when the value is not a date', () => {
    render(<RentTimeline events={event([
      { field: 'rent_start_date', label: 'Rent start date', from: null, to: 'not-a-date' },
    ])} />);
    expect(screen.getByText('not-a-date')).toBeTruthy();
  });

  it('renders a null date as an em dash', () => {
    render(<RentTimeline events={event([
      { field: 'rent_start_date', label: 'Rent start date', from: null, to: '"2026-05-01"' },
    ])} />);
    // `from` is null → the before side shows the placeholder, not "Invalid Date".
    expect(screen.getByText('—')).toBeTruthy();
  });
});
