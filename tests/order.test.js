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

test('buildOrderSummary detalla cada línea del carrito con material, y el envío', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0001',
    carrito: [
      {
        tipoCalzado: 'pie_de_gato',
        servicio: 'resolado_completo',
        material: 'vibram_xs_grip2',
        cantidad: 2,
        precioUnitario: 35,
        precioSubtotal: 70,
      },
      {
        tipoCalzado: 'bota',
        servicio: 'puntera',
        material: null,
        cantidad: 1,
        precioUnitario: 15,
        precioSubtotal: 15,
      },
    ],
    transporte: 6,
    precioTotal: 91,
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
  assert.match(joined, /pie_de_gato · resolado_completo \(vibram_xs_grip2\) ×2 — 70\.00€/);
  assert.match(joined, /bota · puntera ×1 — 15\.00€/);
  assert.match(joined, /Envío GLS: 6\.00€/);
  assert.match(joined, /Total: 91\.00€/);
  assert.match(joined, /Ana Pérez/);
  assert.match(joined, /Punt GLS Centre/);
  assert.match(joined, /bizum/);
});

test('buildOrderSummary omite la línea de envío cuando el transporte es 0', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0002',
    carrito: [
      {
        tipoCalzado: 'bota',
        servicio: 'puntera',
        material: null,
        cantidad: 1,
        precioUnitario: 15,
        precioSubtotal: 15,
      },
    ],
    transporte: 0,
    precioTotal: 15,
    nombre: 'Ana Pérez',
    direccion: 'Carrer Major 1',
    telefono: '+34612345678',
    email: 'ana@example.com',
    entrega: { tipo: 'tienda', nombre: 'Tenda Centre' },
    metodoPago: 'efectivo',
  };
  const summary = buildOrderSummary(orderPayload);
  const joined = summary.lineas.join(' | ');
  assert.doesNotMatch(joined, /Envío GLS/);
  assert.match(joined, /Total: 15\.00€/);
});

test('buildOrderSummary usa la descripción reconstruida desde Stripe cuando no hay campos estructurados', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0003',
    carrito: [
      {
        descripcion: 'resolado_completo (pie_de_gato) (vibram_xs_grip2)',
        cantidad: 2,
        precioUnitario: 35,
        precioSubtotal: 70,
      },
    ],
    transporte: 0,
    precioTotal: 70,
    nombre: 'Ana Pérez',
    direccion: 'Carrer Major 1',
    telefono: '+34612345678',
    email: 'ana@example.com',
    entrega: { tipo: 'tienda', nombre: 'Tenda Centre' },
    metodoPago: 'tarjeta',
  };
  const summary = buildOrderSummary(orderPayload);
  const joined = summary.lineas.join(' | ');
  assert.match(joined, /resolado_completo \(pie_de_gato\) \(vibram_xs_grip2\) ×2 — 70\.00€/);
});
