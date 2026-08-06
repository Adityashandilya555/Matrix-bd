import cities from './indianCities.json';

export const INDIAN_CITIES_DATA = cities;

export const INDIAN_CITIES = cities.map((c) => c.name);

export const INDIAN_STATES = [...new Set(cities.map((c) => c.state))].sort(
  (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
);

export default INDIAN_CITIES;
