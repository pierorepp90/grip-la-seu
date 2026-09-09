const ENVIO_GLS_NOMBRE = 'Envío GLS';

export function buildCheckoutSessionParams(orderPayload, siteUrl) {
  const { orderId, carrito, transporte, nombre, direccion, telefono, email, lang, precioTotal } =
    orderPayload;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('customer_email', email);
  params.set('success_url', `${siteUrl}/gracias.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${siteUrl}/?pago=cancelado`);

  carrito.forEach((linea, index) => {
    const variante = linea.material ? ` (${linea.material})` : '';
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
  params.set('metadata[telefono]', telefono);
  params.set('metadata[precio_total]', String(precioTotal));
  params.set('metadata[transporte]', String(transporte));
  params.set('metadata[calle]', direccion.calle);
  params.set('metadata[numero]', direccion.numero);
  params.set('metadata[cp]', direccion.codigoPostal);
  params.set('metadata[ciudad]', direccion.ciudad);
  params.set('metadata[pais]', direccion.pais);
  params.set('metadata[lang]', lang);
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
    telefono: m.telefono,
    email: session.customer_email,
    direccion: {
      calle: m.calle,
      numero: m.numero,
      codigoPostal: m.cp,
      ciudad: m.ciudad,
      pais: m.pais,
    },
    lang: m.lang,
    metodoPago: 'tarjeta',
  };
}

export function parseSessionPaymentStatus(session) {
  return session != null && session.payment_status === 'paid';
}

// Sin el motivo de Stripe, cualquier fallo es indiagnosticable desde fuera: el cliente solo ve
// "algo ha fallado" y no hay forma de saber si es la clave, el importe o el payload. El mensaje
// de Stripe describe la peticion, no expone nada de la cuenta.
async function errorDeStripe(response, prefijo) {
  const detalle = await response.text().catch(() => '');
  let motivo = detalle.slice(0, 300);
  try {
    motivo = JSON.parse(detalle).error?.message ?? motivo;
  } catch {
    // Stripe no siempre responde JSON (p.ej. un 502 del borde); nos quedamos con el texto.
  }
  return new Error(`${prefijo} (HTTP ${response.status}): ${motivo}`);
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
    throw await errorDeStripe(response, 'Stripe rechazó la creación de la sesión');
  }
  return response.json();
}

export async function retrieveStripeSession(sessionId, secretKey, fetchFn = fetch) {
  const response = await fetchFn(
    // Solo expand[]=line_items. El endpoint de recuperacion NO acepta line_items[limit] y
    // responde 400 "Received unknown parameter: line_items", asi que el pago con tarjeta
    // fallaba siempre al volver de Stripe. El expand devuelve hasta 10 lineas, de sobra para
    // un carrito de este catalogo (3 servicios x 2 tipos de calzado + envio).
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}` },
    },
  );
  if (!response.ok) {
    throw await errorDeStripe(response, 'No se pudo recuperar la sesión de Stripe');
  }
  return response.json();
}
