import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRECIOS } from '../js/precios.js';
import { PUNTOS_GLS } from '../js/puntos-gls.js';
import { TIENDAS } from '../js/tiendas.js';
import { calculatePrice } from '../js/pricing.js';

test('PRECIOS tiene tarifa numérica para cada tipo de calzado y servicio', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    for (const servicio of ['resolado_completo', 'media_suela', 'puntera']) {
      assert.equal(typeof PRECIOS[tipo][servicio], 'number');
      assert.ok(calculatePrice(PRECIOS, tipo, servicio, 1) > 0);
    }
  }
});

test('PUNTOS_GLS tiene al menos un punto con nombre y coordenadas numéricas', () => {
  assert.ok(PUNTOS_GLS.length >= 1);
  for (const punto of PUNTOS_GLS) {
    assert.equal(typeof punto.nombre, 'string');
    assert.equal(typeof punto.lat, 'number');
    assert.equal(typeof punto.lon, 'number');
  }
});

test('TIENDAS tiene al menos una tienda con nombre y dirección', () => {
  assert.ok(TIENDAS.length >= 1);
  for (const tienda of TIENDAS) {
    assert.equal(typeof tienda.nombre, 'string');
    assert.equal(typeof tienda.direccion, 'string');
  }
});
