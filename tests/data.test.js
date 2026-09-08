import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRECIOS, PRECIO_TRANSPORTE_GLS, ENVIO_GRATIS_DESDE } from '../js/precios.js';
import { calculateLinePrice } from '../js/pricing.js';

test('PRECIOS tiene tarifa plana numérica para cada tipo de calzado y servicio', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    for (const servicio of ['resolado_completo', 'media_suela', 'puntera']) {
      assert.equal(typeof PRECIOS[tipo][servicio], 'number');
      assert.doesNotThrow(() => calculateLinePrice(PRECIOS, tipo, servicio, 1));
    }
  }
});

test('PRECIO_TRANSPORTE_GLS y ENVIO_GRATIS_DESDE son números', () => {
  assert.equal(typeof PRECIO_TRANSPORTE_GLS, 'number');
  assert.equal(typeof ENVIO_GRATIS_DESDE, 'number');
});
