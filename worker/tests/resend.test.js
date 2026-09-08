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
      cantidad: 2,
      precioUnitario: 35,
      precioSubtotal: 70,
    },
  ],
  transporte: 5,
  precioTotal: 75,
  nombre: 'Ana Pérez',
  direccion: {
    calle: 'Carrer Major',
    numero: '12',
    codigoPostal: '25700',
    ciudad: "La Seu d'Urgell",
    pais: 'ES',
  },
  telefono: '+34612345678',
  email: 'ana@example.com',
  metodoPago: 'bizum',
};

const glsOk = { ok: true, returnOrderId: 'RET-99', trackId: 'Z79MB8U2', dropOffLocation: null };
const glsFallo = {
  ok: false,
  error: 'HTTP 500',
  portalUrl: 'https://returns.gls-group.com/climberup/create-return',
};

test('buildOwnerEmail incluye el carrito, el envío y la dirección desglosada', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsOk);
  assert.deepEqual(email.to, ['owner@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Ana Pérez/);
  assert.match(email.html, /pie_de_gato · resolado_completo \(vibram_xs_grip2\) ×2 — 70\.00€/);
  assert.match(email.html, /Envío GLS: 5\.00€/);
  assert.match(email.html, /75\.00€/);
  assert.match(email.html, /Carrer Major 12/);
  assert.match(email.html, /25700/);
  assert.match(email.html, /La Seu d&#39;Urgell/);
});

test('buildOwnerEmail muestra la referencia de la devolución cuando GLS respondió', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsOk);
  assert.match(email.html, /Devolución GLS: Z79MB8U2/);
  assert.match(email.html, /id RET-99/);
  assert.doesNotMatch(email.html, /No se pudo crear/);
});

test('buildOwnerEmail avisa al propietario cuando GLS falló', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsFallo);
  assert.match(email.html, /No se pudo crear la devolución/);
  assert.match(email.html, /HTTP 500/);
});

test('buildOwnerEmail omite la línea de envío cuando el transporte es 0', () => {
  const email = buildOwnerEmail({ ...orderPayload, transporte: 0 }, 'owner@example.com', glsOk);
  assert.doesNotMatch(email.html, /Envío GLS/);
});

test('buildCustomerEmail en modo A remite a la etiqueta que envía GLS', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOk);
  assert.deepEqual(email.to, ['ana@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /pie_de_gato · resolado_completo/);
  assert.match(email.html, /Z79MB8U2/);
  assert.match(email.html, /GLS te ha enviado/);
  assert.doesNotMatch(email.html, /returns\.gls-group\.com/);
});

test('buildCustomerEmail en modo B da el enlace al portal y los datos a copiar', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsFallo);
  assert.match(email.html, /returns\.gls-group\.com\/climberup\/create-return/);
  assert.match(email.html, /GLS-1/);
  assert.match(email.html, /Carrer Major/);
  assert.match(email.html, /25700/);
  assert.doesNotMatch(email.html, /GLS te ha enviado/);
  assert.doesNotMatch(email.html, /HTTP 500/);
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
    direccion: { ...orderPayload.direccion, calle: '"><img src=x>' },
    email: 'test<script>@example.com',
  };
  const email = buildOwnerEmail(maliciousPayload, 'owner@example.com', glsOk);
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
  const email = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail escapa los campos estructurados del carrito (servicio/tipoCalzado/material)', () => {
  const payload = {
    ...orderPayload,
    carrito: [
      {
        tipoCalzado: '<script>alert(1)</script>',
        servicio: '<img src=x onerror=alert(1)>',
        material: '<b>x</b>',
        cantidad: 1,
        precioUnitario: 10,
        precioSubtotal: 10,
      },
    ],
  };
  const email = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!email.html.includes('<script>'));
  assert(!email.html.includes('<img'));
  assert(!email.html.includes('<b>x</b>'));
  assert(email.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail y buildCustomerEmail escapan orderId, teléfono, dirección y metodoPago', () => {
  const payload = {
    ...orderPayload,
    orderId: '<script>alert(1)</script>',
    telefono: '<img src=x onerror=alert(1)>',
    direccion: {
      calle: '<b>calle maliciosa</b>',
      numero: '"><i>1</i>',
      codigoPostal: '<u>25700</u>',
      ciudad: '<em>ciudad</em>',
      pais: 'ES',
    },
    metodoPago: '<i>bizum</i>',
  };
  const ownerEmail = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!ownerEmail.html.includes('<script>'));
  assert(!ownerEmail.html.includes('<img'));
  assert(!ownerEmail.html.includes('<b>calle maliciosa</b>'));
  assert(!ownerEmail.html.includes('<i>bizum</i>'));
  assert(ownerEmail.html.includes('&lt;script&gt;'));

  const customerEmail = buildCustomerEmail(payload, 'ana@example.com', glsFallo);
  assert(!customerEmail.html.includes('<script>'));
  assert(!customerEmail.html.includes('<b>calle maliciosa</b>'));
  assert(customerEmail.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail y buildCustomerEmail escapan el trackId, que viene de la API de GLS', () => {
  const glsMalicioso = {
    ok: true,
    returnOrderId: '<img src=x onerror=alert(1)>',
    trackId: '<script>alert(1)</script>',
    dropOffLocation: null,
  };
  const ownerEmail = buildOwnerEmail(orderPayload, 'owner@example.com', glsMalicioso);
  assert(!ownerEmail.html.includes('<script>'));
  assert(!ownerEmail.html.includes('<img'));
  assert(ownerEmail.html.includes('&lt;script&gt;'));

  const customerEmail = buildCustomerEmail(orderPayload, 'ana@example.com', glsMalicioso);
  assert(!customerEmail.html.includes('<script>'));
  assert(customerEmail.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail escapa el returnOrderId y el error que vienen de GLS', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', {
    ok: false,
    error: '<script>alert(1)</script>',
    portalUrl: 'https://returns.gls-group.com/climberup/create-return',
  });
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
});
