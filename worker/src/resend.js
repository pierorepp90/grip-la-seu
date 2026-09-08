const FROM_ADDRESS = 'Grip La Seu <pedidos@griplaseu.es>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function direccionHtml(direccion) {
  return [
    `<li>Dirección: ${escapeHtml(direccion.calle)} ${escapeHtml(direccion.numero)}</li>`,
    `<li>Código postal: ${escapeHtml(direccion.codigoPostal)}</li>`,
    `<li>Ciudad: ${escapeHtml(direccion.ciudad)}</li>`,
    `<li>País: ${escapeHtml(direccion.pais)}</li>`,
  ].join('\n');
}

function glsHtmlPropietario(gls) {
  if (gls && gls.ok) {
    return `<li>Devolución GLS: ${escapeHtml(gls.returnOrderId)}</li>`;
  }
  return `<li><strong>⚠️ No se pudo crear la devolución GLS automáticamente — el cliente ha recibido instrucciones manuales.</strong> Motivo: ${escapeHtml(gls?.error ?? 'desconocido')}</li>`;
}

function glsHtmlCliente(orderPayload, gls) {
  if (gls && gls.ok) {
    return `
      <p><strong>GLS te ha enviado</strong> un email aparte con tu etiqueta de envío y el código QR
      para dejar el paquete en tu punto GLS más cercano.</p>
      <p>Referencia de la devolución: <strong>${escapeHtml(gls.returnOrderId)}</strong></p>
    `;
  }
  const { orderId, nombre, email, direccion } = orderPayload;
  return `
    <h3>Crea tu etiqueta de envío</h3>
    <p>No hemos podido generar tu etiqueta automáticamente. Créala tú en el portal de GLS —tarda
    menos de un minuto— con estos datos:</p>
    <ul>
      <li>Número de pedido: <strong>${escapeHtml(orderId)}</strong></li>
      <li>Motivo de devolución: Sin motivo específico</li>
      <li>Nombre: ${escapeHtml(nombre)}</li>
      <li>Correo electrónico: ${escapeHtml(email)}</li>
      <li>Calle: ${escapeHtml(direccion.calle)}</li>
      <li>Número: ${escapeHtml(direccion.numero)}</li>
      <li>Código postal: ${escapeHtml(direccion.codigoPostal)}</li>
      <li>Ciudad: ${escapeHtml(direccion.ciudad)}</li>
      <li>País: ${escapeHtml(direccion.pais)}</li>
    </ul>
    <p><a href="${escapeHtml(gls?.portalUrl ?? '')}">Abrir el portal de GLS</a></p>
  `;
}

function formatearLineaCarrito(linea) {
  const subtotal = linea.precioSubtotal.toFixed(2);
  if (linea.descripcion) {
    return `${escapeHtml(linea.descripcion)} ×${linea.cantidad} — ${subtotal}€`;
  }
  const variante = linea.material ? ` (${escapeHtml(linea.material)})` : '';
  return `${escapeHtml(linea.tipoCalzado)} · ${escapeHtml(linea.servicio)}${variante} ×${linea.cantidad} — ${subtotal}€`;
}

function lineasCarritoHtml(orderPayload) {
  const lineas = orderPayload.carrito.map((linea) => `<li>${formatearLineaCarrito(linea)}</li>`);
  if (orderPayload.transporte > 0) {
    lineas.push(`<li>Envío GLS: ${orderPayload.transporte.toFixed(2)}€</li>`);
  }
  return lineas.join('\n');
}

export function buildOwnerEmail(orderPayload, ownerEmail, gls) {
  const { orderId, precioTotal, nombre, direccion, telefono, email, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [ownerEmail],
    subject: `Nuevo pedido ${orderId}`,
    html: `
      <h2>Nuevo pedido ${escapeHtml(orderId)}</h2>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Nombre: ${escapeHtml(nombre)}</li>
        ${direccionHtml(direccion)}
        <li>Teléfono: ${escapeHtml(telefono)}</li>
        <li>Email: ${escapeHtml(email)}</li>
        <li>Pago: ${escapeHtml(metodoPago)}</li>
        ${glsHtmlPropietario(gls)}
      </ul>
    `,
  };
}

export function buildCustomerEmail(orderPayload, customerEmailAddress, gls) {
  const { orderId, precioTotal, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [customerEmailAddress],
    subject: `Hemos recibido tu pedido ${orderId} — Grip La Seu`,
    html: `
      <h2>¡Gracias por tu pedido!</h2>
      <p>Referencia: <strong>${escapeHtml(orderId)}</strong></p>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Pago: ${escapeHtml(metodoPago)}</li>
      </ul>
      ${glsHtmlCliente(orderPayload, gls)}
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
