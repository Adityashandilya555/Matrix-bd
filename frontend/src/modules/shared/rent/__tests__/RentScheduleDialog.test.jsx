// skipcq: JS-0833
// RentScheduleButton — the reusable "View schedule" trigger + read-only dialog
// that renders a staggered rent's per-year escalation as a table, with Dine-in /
// Delivery columns only when the schedule carries a rev-share split.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RentScheduleButton from '../RentScheduleDialog.jsx';

describe('RentScheduleButton', () => {
  it('renders nothing without a usable schedule', () => {
    const { container } = render(<RentScheduleButton schedule={[]} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<RentScheduleButton schedule={[{ year: 1, percent: '' }]} />);
    expect(c2.firstChild).toBeNull();
  });

  it('opens a per-year table on click; a plain staggered rent stays two-column', () => {
    render(<RentScheduleButton schedule={[{ year: 1, percent: 5 }, { year: 2, percent: 4 }]} baseRent={120000} />);
    fireEvent.click(screen.getByRole('button', { name: /view schedule/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Year 1')).toBeTruthy();
    expect(screen.getByText('Year 2')).toBeTruthy();
    expect(screen.getByText('5%')).toBeTruthy();
    // No split → no Dine-in / Delivery columns.
    expect(screen.queryByText('Dine-in')).toBeNull();
    expect(screen.queryByText('Delivery')).toBeNull();
  });

  it('shows Dine-in / Delivery columns when the schedule carries a split', () => {
    render(<RentScheduleButton schedule={[{ year: 1, percent: 5, dine_in_pct: 8, delivery_pct: 4 }]} />);
    fireEvent.click(screen.getByRole('button', { name: /view schedule/i }));
    expect(screen.getByText('Dine-in')).toBeTruthy();
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.getByText('8%')).toBeTruthy();
    expect(screen.getByText('4%')).toBeTruthy();
  });

  it('closes on Escape', () => {
    render(<RentScheduleButton schedule={[{ year: 1, percent: 5 }]} />);
    fireEvent.click(screen.getByRole('button', { name: /view schedule/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
