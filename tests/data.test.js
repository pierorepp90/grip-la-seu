import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRECIOS, PRECIO_TRANSPORTE_GLS } from '../js/precios.js';
import { PUNTOS_GLS } from '../js/puntos-gls.js';
import { TIENDAS } from '../js/tiendas.js';
import { calculateLinePrice } from '../js/pricing.js';

const MATERIALES = ['vibram_xs_grip2', 'cocida'];
const GROSORES = ['3.5', '4', '4.5', '5'];

test('PRECIOS tiene todas las combinaciones de material y grosor para resolado_completo y media_suela', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    for (const servicio of ['resolado_completo', 'media_suela']) {
      for (const material of MATERIALES) {
        for (const grosor of GROSORES) {
          const precio = PRECIOS[tipo][servicio][material][grosor];
          assert.equal(typeof precio, 'number');
          assert.doesNotThrow(() =>
            calculateLinePrice(PRECIOS, tipo, servicio, material, grosor, 1),
          );
        }
      }
    }
  }
});

test('PRECIOS tiene tarifa plana numérica para puntera', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    assert.equal(typeof PRECIOS[tipo].puntera, 'number');
    assert.doesNotThrow(() => calculateLinePrice(PRECIOS, tipo, 'puntera', null, null, 1));
  }
});

test('PRECIO_TRANSPORTE_GLS es un número', () => {
  assert.equal(typeof PRECIO_TRANSPORTE_GLS, 'number');
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
