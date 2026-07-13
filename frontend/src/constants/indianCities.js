// Indian cities for the new-pipeline city selector. The data lives in the
// sibling `indianCities.json` as an array of `{ name, state }` records
// (alphabetically sorted by name, ~1,200+ cities/towns across 33 states/UTs)
// so the selector can group and filter by state.
//
// The backend does not constrain `city` (free text) — the selector emits only
// the chosen city name, so this is a UX convenience, not a validation source.
// Old/renamed spellings are canonicalised to their modern forms (e.g.
// Bangalore→Bengaluru, Gurgaon→Gurugram) so the list stays consistent with
// previously saved values. To extend the list as new markets open, edit
// `indianCities.json` directly — keep each entry `{ name, state }`, deduped and
// sorted by name.
import cities from './indianCities.json';

// Structured records: [{ name, state }]. Pass this to <CitySelect> to enable the
// state grouping + state filter.
export const INDIAN_CITIES_DATA = cities;

// Flat, sorted list of city names — kept for backward compatibility with any
// consumer that only needs strings.
export const INDIAN_CITIES = cities.map((c) => c.name);

// Distinct states/UTs present in the data, sorted case-insensitively.
export const INDIAN_STATES = [...new Set(cities.map((c) => c.state))].sort(
  (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
);

export default INDIAN_CITIES;
