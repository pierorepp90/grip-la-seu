export function generateOrderId(now = new Date(), randomFn = Math.random) {
  const datePart = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const randomPart = Math.floor(randomFn() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `GLS-${datePart}-${randomPart}`;
}

function formatearLineaCarrito(linea) {
  const subtotal = linea.precioSubtotal.toFixed(2);
  if (linea.descripcion) {
    return `${linea.descripcion} ×${linea.cantidad} — ${subtotal}€`;
  }
  const variante = linea.material ? ` (${linea.material}, ${linea.grosor}mm)` : '';
  return `${linea.tipoCalzado} · ${linea.servicio}${variante} ×${linea.cantidad} — ${subtotal}€`;
}

export function buildOrderSummary(orderPayload) {
  const {
    orderId,
    carrito,
    transporte,
    precioTotal,
    nombre,
    direccion,
    telefono,
    email,
    entrega,
    metodoPago,
  } = orderPayload;

  const entregaTexto =
    entrega.tipo === 'gls'
      ? `Punto GLS: ${entrega.nombre}`
      : `Tienda asociada: ${entrega.nombre}`;

  const lineas = [`Referencia: ${orderId}`, ...carrito.map(formatearLineaCarrito)];
  if (transporte > 0) {
    lineas.push(`Envío GLS: ${transporte.toFixed(2)}€`);
  }
  lineas.push(
    `Total: ${precioTotal.toFixed(2)}€`,
    `Nombre: ${nombre}`,
    `Dirección: ${direccion}`,
    `Teléfono: ${telefono}`,
    `Email: ${email}`,
    `Entrega: ${entregaTexto}`,
    `Pago: ${metodoPago}`,
  );

  return { orderId, lineas };
}
