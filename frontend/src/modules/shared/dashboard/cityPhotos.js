// skipcq: JS-0833
// Photos behind the City spotlight, per city: a landmark, a café or coffee
// scene, and a street. Files and credits: public/dashboard/cities/CREDITS.md
// (Unsplash License). No coffee-chain storefronts or logos. A city without its
// own photos falls back to the bundled café photos.
import { INDIAN_CITIES_DATA } from '../../../constants/indianCities.js';
import { PLACE_CAFE, PLACE_CITY, PLACE_STATE } from './placePhotos.js';

const P = (file, alt, credit) => ({ src: `/dashboard/cities/${file}.webp`, alt, credit });

const CAFE = [
  { src: '/dashboard/cafe-plants.jpg', alt: 'A bright café interior with plants and tables' },
  { src: '/dashboard/latte-art.jpg', alt: 'A barista pouring latte art' },
  { src: '/dashboard/beans.jpg', alt: 'Roasted coffee beans' },
];

export const CITY_PHOTOS = {
  bengaluru: [
    P('bengaluru-landmark', 'Vidhana Soudha, Bengaluru', 'Jayanth Muppaneni'),
    P('bengaluru-cafe', 'A café interior on Church Street, Bengaluru', 'Praveen Gupta'),
    P('bengaluru-street', 'A busy Bengaluru street with scooters and autos', 'Fabio Sasso'),
  ],
  mumbai: [
    P('mumbai-landmark', 'The Gateway of India seen from the sea', "Renzo D'souza"),
    P('mumbai-cafe', 'A barista tamping espresso in Mumbai', 'Zoshua Colah'),
    P('mumbai-street', 'The BMC building on a rainy Mumbai street', 'Satyajeet Mazumdar'),
  ],
  pune: [
    P('pune-landmark', 'Shaniwar Wada gateway, Pune', 'Vikram Pataskar'),
    P('pune-cafe', 'A warm café interior in Pune', 'Hrushi Chavhan'),
    P('pune-street', 'MG Road, Pune', 'onkar gotale'),
  ],
  hyderabad: [
    P('hyderabad-landmark', 'Charminar under a blue sky', 'Swipe'),
    { ...CAFE[1] },
    P('hyderabad-street', 'The market street at Charminar', 'Mr Cool Hitman'),
  ],
  gurugram: [
    P('gurugram-skyline', 'Gurugram skyline at sunset', 'Sooraj Dev'),
    P('gurugram-cafe', 'A café interior on Golf Course Road, Gurugram', 'Mustafa Fatemi'),
    P('gurugram-street', 'A Gurugram road beside office towers', 'Abhishek Tanwar'),
  ],
  chennai: [
    P('chennai-landmark', 'Chennai Central station clock tower', 'Appu Gopi'),
    P('chennai-coffee', 'Coffee and a cookie in Chennai', 'Pixel Town'),
    P('chennai-street', 'A busy shopping street in Chennai', 'David De Gendt'),
  ],
  kolkata: [
    P('kolkata-landmark', 'Victoria Memorial at dusk', 'Martin Jernberg'),
    P('kolkata-cafe', 'People at café tables in Kolkata', 'Aniket Ganguly'),
    P('kolkata-tram', 'A yellow tram on a Kolkata street', 'Alan'),
  ],
};

// Other spellings people type for the same city.
const ALIAS = {
  bangalore: 'bengaluru', gurgaon: 'gurugram', bombay: 'mumbai', calcutta: 'kolkata', madras: 'chennai',
  mysore: 'mysuru', mangalore: 'mangaluru', trivandrum: 'thiruvananthapuram', vizag: 'visakhapatnam',
  cochin: 'kochi', ernakulam: 'kochi', panjim: 'panaji', goa: 'panaji', baroda: 'vadodara', 'new delhi': 'new-delhi',
  poona: 'pune', 'navi mumbai': 'mumbai', thane: 'mumbai', secunderabad: 'hyderabad', 'greater noida': 'noida',
};

const slug = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let stateByCity;
function stateOf(key) {
  if (!stateByCity) {
    stateByCity = new Map(INDIAN_CITIES_DATA.map((c) => [slug(c.name), slug(c.state)]));
    // Cities that sit in a union territory of the same name.
    stateByCity.set('new-delhi', 'delhi');
  }
  return stateByCity.get(key);
}

// Two café photos, picked by the city's name so neighbouring cities differ.
function cafePair(key) {
  const all = [...PLACE_CAFE, ...CAFE];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return [all[h % all.length], all[(h + 3) % all.length]];
}

// The slideshow for a city: its own set when it has one; otherwise its
// landmark (if any), its state's photo, and café photos to make three.
export function cityPhotos(name) {
  const raw = String(name || '').trim().toLowerCase();
  const key = slug(ALIAS[raw] || raw);
  const own = CITY_PHOTOS[key];
  if (own?.length) return own;
  const landmark = PLACE_CITY[key];
  const statePhoto = PLACE_STATE[stateOf(key)];
  const list = [landmark, statePhoto].filter(Boolean);
  for (const c of cafePair(key || 'x')) if (list.length < 3 && !list.includes(c)) list.push(c);
  return list.length ? list : CAFE;
}
