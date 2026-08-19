import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerEmail, buildCustomerEmail, sendEmail } from '../src/resend.js';

const orderPayload = {
  orderId: 'GLS-1',
  carrito: [
    {
      tipoCalzado: 'pie_de_gato',
      servicio: 'resolado_completo',
      material: 'vibram_xs_grip2',
      grosor: '4',
      cantidad: 2,
      precioUnitario: 35,
      precioSubtotal: 70,
    },
  ],
  transporte: 6,
  precioTotal: 76,
  nombre: 'Ana Pérez',
  direccion: 'Carrer Major 1',
  telefono: '+34612345678',
  email: 'ana@example.com',
  entrega: { tipo: 'gls', nombre: 'Punt GLS Centre' },
  metodoPago: 'bizum',
};

test('buildOwnerEmail va dirigido al propietario e incluye el carrito y el envío', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com');
  assert.deepEqual(email.to, ['owner@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Ana Pérez/);
  assert.match(email.html, /pie_de_gato · resolado_completo \(vibram_xs_grip2, 4mm\) ×2 — 70\.00€/);
  assert.match(email.html, /Envío GLS: 6\.00€/);
  assert.match(email.html, /76\.00€/);
  assert.match(email.html, /Punt GLS Centre/);
});

test('buildCustomerEmail va dirigido al comprador y confirma la recepción', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com');
  assert.deepEqual(email.to, ['ana@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /pie_de_gato · resolado_completo/);
  assert.match(email.html, /Punt GLS Centre/);
});

test('buildOwnerEmail omite la línea de envío cuando el transporte es 0', () => {
  const email = buildOwnerEmail({ ...orderPayload, transporte: 0 }, 'owner@example.com');
  assert.doesNotMatch(email.html, /Envío GLS/);
});

test('sendEmail hace POST autenticado a Resend', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization, 'Bearer re_test_123');
    assert.equal(JSON.parse(options.body).subject, 'asunto');
    return { ok: true, json: async () => ({ id: 'email_1' }) };
  };
  const result = await sendEmail({ subject: 'asunto' }, 're_test_123', fakeFetch);
  assert.equal(result.id, 'email_1');
});

test('sendEmail lanza error si Resend responde con error', async () => {
  const fakeFetch = async () => ({ ok: false });
  await assert.rejects(() => sendEmail({}, 're_test_123', fakeFetch));
});

test('buildOwnerEmail escapa caracteres HTML en campos de usuario', () => {
  const maliciousPayload = {
    ...orderPayload,
    nombre: '<script>alert(1)</script>',
    direccion: '"><img src=x>',
    email: 'test<script>@example.com',
  };
  const email = buildOwnerEmail(maliciousPayload, 'owner@example.com');
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
  assert(!email.html.includes('<img'));
  assert(email.html.includes('&lt;img'));
  assert(email.html.includes('&quot;&gt;&lt;img'));
});

test('buildOwnerEmail escapa la descripción reconstruida desde Stripe', () => {
  const payload = {
    ...orderPayload,
    carrito: [
      { descripcion: '<script>alert(1)</script>', cantidad: 1, precioUnitario: 10, precioSubtotal: 10 },
    ],
  };
  const email = buildOwnerEmail(payload, 'owner@example.com');
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail escapa los campos estructurados del carrito (servicio/tipoCalzado/material/grosor)', () => {
  const payload = {
    ...orderPayload,
    carrito: [
      {
        tipoCalzado: '<script>alert(1)</script>',
        servicio: '<img src=x onerror=alert(1)>',
        material: '<b>x</b>',
        grosor: '<i>y</i>',
        cantidad: 1,
        precioUnitario: 10,
        precioSubtotal: 10,
      },
    ],
  };
  const email = buildOwnerEmail(payload, 'owner@example.com');
  assert(!email.html.includes('<script>'));
  assert(!email.html.includes('<img'));
  assert(!email.html.includes('<b>x</b>'));
  assert(!email.html.includes('<i>y</i>'));
  assert(email.html.includes('&lt;script&gt;'));
});
