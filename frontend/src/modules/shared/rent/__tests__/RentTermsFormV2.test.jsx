// RentTermsFormV2 — the configurable rent-type block (FEATURE_RENT_V2). Reframes
// rent entry as "Is the rent staggered?" (No -> fixed, Yes -> staggered) plus an
// optional REV SHARE dine-in/delivery split. Emits the canonical snake_case keys.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RentTermsFormV2 from '../RentTermsFormV2.jsx';

describe('RentTermsFormV2', () => {
  it('asks "Is the rent staggered?" and maps No -> fixed', () => {
    const onChange = vi.fn();
    render(<RentTermsFormV2 value={{}} onChange={onChange} />);
    expect(screen.getByText('Is the rent staggered?')).toBeTruthy();
    fireEvent.click(screen.getByText('No — flat rent'));
    expect(onChange).toHaveBeenCalledWith('rent_type', 'fixed');
  });

  it('maps Yes -> staggered and seeds the first year', () => {
    const onChange = vi.fn();
    render(<RentTermsFormV2 value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByText('Yes — staggered'));
    expect(onChange).toHaveBeenCalledWith('rent_type', 'staggered');
    expect(onChange).toHaveBeenCalledWith('staggered_escalation', [{ year: 1, percent: '' }]);
  });

  it('REV SHARE toggle reveals the flat split and emits dine-in %', () => {
    const onChange = vi.fn();
    render(<RentTermsFormV2 value={{ rent_type: 'fixed', expected_rent: 120000 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText('e.g. 8'), { target: { value: '9' } });
    expect(onChange).toHaveBeenCalledWith('revshare_dinein_pct', 9);
  });

  it('clears the split when REV SHARE is toggled back off', () => {
    const onChange = vi.fn();
    // Pre-seeded split => the switch starts on; one click turns it off.
    render(<RentTermsFormV2 value={{ rent_type: 'fixed', revshare_dinein_pct: 9, revshare_delivery_pct: 4 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith('revshare_dinein_pct', null);
    expect(onChange).toHaveBeenCalledWith('revshare_delivery_pct', null);
  });

  it('hides the escalation cadence when showCadence is false (Add Details)', () => {
    render(<RentTermsFormV2 value={{ rent_type: 'fixed' }} onChange={vi.fn()} showCadence={false} />);
    expect(screen.queryByText('Escalation cadence')).toBeNull();
  });

  it('emits a numeric base-rent edit on the staggered path', () => {
    const onChange = vi.fn();
    render(<RentTermsFormV2 value={{ rent_type: 'staggered', expected_rent: 150000, staggered_escalation: [{ year: 1, percent: '' }] }} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('150000'), { target: { value: '160000' } });
    expect(onChange).toHaveBeenCalledWith('expected_rent', 160000);
  });
});
