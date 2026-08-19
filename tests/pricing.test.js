import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLinePrice, minPrecioServicio } from '../js/pricing.js';

const PRECIOS = {
  bota: {
    resolado_completo: {
      vibram_xs_grip2: { '3.5': 40, '4': 42, '4.5': 44, '5': 46 },
      cocida: { '3.5': 38, '4': 40, '4.5': 42, '5': 44 },
    },
    media_suela: {
      vibram_xs_grip2: { '3.5': 25, '4': 27, '4.5': 29, '5': 31 },
      cocida: { '3.5': 23, '4': 25, '4.5': 27, '5': 29 },
    },
    puntera: 15,
  },
  pie_de_gato: {
    resolado_completo: {
      vibram_xs_grip2: { '3.5': 30, '4': 32, '4.5': 34, '5': 36 },
      cocida: { '3.5': 28, '4': 30, '4.5': 32, '5': 34 },
    },
    media_suela: {
      vibram_xs_grip2: { '3.5': 18, '4': 20, '4.5': 22, '5': 24 },
      cocida: { '3.5': 16, '4': 18, '4.5': 20, '5': 22 },
    },
    puntera: 12,
  },
};

test('calcula el precio de un servicio con material y grosor, por cantidad', () => {
  assert.equal(
    calculateLinePrice(PRECIOS, 'pie_de_gato', 'resolado_completo', 'vibram_xs_grip2', '4', 2),
    64,
  );
});

test('calcula el precio de puntera como precio plano, sin material ni grosor', () => {
  assert.equal(calculateLinePrice(PRECIOS, 'bota', 'puntera', null, null, 3), 45);
});

test('lanza error si la cantidad no es un entero positivo', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'puntera', null, null, 0));
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'puntera', null, null, 1.5));
});

test('lanza error si el tipo de calzado es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'sandalia', 'puntera', null, null, 1));
});

test('lanza error si el servicio es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'plantilla', null, null, 1));
});

test('lanza error si el material es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'resolado_completo', 'goma', '4', 1));
});

test('lanza error si el grosor es desconocido', () => {
  assert.throws(() =>
    calculateLinePrice(PRECIOS, 'bota', 'resolado_completo', 'vibram_xs_grip2', '6', 1),
  );
});

test('minPrecioServicio devuelve el mínimo entre todas las combinaciones de tipo/material/grosor', () => {
  assert.equal(minPrecioServicio(PRECIOS, 'resolado_completo'), 28);
});

test('minPrecioServicio funciona también con un servicio de precio plano', () => {
  assert.equal(minPrecioServicio(PRECIOS, 'puntera'), 12);
});
