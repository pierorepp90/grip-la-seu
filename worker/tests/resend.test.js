import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerEmail, buildCustomerEmail, sendEmail } from '../src/resend.js';

const orderPayload = {
  orderId: 'GLS-1',
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

test('buildOwnerEmail va dirigido al propietario e incluye todos los datos', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com');
  assert.deepEqual(email.to, ['owner@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Ana Pérez/);
  assert.match(email.html, /70\.00€/);
  assert.match(email.html, /Punt GLS Centre/);
});

test('buildCustomerEmail va dirigido al comprador y confirma la recepción', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com');
  assert.deepEqual(email.to, ['ana@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Punt GLS Centre/);
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
  // Verify that HTML special characters are escaped, preventing XSS
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
  assert(!email.html.includes('<img'));
  assert(email.html.includes('&lt;img'));
  assert(email.html.includes('&quot;&gt;&lt;img'));
});
