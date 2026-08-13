import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistanceKm, findNearestPoints } from '../js/geo.js';

test('la distancia de un punto a sí mismo es 0', () => {
  assert.equal(haversineDistanceKm(42.358, 1.463, 42.358, 1.463), 0);
});

test('calcula una distancia aproximada correcta entre dos ciudades conocidas', () => {
  // La Seu d'Urgell (42.358, 1.463) a Barcelona (41.3874, 2.1686)
  const km = haversineDistanceKm(42.358, 1.463, 41.3874, 2.1686);
  assert.ok(km > 110 && km < 130, `esperaba ~120km, obtuvo ${km}`);
});

test('findNearestPoints ordena por distancia ascendente y respeta el límite', () => {
  const points = [
    { nombre: 'Lejano', lat: 41.3874, lon: 2.1686 },
    { nombre: 'Cercano', lat: 42.358, lon: 1.463 },
    { nombre: 'Medio', lat: 42.0, lon: 1.8 },
  ];
  const result = findNearestPoints(42.358, 1.463, points, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].nombre, 'Cercano');
  assert.equal(result[1].nombre, 'Medio');
  assert.ok(typeof result[0].distanceKm === 'number');
});
