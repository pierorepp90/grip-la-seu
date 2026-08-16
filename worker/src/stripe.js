export function buildCheckoutSessionParams(orderPayload, siteUrl) {
  const {
    orderId,
    precioTotal,
    tipoCalzado,
    servicio,
    cantidad,
    nombre,
    direccion,
    telefono,
    email,
    entrega,
  } = orderPayload;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('customer_email', email);
  params.set('success_url', `${siteUrl}/gracias.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${siteUrl}/?pago=cancelado`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'eur');
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(precioTotal * 100)));
  params.set(
    'line_items[0][price_data][product_data][name]',
    `${servicio} x${cantidad} (${tipoCalzado})`,
  );
  params.set('metadata[order_id]', orderId);
  params.set('metadata[tipo_calzado]', tipoCalzado);
  params.set('metadata[servicio]', servicio);
  params.set('metadata[cantidad]', String(cantidad));
  params.set('metadata[precio_total]', String(precioTotal));
  params.set('metadata[nombre]', nombre);
  params.set('metadata[direccion]', direccion);
  params.set('metadata[telefono]', telefono);
  params.set('metadata[entrega_tipo]', entrega.tipo);
  params.set('metadata[entrega_nombre]', entrega.nombre);
  return params;
}

export function orderPayloadFromSessionMetadata(session) {
  const m = session.metadata || {};
  return {
    orderId: m.order_id,
    tipoCalzado: m.tipo_calzado,
    servicio: m.servicio,
    cantidad: Number(m.cantidad),
    precioTotal: Number(m.precio_total),
    nombre: m.nombre,
    direccion: m.direccion,
    telefono: m.telefono,
    email: session.customer_email,
    entrega: { tipo: m.entrega_tipo, nombre: m.entrega_nombre },
    metodoPago: 'tarjeta',
  };
}

export function parseSessionPaymentStatus(session) {
  return session != null && session.payment_status === 'paid';
}

export async function createStripeSession(params, secretKey, fetchFn = fetch) {
  const response = await fetchFn('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!response.ok) {
    throw new Error('Stripe rechazó la creación de la sesión');
  }
  return response.json();
}

export async function retrieveStripeSession(sessionId, secretKey, fetchFn = fetch) {
  const response = await fetchFn(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) {
    throw new Error('No se pudo recuperar la sesión de Stripe');
  }
  return response.json();
}
