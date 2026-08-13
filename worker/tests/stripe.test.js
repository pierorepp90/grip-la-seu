import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutSessionParams,
  orderPayloadFromSessionMetadata,
  parseSessionPaymentStatus,
  createStripeSession,
  retrieveStripeSession,
} from '../src/stripe.js';

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
  metodoPago: 'tarjeta',
};

test('buildCheckoutSessionParams incluye importe en céntimos y metadata del pedido', () => {
  const params = buildCheckoutSessionParams(orderPayload, 'https://pierorepp90.github.io/grip-la-seu');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('customer_email'), 'ana@example.com');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '7000');
  assert.equal(params.get('metadata[order_id]'), 'GLS-1');
  assert.equal(params.get('metadata[nombre]'), 'Ana Pérez');
  assert.equal(params.get('metadata[entrega_tipo]'), 'gls');
  assert.match(params.get('success_url'), /gracias\.html\?session_id=\{CHECKOUT_SESSION_ID\}/);
});

test('orderPayloadFromSessionMetadata reconstruye el pedido desde la metadata de Stripe', () => {
  const session = {
    customer_email: 'ana@example.com',
    metadata: {
      order_id: 'GLS-1',
      tipo_calzado: 'pie_de_gato',
      servicio: 'resolado_completo',
      cantidad: '2',
      precio_total: '70',
      nombre: 'Ana Pérez',
      direccion: 'Carrer Major 1',
      telefono: '+34612345678',
      entrega_tipo: 'gls',
      entrega_nombre: 'Punt GLS Centre',
    },
  };
  const result = orderPayloadFromSessionMetadata(session);
  assert.equal(result.orderId, 'GLS-1');
  assert.equal(result.cantidad, 2);
  assert.equal(result.precioTotal, 70);
  assert.equal(result.entrega.nombre, 'Punt GLS Centre');
  assert.equal(result.metodoPago, 'tarjeta');
});

test('parseSessionPaymentStatus detecta pago completado', () => {
  assert.equal(parseSessionPaymentStatus({ payment_status: 'paid' }), true);
  assert.equal(parseSessionPaymentStatus({ payment_status: 'unpaid' }), false);
  assert.equal(parseSessionPaymentStatus(null), false);
});

test('createStripeSession hace POST autenticado y devuelve el JSON', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_123');
    return { ok: true, json: async () => ({ id: 'sess_123', url: 'https://checkout.stripe.com/xyz' }) };
  };
  const params = new URLSearchParams({ mode: 'payment' });
  const result = await createStripeSession(params, 'sk_test_123', fakeFetch);
  assert.equal(result.id, 'sess_123');
});

test('createStripeSession lanza error si Stripe responde con error', async () => {
  const fakeFetch = async () => ({ ok: false });
  await assert.rejects(() => createStripeSession(new URLSearchParams(), 'sk_test_123', fakeFetch));
});

test('retrieveStripeSession hace GET autenticado a la sesión correcta', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions/sess_123');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_123');
    return { ok: true, json: async () => ({ id: 'sess_123', payment_status: 'paid' }) };
  };
  const result = await retrieveStripeSession('sess_123', 'sk_test_123', fakeFetch);
  assert.equal(result.payment_status, 'paid');
});
