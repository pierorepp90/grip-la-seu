const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export function parseNominatimResponse(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const [first] = results;
  const lat = Number.parseFloat(first.lat);
  const lon = Number.parseFloat(first.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon };
}

export async function geocodeAddress(direccion, fetchFn = fetch) {
  const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(direccion)}&limit=1`;
  const response = await fetchFn(url, {
    headers: { 'Accept-Language': 'ca,es,en' },
  });
  if (!response.ok) return null;
  const results = await response.json();
  return parseNominatimResponse(results);
}
