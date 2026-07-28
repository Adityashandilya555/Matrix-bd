// skipcq: JS-0833
// The rent-change timeline had no test coverage at all, which is how it shipped
// printing Python reprs: `Escalation schedule: [{'year': 1, 'percent': 12.0}]`.
// These lock the two things that made it unreadable — the raw string, and the
// fact that a real change (three years becoming two) was invisible inside it.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RentTimeline from '../RentTimeline.jsx';

const AT = '2026-07-27T16:58:00Z';

const event = (over = {}) => ({
  id: 'e1', action: 'edited', actor_name: 'Asha', actor_role: 'business_admin',
  created_at: AT, comment: null, changes: [], ...over,
});

const schedule = (rows) => JSON.stringify(rows);
const LEGACY_3 = "[{'year': 1, 'percent': 12.0, 'dine_in_pct': 2.0, 'delivery_pct': 3.0}, "
               + "{'year': 2, 'percent': 4.0, 'dine_in_pct': 5.0, 'delivery_pct': 6.0}, "
               + "{'year': 3, 'percent': 7.0, 'dine_in_pct': 8.0, 'delivery_pct': 4.0}]";

const scheduleChange = (from, to) => ({
  field: 'staggered_escalation', label: 'Escalation schedule', from, to,
});

describe('RentTimeline — the escalation schedule is a table, not a string', () => {
  it('renders a JSON schedule as a table', () => {
    render(<RentTimeline events={[event({
      changes: [scheduleChange(null, schedule([{ year: 1, percent: 12 }, { year: 2, percent: 4 }]))],
    })]} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Year 1')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('renders a LEGACY Python-repr schedule as the same table', () => {
    // Events already in the database keep the old format; they must still read
    // correctly without migrating an audit trail.
    render(<RentTimeline events={[event({ changes: [scheduleChange(null, LEGACY_3)] })]} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Year 3')).toBeInTheDocument();
  });

  it('never leaks the raw repr into the DOM', () => {
    const { container } = render(
      <RentTimeline events={[event({ changes: [scheduleChange(LEGACY_3, LEGACY_3)] })]} />,
    );
    expect(container.textContent).not.toContain("{'year'");
    expect(container.textContent).not.toContain('dine_in_pct');
  });

  it('marks the year that was removed — the change the old UI buried', () => {
    // The reported screenshot: a three-year schedule became two, invisible in a
    // wall of .0 noise.
    render(<RentTimeline events={[event({
      changes: [scheduleChange(LEGACY_3, schedule([{ year: 1, percent: 12 }, { year: 2, percent: 4 }]))],
    })]} />);
    expect(screen.getByText('removed')).toBeInTheDocument();
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('falls back to the literal string when a value cannot be parsed', () => {
    render(<RentTimeline events={[event({
      changes: [{ field: 'staggered_escalation', label: 'Escalation schedule', from: null, to: 'garbled' }],
    })]} />);
    expect(screen.getByText('garbled')).toBeInTheDocument();
  });
});

describe('RentTimeline — scalar diffs', () => {
  it('formats money as rupees rather than a bare number', () => {
    render(<RentTimeline events={[event({
      changes: [{ field: 'expected_rent', label: 'Rent / MG (₹)', from: '50000', to: '60000' }],
    })]} />);
    expect(screen.getByText('₹60,000')).toBeInTheDocument();
    expect(screen.queryByText('60000')).toBeNull();
  });

  it('labels a rent type instead of printing the token', () => {
    render(<RentTimeline events={[event({
      changes: [{ field: 'rent_type', label: 'Rent type', from: null, to: 'staggered' }],
    })]} />);
    expect(screen.getByText('Staggered')).toBeInTheDocument();
  });

  it('keeps the em dash for an unset before-value', () => {
    render(<RentTimeline events={[event({
      changes: [{ field: 'lock_in_months', label: 'Lock-in (months)', from: null, to: '36' }],
    })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('36')).toBeInTheDocument();
  });
});

describe('RentTimeline — chrome', () => {
  it('groups events under a day chip', () => {
    render(<RentTimeline events={[
      event({ id: 'a', created_at: '2026-07-27T10:00:00Z' }),
      event({ id: 'b', created_at: '2026-07-27T11:00:00Z' }),
      event({ id: 'c', created_at: '2026-07-28T11:00:00Z', action: 'approved' }),
    ]} />);
    // Two distinct days, three events.
    expect(screen.getByText('27 Jul 2026')).toBeInTheDocument();
    expect(screen.getByText('28 Jul 2026')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-dot')).toHaveLength(3);
  });

  it('names each action rather than printing the raw token', () => {
    render(<RentTimeline events={[
      event({ id: 'a', action: 'baseline', actor_name: null, actor_role: 'system' }),
      event({ id: 'b', action: 'sent_for_review' }),
    ]} />);
    expect(screen.getByText('Draft baseline')).toBeInTheDocument();
    expect(screen.getByText('Sent for review')).toBeInTheDocument();
    expect(screen.queryByText('sent_for_review')).toBeNull();
  });

  it('says System when there is no human actor', () => {
    render(<RentTimeline events={[event({ action: 'baseline', actor_name: null, actor_role: 'system' })]} />);
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('shows an EmptyState, not a bare grey line, when there is no history', () => {
    render(<RentTimeline events={[]} />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });
});
