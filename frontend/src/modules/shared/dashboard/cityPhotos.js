// skipcq: JS-0833
// Photos behind the City spotlight, per city: a landmark, a café or coffee
// scene, and a street. Files and credits: public/dashboard/cities/CREDITS.md
// (Unsplash License). No coffee-chain storefronts or logos. A city without its
// own photos falls back to the bundled café photos.
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

export function cityPhotos(name) {
  const own = CITY_PHOTOS[String(name || '').trim().toLowerCase()];
  return own?.length ? own : CAFE;
}
