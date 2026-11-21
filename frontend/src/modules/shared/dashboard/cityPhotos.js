// skipcq: JS-0833
// Photos behind the City spotlight, per city. Files live in
// public/dashboard/cities/ (see CREDITS.md there); a city without its own
// photos falls back to the bundled café photos.
const CAFE = [
  { src: '/dashboard/cafe-plants.jpg', alt: 'A bright café interior with plants and tables' },
  { src: '/dashboard/latte-art.jpg', alt: 'A barista pouring latte art' },
  { src: '/dashboard/beans.jpg', alt: 'Roasted coffee beans' },
  { src: '/dashboard/beans-cup.jpg', alt: 'Roasted coffee beans in a white cup' },
];

export const CITY_PHOTOS = {};

export function cityPhotos(name) {
  const own = CITY_PHOTOS[String(name || '').toLowerCase()];
  return own?.length ? own : CAFE;
}
