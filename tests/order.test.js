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

const direccion = {
  calle: 'Carrer Major',
  numero: '12',
  codigoPostal: '25700',
  ciudad: "La Seu d'Urgell",
  pais: 'ES',
};

test('buildOrderSummary detalla el carrito, el envío y la dirección desglosada', () => {
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
    transporte: 5,
    precioTotal: 90,
    nombre: 'Ana Pérez',
    direccion,
    telefono: '+34612345678',
    email: 'ana@example.com',
    metodoPago: 'bizum',
  };
  const summary = buildOrderSummary(orderPayload);
  assert.equal(summary.orderId, 'GLS-TEST-0001');
  const joined = summary.lineas.join(' | ');
  assert.match(joined, /pie_de_gato · resolado_completo \(vibram_xs_grip2\) ×2 — 70\.00€/);
  assert.match(joined, /bota · puntera ×1 — 15\.00€/);
  assert.match(joined, /Envío GLS: 5\.00€/);
  assert.match(joined, /Total: 90\.00€/);
  assert.match(joined, /Ana Pérez/);
  assert.match(joined, /Dirección: Carrer Major 12/);
  assert.match(joined, /Código postal: 25700/);
  assert.match(joined, /Ciudad: La Seu d'Urgell/);
  assert.match(joined, /País: ES/);
  assert.match(joined, /bizum/);
});

test('buildOrderSummary omite la línea de envío cuando el transporte es 0', () => {
  const summary = buildOrderSummary({
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
    direccion,
    telefono: '+34612345678',
    email: 'ana@example.com',
    metodoPago: 'tarjeta',
  });
  const joined = summary.lineas.join(' | ');
  assert.doesNotMatch(joined, /Envío GLS/);
  assert.match(joined, /Total: 15\.00€/);
});

test('buildOrderSummary añade la referencia de la devolución GLS cuando existe', () => {
  const base = {
    orderId: 'GLS-TEST-0003',
    carrito: [],
    transporte: 0,
    precioTotal: 0,
    nombre: 'Ana Pérez',
    direccion,
    telefono: '+34612345678',
    email: 'ana@example.com',
    metodoPago: 'bizum',
  };
  const conGls = buildOrderSummary({
    ...base,
    gls: { ok: true, returnOrderId: 'RET-99', trackId: 'Z79MB8U2' },
  });
  assert.match(conGls.lineas.join(' | '), /Devolución GLS: Z79MB8U2/);

  const sinGls = buildOrderSummary({ ...base, gls: { ok: false, error: 'timeout' } });
  assert.doesNotMatch(sinGls.lineas.join(' | '), /Devolución GLS/);

  const ausente = buildOrderSummary(base);
  assert.doesNotMatch(ausente.lineas.join(' | '), /Devolución GLS/);
});

test('buildOrderSummary usa la descripción reconstruida desde Stripe cuando no hay campos estructurados', () => {
  const summary = buildOrderSummary({
    orderId: 'GLS-TEST-0004',
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
    direccion,
    telefono: '+34612345678',
    email: 'ana@example.com',
    metodoPago: 'tarjeta',
  });
  assert.match(
    summary.lineas.join(' | '),
    /resolado_completo \(pie_de_gato\) \(vibram_xs_grip2\) ×2 — 70\.00€/,
  );
});
