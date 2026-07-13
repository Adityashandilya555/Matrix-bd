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

  it('does not render the state pane for plain-string options', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByPlaceholderText('Search state…')).toBeNull();
    // single, unnamed listbox in legacy mode
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
  });
});

const STRUCTURED = [
  { name: 'Bengaluru', state: 'Karnataka' },
  { name: 'Mysuru', state: 'Karnataka' },
  { name: 'Mumbai', state: 'Maharashtra' },
  { name: 'Pune', state: 'Maharashtra' },
  { name: 'Chennai', state: 'Tamil Nadu' },
];

describe('CitySelect — two-pane state → city picker', () => {
  it('shows a states pane and prompts to pick a state before listing cities', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={STRUCTURED} />);
    fireEvent.click(screen.getByRole('button'));

    const statesLb = screen.getByRole('listbox', { name: 'States' });
    expect(within(statesLb).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Karnataka', 'Maharashtra', 'Tamil Nadu']);

    // No cities until a state is chosen (or the user types).
    const citiesLb = screen.getByRole('listbox', { name: 'Cities' });
    expect(within(citiesLb).queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/Select a state/)).toBeTruthy();
  });

  it('lists a state’s cities after selecting it, and filters them by keystroke', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={STRUCTURED} />);
    fireEvent.click(screen.getByRole('button'));

    const statesLb = screen.getByRole('listbox', { name: 'States' });
    fireEvent.click(within(statesLb).getByRole('option', { name: 'Karnataka' }));

    const citiesLb = screen.getByRole('listbox', { name: 'Cities' });
    expect(within(citiesLb).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Bengaluru', 'Mysuru']);

    // type-to-filter within the chosen state
    fireEvent.change(screen.getByPlaceholderText('Search city…'), { target: { value: 'mys' } });
    const opts = within(citiesLb).getAllByRole('option');
    expect(opts).toHaveLength(1);
    expect(opts[0].textContent).toContain('Mysuru');
  });

  it('filters the states pane by keystroke', () => {
    render(<CitySelect value="" onChange={vi.fn()} options={STRUCTURED} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText('Search state…'), { target: { value: 'karn' } });

    const statesLb = screen.getByRole('listbox', { name: 'States' });
    const opts = within(statesLb).getAllByRole('option');
    expect(opts).toHaveLength(1);
    expect(opts[0].textContent).toContain('Karnataka');
  });

  it('lets you type a city directly to search across every state', () => {
    const onChange = vi.fn();
    render(<CitySelect value="" onChange={onChange} options={STRUCTURED} />);
    fireEvent.click(screen.getByRole('button'));
    // no state selected — global city search
    fireEvent.change(screen.getByPlaceholderText('Search city…'), { target: { value: 'pune' } });

    const citiesLb = screen.getByRole('listbox', { name: 'Cities' });
    const opt = within(citiesLb).getByRole('option', { name: /Pune/ });
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith('Pune');
  });

  it('emits the city name string (never an object) and closes on selection', () => {
    const onChange = vi.fn();
    render(<CitySelect value="" onChange={onChange} options={STRUCTURED} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'States' })).getByRole('option', { name: 'Maharashtra' }));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Cities' })).getByRole('option', { name: 'Pune' }));
    expect(onChange).toHaveBeenCalledWith('Pune');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
