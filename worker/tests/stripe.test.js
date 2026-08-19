import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutSessionParams,
  buildCarritoFromLineItems,
  orderPayloadFromSession,
  parseSessionPaymentStatus,
  createStripeSession,
  retrieveStripeSession,
} from '../src/stripe.js';

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
  metodoPago: 'tarjeta',
};

test('buildCheckoutSessionParams genera un line_item por línea del carrito más el envío', () => {
  const params = buildCheckoutSessionParams(orderPayload, 'https://pierorepp90.github.io/grip-la-seu');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('customer_email'), 'ana@example.com');
  assert.equal(params.get('line_items[0][quantity]'), '2');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '3500');
  assert.match(params.get('line_items[0][price_data][product_data][name]'), /resolado_completo/);
  assert.equal(params.get('line_items[1][quantity]'), '1');
  assert.equal(params.get('line_items[1][price_data][unit_amount]'), '600');
  assert.equal(params.get('line_items[1][price_data][product_data][name]'), 'Envío GLS');
  assert.equal(params.get('metadata[order_id]'), 'GLS-1');
  assert.equal(params.get('metadata[nombre]'), 'Ana Pérez');
  assert.equal(params.get('metadata[transporte]'), '6');
  assert.equal(params.get('metadata[entrega_tipo]'), 'gls');
  assert.match(params.get('success_url'), /gracias\.html\?session_id=\{CHECKOUT_SESSION_ID\}/);
});

test('buildCheckoutSessionParams no añade line_item de envío cuando el transporte es 0', () => {
  const params = buildCheckoutSessionParams({ ...orderPayload, transporte: 0 }, 'https://example.com');
  assert.equal(params.get('line_items[1][quantity]'), null);
});

test('buildCarritoFromLineItems reconstruye el carrito desde los line_items de Stripe, sin la línea de envío', () => {
  const session = {
    line_items: {
      data: [
        {
          description: 'resolado_completo (pie_de_gato) (vibram_xs_grip2, 4mm)',
          quantity: 2,
          amount_total: 7000,
          price: { unit_amount: 3500 },
        },
        {
          description: 'Envío GLS',
          quantity: 1,
          amount_total: 600,
          price: { unit_amount: 600 },
        },
      ],
    },
  };
  const carrito = buildCarritoFromLineItems(session);
  assert.equal(carrito.length, 1);
  assert.equal(carrito[0].descripcion, 'resolado_completo (pie_de_gato) (vibram_xs_grip2, 4mm)');
  assert.equal(carrito[0].cantidad, 2);
  assert.equal(carrito[0].precioUnitario, 35);
  assert.equal(carrito[0].precioSubtotal, 70);
});

test('orderPayloadFromSession reconstruye el pedido desde metadata y line_items', () => {
  const session = {
    customer_email: 'ana@example.com',
    line_items: {
      data: [
        {
          description: 'resolado_completo (pie_de_gato) (vibram_xs_grip2, 4mm)',
          quantity: 2,
          amount_total: 7000,
          price: { unit_amount: 3500 },
        },
      ],
    },
    metadata: {
      order_id: 'GLS-1',
      nombre: 'Ana Pérez',
      direccion: 'Carrer Major 1',
      telefono: '+34612345678',
      precio_total: '70',
      transporte: '0',
      entrega_tipo: 'gls',
      entrega_nombre: 'Punt GLS Centre',
    },
  };
  const result = orderPayloadFromSession(session);
  assert.equal(result.orderId, 'GLS-1');
  assert.equal(result.carrito.length, 1);
  assert.equal(result.transporte, 0);
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

test('retrieveStripeSession pide la sesión con los line_items expandidos', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions/sess_123?expand[]=line_items');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_123');
    return { ok: true, json: async () => ({ id: 'sess_123', payment_status: 'paid' }) };
  };
  const result = await retrieveStripeSession('sess_123', 'sk_test_123', fakeFetch);
  assert.equal(result.payment_status, 'paid');
});
