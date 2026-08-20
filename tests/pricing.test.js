import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLinePrice, minPrecioServicio } from '../js/pricing.js';

const PRECIOS = {
  bota: {
    resolado_completo: 46,
    media_suela: 42,
    puntera: 15,
  },
  pie_de_gato: {
    resolado_completo: 44,
    media_suela: 40,
    puntera: 8,
  },
};

test('calcula el precio de un servicio por cantidad', () => {
  assert.equal(calculateLinePrice(PRECIOS, 'pie_de_gato', 'resolado_completo', 2), 88);
});

test('calcula el precio de puntera por cantidad', () => {
  assert.equal(calculateLinePrice(PRECIOS, 'bota', 'puntera', 3), 45);
});

test('lanza error si la cantidad no es un entero positivo', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'puntera', 0));
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'puntera', 1.5));
});

test('lanza error si el tipo de calzado es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'sandalia', 'puntera', 1));
});

test('lanza error si el servicio es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'plantilla', 1));
});

test('minPrecioServicio devuelve el mínimo entre bota y pie_de_gato', () => {
  assert.equal(minPrecioServicio(PRECIOS, 'resolado_completo'), 44);
});

test('minPrecioServicio funciona con precios planos', () => {
  assert.equal(minPrecioServicio(PRECIOS, 'puntera'), 8);
});
