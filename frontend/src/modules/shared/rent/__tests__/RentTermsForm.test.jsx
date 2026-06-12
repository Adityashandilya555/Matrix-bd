// RentTermsForm — the shared rent block used by the launch validation loop
// (admin + supervisor edit, executive read-only). Mirrors the BD pipeline popup.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RentTermsForm, { ZM_TOKENS, AC_TOKENS } from '../RentTermsForm.jsx';

describe('RentTermsForm', () => {
  it('renders the three rent types and emits a selection', () => {
    const onChange = vi.fn();
    render(<RentTermsForm value={{}} onChange={onChange} />);
    expect(screen.getByText('Revenue share')).toBeTruthy();
    expect(screen.getByText('Fixed + escalation')).toBeTruthy();
    expect(screen.getByText('MG + Revenue share')).toBeTruthy();
    fireEvent.click(screen.getByText('Fixed + escalation'));
    expect(onChange).toHaveBeenCalledWith('rent_type', 'fixed');
  });

  it('reveals fixed-rent fields and emits a numeric edit', () => {
    const onChange = vi.fn();
    render(<RentTermsForm value={{ rent_type: 'fixed', expected_rent: 100000 }} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('100000'), { target: { value: '125000' } });
    expect(onChange).toHaveBeenCalledWith('expected_rent', 125000);
  });

  it('reveals revenue-share field for revshare type', () => {
    const onChange = vi.fn();
    render(<RentTermsForm value={{ rent_type: 'revshare', rev_share_pct: 12 }} onChange={onChange} />);
    expect(screen.getByDisplayValue('12')).toBeTruthy();
  });

  it('readOnly disables the rent-type buttons (executive view)', () => {
    const onChange = vi.fn();
    render(<RentTermsForm value={{ rent_type: 'fixed', expected_rent: 100000 }} onChange={onChange} readOnly />);
    const btn = screen.getByText('Fixed + escalation').closest('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('always shows lock-in and tenure (rent-related per spec)', () => {
    render(<RentTermsForm value={{ rent_type: 'revshare' }} onChange={() => {}} />);
    expect(screen.getByText('Lock-in')).toBeTruthy();
    expect(screen.getByText('Tenure')).toBeTruthy();
    expect(screen.getByText('Rent-free days')).toBeTruthy();
  });

  it('exposes distinct ZM and AC token maps for both surfaces', () => {
    expect(ZM_TOKENS.accent).toContain('zm');
    expect(AC_TOKENS.accent).toContain('ac');
  });
});
