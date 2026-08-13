export function generateOrderId(now = new Date(), randomFn = Math.random) {
  const datePart = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const randomPart = Math.floor(randomFn() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `GLS-${datePart}-${randomPart}`;
}

export function buildOrderSummary(orderPayload) {
  const {
    orderId,
    tipoCalzado,
    servicio,
    cantidad,
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

  return {
    orderId,
    lineas: [
      `Referencia: ${orderId}`,
      `Tipo de calzado: ${tipoCalzado}`,
      `Servicio: ${servicio}`,
      `Cantidad: ${cantidad}`,
      `Precio total: ${precioTotal.toFixed(2)}€`,
      `Nombre: ${nombre}`,
      `Dirección: ${direccion}`,
      `Teléfono: ${telefono}`,
      `Email: ${email}`,
      `Entrega: ${entregaTexto}`,
      `Pago: ${metodoPago}`,
    ],
  };
}
