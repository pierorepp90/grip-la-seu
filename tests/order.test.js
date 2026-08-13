import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderId, buildOrderSummary } from '../js/order.js';

test('generateOrderId incluye fecha y es determinista con inyección de reloj/random', () => {
  const fixedDate = new Date('2026-08-13T12:00:00.000Z');
  const id = generateOrderId(fixedDate, () => 0.5);
  assert.match(id, /^GLS-20260813120000-[0-9A-Z]{4}$/);
});

test('generateOrderId produce ids distintos con random distinto', () => {
  const fixedDate = new Date('2026-08-13T12:00:00.000Z');
  const id1 = generateOrderId(fixedDate, () => 0.1);
  const id2 = generateOrderId(fixedDate, () => 0.9);
  assert.notEqual(id1, id2);
});

test('buildOrderSummary incluye todos los datos del pedido en las líneas', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0001',
    tipoCalzado: 'pie_de_gato',
    servicio: 'resolado_completo',
    cantidad: 2,
    precioTotal: 70,
    nombre: 'Ana Pérez',
    direccion: 'Carrer Major 1',
    telefono: '+34612345678',
    email: 'ana@example.com',
    entrega: { tipo: 'gls', nombre: 'Punt GLS Centre' },
    metodoPago: 'bizum',
  };
  const summary = buildOrderSummary(orderPayload);
  assert.equal(summary.orderId, 'GLS-TEST-0001');
  const joined = summary.lineas.join(' | ');
  assert.match(joined, /pie_de_gato/);
  assert.match(joined, /resolado_completo/);
  assert.match(joined, /70\.00€/);
  assert.match(joined, /Ana Pérez/);
  assert.match(joined, /Punt GLS Centre/);
  assert.match(joined, /bizum/);
});
