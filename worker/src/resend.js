const FROM_ADDRESS = 'Grip La Seu <onboarding@resend.dev>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function entregaTexto(entrega) {
  return entrega.tipo === 'gls'
    ? `Punto GLS: ${entrega.nombre}`
    : `Tienda asociada: ${entrega.nombre}`;
}

function formatearLineaCarrito(linea) {
  const subtotal = linea.precioSubtotal.toFixed(2);
  if (linea.descripcion) {
    return `${escapeHtml(linea.descripcion)} ×${linea.cantidad} — ${subtotal}€`;
  }
  const variante = linea.material ? ` (${linea.material}, ${linea.grosor}mm)` : '';
  return `${linea.tipoCalzado} · ${linea.servicio}${variante} ×${linea.cantidad} — ${subtotal}€`;
}

function lineasCarritoHtml(orderPayload) {
  const lineas = orderPayload.carrito.map((linea) => `<li>${formatearLineaCarrito(linea)}</li>`);
  if (orderPayload.transporte > 0) {
    lineas.push(`<li>Envío GLS: ${orderPayload.transporte.toFixed(2)}€</li>`);
  }
  return lineas.join('\n');
}

export function buildOwnerEmail(orderPayload, ownerEmail) {
  const { orderId, precioTotal, nombre, direccion, telefono, email, entrega, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [ownerEmail],
    subject: `Nuevo pedido ${orderId}`,
    html: `
      <h2>Nuevo pedido ${orderId}</h2>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Nombre: ${escapeHtml(nombre)}</li>
        <li>Dirección: ${escapeHtml(direccion)}</li>
        <li>Teléfono: ${telefono}</li>
        <li>Email: ${escapeHtml(email)}</li>
        <li>Entrega: ${entregaTexto(entrega)}</li>
        <li>Pago: ${metodoPago}</li>
      </ul>
    `,
  };
}

export function buildCustomerEmail(orderPayload, customerEmailAddress) {
  const { orderId, precioTotal, entrega, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [customerEmailAddress],
    subject: `Hemos recibido tu pedido ${orderId} — Grip La Seu`,
    html: `
      <h2>¡Gracias por tu pedido!</h2>
      <p>Referencia: <strong>${orderId}</strong></p>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Entrega: ${entregaTexto(entrega)}</li>
        <li>Pago: ${metodoPago}</li>
      </ul>
      <p>Nos pondremos en contacto contigo si necesitamos algo más.</p>
    `,
  };
}

export async function sendEmail(payload, apiKey, fetchFn = fetch) {
  const response = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Resend rechazó el envío del email');
  }
  return response.json();
}
