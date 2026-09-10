// skipcq: JS-0833
// CommercialTermsForm — the six commercial terms the launch loop renegotiates.
//
// The behaviour worth locking is the SPLIT between `readOnly` and
// `rentStartEditable`: at under_exec_review the site creator may set the rent
// start date and nothing else, so a single readOnly flag would either lock them
// out of the date or hand them the five money fields they must not touch.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommercialTermsForm from '../CommercialTermsForm.jsx';

const VALUE = {
  carpet_area_sqft: 1200, cam_charges: 0, capex: 0,
  security_deposit: 1350000, brokerage: 120950, rent_start_date: '2026-05-01',
};

const boxes = () => Array.from(document.querySelectorAll('input[type="number"]'));
const dateBox = () => document.querySelector('input[type="date"]');

describe('CommercialTermsForm', () => {
  it('renders all six fields with their staged values', () => {
    render(<CommercialTermsForm value={VALUE} onChange={() => {}} />);
    for (const label of ['Carpet area', 'CAM', 'Capex', 'Security deposit', 'Brokerage', 'Rent start date']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(boxes()).toHaveLength(5);
    expect(dateBox().value).toBe('2026-05-01');
  });

  it('emits the canonical snake_case key on change', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CommercialTermsForm value={{}} onChange={onChange} />);
    await user.type(boxes()[0], '1400');
    // The key must match LAUNCH_COMMERCIAL_KEYS exactly — the backend's
    // extra="forbid" 422s anything else.
    expect(onChange).toHaveBeenCalledWith('carpet_area_sqft', expect.any(Number));
  });

  it('editable by default: nothing is read-only', () => {
    render(<CommercialTermsForm value={VALUE} onChange={() => {}} />);
    expect(boxes().every((b) => !b.readOnly)).toBe(true);
    expect(dateBox().disabled).toBe(false);
  });

  it('readOnly locks every field, including the date', () => {
    render(<CommercialTermsForm value={VALUE} onChange={() => {}} readOnly />);
    expect(boxes().every((b) => b.readOnly)).toBe(true);
    expect(dateBox().disabled).toBe(true);
  });

  it('readOnly + rentStartEditable is the executive: date open, money locked', () => {
    render(<CommercialTermsForm value={VALUE} onChange={() => {}} readOnly rentStartEditable />);
    expect(boxes().every((b) => b.readOnly)).toBe(true);
    expect(dateBox().disabled).toBe(false);
  });

  it('does not crash on an empty value object', () => {
    render(<CommercialTermsForm value={{}} onChange={() => {}} />);
    expect(boxes()).toHaveLength(5);
    expect(dateBox().value).toBe('');
  });
});
