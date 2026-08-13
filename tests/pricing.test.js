import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice } from '../js/pricing.js';

const PRECIOS = {
  bota: { resolado_completo: 45, media_suela: 28, puntera: 15 },
  pie_de_gato: { resolado_completo: 35, media_suela: 20, puntera: 12 },
};

test('calcula el precio como precio unitario por cantidad', () => {
  assert.equal(calculatePrice(PRECIOS, 'pie_de_gato', 'resolado_completo', 2), 70);
});

test('lanza error si la cantidad no es un entero positivo', () => {
  assert.throws(() => calculatePrice(PRECIOS, 'bota', 'puntera', 0));
  assert.throws(() => calculatePrice(PRECIOS, 'bota', 'puntera', 1.5));
});

test('lanza error si el tipo de calzado es desconocido', () => {
  assert.throws(() => calculatePrice(PRECIOS, 'sandalia', 'puntera', 1));
});

test('lanza error si el servicio es desconocido', () => {
  assert.throws(() => calculatePrice(PRECIOS, 'bota', 'plantilla', 1));
});
