// Pin extraction for Google Maps inputs.
// Accepts raw "lat, lng", a full Google Maps URL, or a maps.app.goo.gl short URL.
// Short URLs are best-effort: browsers often block the CORS preflight, in which
// case we surface a hint and keep the original string in the field.

const COORD_RE = /(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/;

function pickCoordsFromString(s) {
  if (!s) return null;
  // !3d!4d is the actual place pin; @lat,lng is the map viewport center
  // and can sit several hundred metres off the pin. Prefer the place pin.
  let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return `${m[1]}, ${m[2]}`;
  m = s.match(/[?&](?:q|ll|query|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/);
  if (m) return `${m[1]}, ${m[2]}`;
  m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return `${m[1]}, ${m[2]}`;
  m = s.match(COORD_RE);
  if (m) return `${m[1]}, ${m[2]}`;
  return null;
}

export function looksLikeMapsUrl(s) {
  if (!s) return false;
  return /maps\.app\.goo\.gl\//.test(s)
      || /goo\.gl\/maps\//.test(s)
      || /google\.[^/]+\/maps/.test(s);
}

async function resolveViaEdge(rawUrl) {
  const base = import.meta.env?.VITE_SUPABASE_URL;
  const anon = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  if (!base || !anon) {
    const missing = [];
    if (!base) missing.push('VITE_SUPABASE_URL');
    if (!anon) missing.push('VITE_SUPABASE_ANON_KEY');
    return { coords: null, error: `Missing env variables for maps resolver: ${missing.join(', ')}` };
  }
  const endpoint = `${base.replace(/\/$/, '')}/functions/v1/resolve-maps-url?url=${encodeURIComponent(rawUrl)}`;
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: anon ? { apikey: anon } : {},
  });
  if (!res.ok) {
    return { coords: null, error: `Resolver responded ${res.status}` };
  }
  return res.json();
}

export async function extractGoogleMapsCoords(input) {
  if (!input) return { coords: null };
  const raw = input.trim();

  const direct = pickCoordsFromString(raw);
  if (direct) return { coords: direct, resolvedUrl: raw };

  if (!looksLikeMapsUrl(raw)) return { coords: null };

  try {
    return await resolveViaEdge(raw);
  } catch (e) {
    return { coords: null, error: `Could not reach the resolver: ${e.message || e}` };
  }
}
