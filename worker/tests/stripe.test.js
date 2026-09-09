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
  lang: 'ca',
  metodoPago: 'tarjeta',
};

test('buildCheckoutSessionParams genera un line_item por línea del carrito más el envío', () => {
  const params = buildCheckoutSessionParams(orderPayload, 'https://griplaseu.es');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('customer_email'), 'ana@example.com');
  assert.equal(params.get('line_items[0][quantity]'), '2');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '3500');
  assert.equal(
    params.get('line_items[0][price_data][product_data][name]'),
    'Resolado completo · Pie de gato · Vibram XS Grip2',
  );
  assert.equal(params.get('line_items[1][quantity]'), '1');
  assert.equal(params.get('line_items[1][price_data][unit_amount]'), '500');
  assert.equal(params.get('line_items[1][price_data][product_data][name]'), 'Envío GLS');
  assert.equal(params.get('metadata[order_id]'), 'GLS-1');
  assert.equal(params.get('metadata[nombre]'), 'Ana Pérez');
  assert.equal(params.get('metadata[transporte]'), '5');
  assert.equal(params.get('metadata[calle]'), 'Carrer Major');
  assert.equal(params.get('metadata[numero]'), '12');
  assert.equal(params.get('metadata[cp]'), '25700');
  assert.equal(params.get('metadata[ciudad]'), "La Seu d'Urgell");
  assert.equal(params.get('metadata[pais]'), 'ES');
  assert.equal(params.get('metadata[lang]'), 'ca');
  assert.equal(params.get('metadata[direccion]'), null);
  assert.equal(params.get('metadata[entrega_tipo]'), null);
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
          description: 'Resolado completo · Pie de gato · Vibram XS Grip2',
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
  assert.equal(carrito[0].descripcion, 'Resolado completo · Pie de gato · Vibram XS Grip2');
  assert.equal(carrito[0].cantidad, 2);
  assert.equal(carrito[0].precioUnitario, 35);
  assert.equal(carrito[0].precioSubtotal, 70);
});

test('orderPayloadFromSession reconstruye el pedido con la dirección desglosada', () => {
  const session = {
    customer_email: 'ana@example.com',
    line_items: {
      data: [
        {
          description: 'Resolado completo · Pie de gato · Vibram XS Grip2',
          quantity: 2,
          amount_total: 7000,
          price: { unit_amount: 3500 },
        },
      ],
    },
    metadata: {
      order_id: 'GLS-1',
      nombre: 'Ana Pérez',
      telefono: '+34612345678',
      precio_total: '70',
      transporte: '0',
      calle: 'Carrer Major',
      numero: '12',
      cp: '25700',
      ciudad: "La Seu d'Urgell",
      pais: 'ES',
      lang: 'ca',
    },
  };
  const result = orderPayloadFromSession(session);
  assert.equal(result.orderId, 'GLS-1');
  assert.equal(result.carrito.length, 1);
  assert.equal(result.transporte, 0);
  assert.equal(result.precioTotal, 70);
  assert.equal(result.email, 'ana@example.com');
  assert.equal(result.lang, 'ca');
  assert.deepEqual(result.direccion, {
    calle: 'Carrer Major',
    numero: '12',
    codigoPostal: '25700',
    ciudad: "La Seu d'Urgell",
    pais: 'ES',
  });
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
  const fakeFetch = async () => ({ ok: false, status: 500, text: async () => '' });
  await assert.rejects(() => createStripeSession(new URLSearchParams(), 'sk_test_123', fakeFetch));
});

test('createStripeSession incluye el motivo que da Stripe, para poder diagnosticarlo', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    text: async () =>
      JSON.stringify({ error: { message: 'Invalid API Key provided: pk_test_***' } }),
  });
  await assert.rejects(
    () => createStripeSession(new URLSearchParams(), 'pk_test_123', fakeFetch),
    /HTTP 401.*Invalid API Key/,
  );
});

test('createStripeSession sobrevive a una respuesta de error que no sea JSON', async () => {
  const fakeFetch = async () => ({ ok: false, status: 502, text: async () => 'Bad gateway' });
  await assert.rejects(
    () => createStripeSession(new URLSearchParams(), 'sk_test_123', fakeFetch),
    /HTTP 502.*Bad gateway/,
  );
});

test('retrieveStripeSession pide la sesión con los line_items expandidos', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(
      url,
      'https://api.stripe.com/v1/checkout/sessions/sess_123?expand[]=line_items',
    );
    assert.equal(options.headers.Authorization, 'Bearer sk_test_123');
    return { ok: true, json: async () => ({ id: 'sess_123', payment_status: 'paid' }) };
  };
  const result = await retrieveStripeSession('sess_123', 'sk_test_123', fakeFetch);
  assert.equal(result.payment_status, 'paid');
});

test('buildCheckoutSessionParams nombra el producto sin identificadores internos', () => {
  // Este nombre lo lee el cliente en la página de pago de Stripe mientras teclea la tarjeta:
  // es el sitio donde un `resolado_completo (pie_de_gato)` hace más daño.
  const params = buildCheckoutSessionParams(
    {
      ...orderPayload,
      carrito: [
        { tipoCalzado: 'bota', servicio: 'puntera', material: null, cantidad: 1, precioUnitario: 15, precioSubtotal: 15 },
        { tipoCalzado: 'pie_de_gato', servicio: 'media_suela', material: 'vibram_xs_grip_edge', cantidad: 1, precioUnitario: 40, precioSubtotal: 40 },
      ],
    },
    'https://griplaseu.es',
  );
  assert.equal(params.get('line_items[0][price_data][product_data][name]'), 'Puntera · Bota');
  assert.equal(
    params.get('line_items[1][price_data][product_data][name]'),
    'Media suela · Pie de gato · Vibram XS Grip Edge',
  );
  for (const [clave, valor] of params.entries()) {
    if (clave.endsWith('[product_data][name]')) assert.doesNotMatch(valor, /_/);
  }
});
