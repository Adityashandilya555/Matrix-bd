// CitySelect — contained, searchable dropdown that replaced the native <select>
// in the new-pipeline modal (a native select with 100+ options spilled across
// the page). These lock the behaviour: closed by default, opens a filterable
// scroll-contained list, and emits the chosen city.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import CitySelect from '../CitySelect.jsx';

const OPTIONS = ['Mumbai', 'Bengaluru', 'New Delhi', 'Hyderabad', 'Pune'];

describe('CitySelect', () => {
  it('shows the placeholder and no options until opened', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByText('Select city…')).toBeTruthy();
    // listbox is not rendered while closed
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('opens a contained, scrollable list and emits the picked city', () => {
    const onChange = vi.fn();
    render(<CitySelect value="" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('button'));

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(OPTIONS.length);

    // The scroll area is height-capped so the menu can't spill across the page.
    const scroll = listbox.querySelector('[style*="max-height"]');
    expect(scroll).toBeTruthy();
    expect(scroll.style.overflowY).toBe('auto');

    fireEvent.click(screen.getByText('Hyderabad'));
    expect(onChange).toHaveBeenCalledWith('Hyderabad');
    // closes after selection
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters the list by the search query (case-insensitive)', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText('Search city…'), { target: { value: 'del' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('New Delhi');
  });

  it('shows an empty-state when nothing matches', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText('Search city…'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText(/No cities match/)).toBeTruthy();
  });

  it('clears the search filter on close so it does not reopen stale', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={OPTIONS} />);
    // open, type a non-matching query, then close without selecting (Escape)
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText('Search city…'), { target: { value: 'zzz' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    // reopen → full list is back, search box is empty (not the stale empty-state)
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
    expect(screen.getByPlaceholderText('Search city…').value).toBe('');
  });
});
