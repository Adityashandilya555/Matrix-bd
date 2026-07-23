// RentTermsForm — the shared rent block used by the launch validation loop
// (admin + supervisor edit, executive read-only). Mirrors the BD pipeline popup.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // ── Token integrity ──────────────────────────────────────────────────────
  // The replaced assertion here was `expect(AC_TOKENS.accent).toContain('ac')`,
  // which is vacuous: "accent" contains "ac", so it passed happily while every
  // --ac-* variable it pointed at had been deleted from the codebase. The whole
  // admin panel rendered borderless for exactly that reason. These two tests
  // are what would have caught it.

  it('both token maps expose the same keys', () => {
    expect(Object.keys(AC_TOKENS).sort()).toEqual(Object.keys(ZM_TOKENS).sort());
  });

  it('every custom property both maps reference is actually declared', () => {
    // A var() pointing at an undeclared property is invalid at computed-value
    // time: it resolves to `unset`, so `border: 1px solid var(--gone)` silently
    // becomes border-style:none. Nothing throws and nothing logs — the UI just
    // loses its chrome. Assert against the real stylesheet.
    const cssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../public/colors_and_type.css');
    const css = readFileSync(cssPath, 'utf8');
    const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

    const referenced = new Set();
    for (const map of [ZM_TOKENS, AC_TOKENS]) {
      for (const value of Object.values(map)) {
        for (const m of String(value).matchAll(/var\(\s*(--[\w-]+)/g)) referenced.add(m[1]);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);   // guard against a silent no-op

    const missing = [...referenced].filter((name) => !declared.has(name));
    expect(missing, `undeclared custom properties: ${missing.join(', ')}`).toEqual([]);
  });

  // ── Radiogroup accessibility ────────────────────────────────────────────
  // role="radio" without arrow keys is worse than plain buttons: it promises a
  // keyboard model it doesn't deliver. These lock the full pattern.

  it('exposes the rent types as a labelled radiogroup', () => {
    render(<RentTermsForm value={{ rent_type: 'revshare' }} onChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'Rent type' });
    expect(group).toBeTruthy();
    // Anchored — /Revenue share/ alone also matches "MG + Revenue share".
    expect(screen.getByRole('radio', { name: /^Revenue share/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /^Fixed \+ escalation/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('moves the selection with arrow keys, and wraps', () => {
    const onChange = vi.fn();
    render(<RentTermsForm value={{ rent_type: 'revshare' }} onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Rent type' });

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('rent_type', 'fixed');

    onChange.mockClear();
    fireEvent.keyDown(group, { key: 'ArrowLeft' });   // from revshare (index 0)
    expect(onChange).toHaveBeenCalledWith('rent_type', 'staggered');
  });

  it('keeps the group to a single tab stop (roving tabindex)', () => {
    render(<RentTermsForm value={{ rent_type: 'fixed' }} onChange={() => {}} />);
    const tabbable = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('ignores arrow keys in readOnly mode', () => {
    const onChange = vi.fn();
    render(<RentTermsForm value={{ rent_type: 'revshare' }} onChange={onChange} readOnly />);
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Rent type' }), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
