import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNominatimResponse, geocodeAddress } from '../js/geocode.js';

test('parseNominatimResponse toma el primer resultado como {lat, lon}', () => {
  const result = parseNominatimResponse([{ lat: '42.358', lon: '1.463' }]);
  assert.deepEqual(result, { lat: 42.358, lon: 1.463 });
});

test('parseNominatimResponse devuelve null si no hay resultados', () => {
  assert.equal(parseNominatimResponse([]), null);
  assert.equal(parseNominatimResponse(null), null);
});

test('geocodeAddress llama a Nominatim y devuelve coordenadas', async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/search/);
    assert.match(url, /q=Carrer%20Major/);
    return {
      ok: true,
      json: async () => [{ lat: '42.358', lon: '1.463' }],
    };
  };
  const result = await geocodeAddress('Carrer Major', fakeFetch);
  assert.deepEqual(result, { lat: 42.358, lon: 1.463 });
});

test('geocodeAddress devuelve null si la respuesta no es ok', async () => {
  const fakeFetch = async () => ({ ok: false });
  const result = await geocodeAddress('dirección inválida', fakeFetch);
  assert.equal(result, null);
});
