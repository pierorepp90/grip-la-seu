const ENVIO_GLS_NOMBRE = 'Envío GLS';

export function buildCheckoutSessionParams(orderPayload, siteUrl) {
  const { orderId, carrito, transporte, nombre, direccion, telefono, email, entrega, precioTotal } =
    orderPayload;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('customer_email', email);
  params.set('success_url', `${siteUrl}/gracias.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${siteUrl}/?pago=cancelado`);

  carrito.forEach((linea, index) => {
    const variante = linea.material ? ` (${linea.material}, ${linea.grosor}mm)` : '';
    params.set(`line_items[${index}][quantity]`, String(linea.cantidad));
    params.set(`line_items[${index}][price_data][currency]`, 'eur');
    params.set(
      `line_items[${index}][price_data][unit_amount]`,
      String(Math.round(linea.precioUnitario * 100)),
    );
    params.set(
      `line_items[${index}][price_data][product_data][name]`,
      `${linea.servicio} (${linea.tipoCalzado})${variante}`,
    );
  });

  if (transporte > 0) {
    const index = carrito.length;
    params.set(`line_items[${index}][quantity]`, '1');
    params.set(`line_items[${index}][price_data][currency]`, 'eur');
    params.set(`line_items[${index}][price_data][unit_amount]`, String(Math.round(transporte * 100)));
    params.set(`line_items[${index}][price_data][product_data][name]`, ENVIO_GLS_NOMBRE);
  }

  params.set('metadata[order_id]', orderId);
  params.set('metadata[nombre]', nombre);
  params.set('metadata[direccion]', direccion);
  params.set('metadata[telefono]', telefono);
  params.set('metadata[precio_total]', String(precioTotal));
  params.set('metadata[transporte]', String(transporte));
  params.set('metadata[entrega_tipo]', entrega.tipo);
  params.set('metadata[entrega_nombre]', entrega.nombre);
  return params;
}

export function buildCarritoFromLineItems(session) {
  const items = (session.line_items && session.line_items.data) || [];
  return items
    .filter((item) => item.description !== ENVIO_GLS_NOMBRE)
    .map((item) => ({
      descripcion: item.description,
      cantidad: item.quantity,
      precioUnitario: item.price.unit_amount / 100,
      precioSubtotal: item.amount_total / 100,
    }));
}

export function orderPayloadFromSession(session) {
  const m = session.metadata || {};
  return {
    orderId: m.order_id,
    carrito: buildCarritoFromLineItems(session),
    transporte: Number(m.transporte || 0),
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
  const response = await fetchFn(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items&line_items[limit]=100`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}` },
    },
  );
  if (!response.ok) {
    throw new Error('No se pudo recuperar la sesión de Stripe');
  }
  return response.json();
}
