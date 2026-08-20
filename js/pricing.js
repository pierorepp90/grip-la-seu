export function calculateLinePrice(precios, tipoCalzado, servicio, cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error('cantidad debe ser un entero >= 1');
  }
  const porTipo = precios[tipoCalzado];
  if (!porTipo) {
    throw new Error(`tipo de calzado desconocido: ${tipoCalzado}`);
  }
  const precioUnitario = porTipo[servicio];
  if (typeof precioUnitario !== 'number') {
    throw new Error(`servicio desconocido: ${servicio}`);
  }
  return precioUnitario * cantidad;
}

export function minPrecioServicio(precios, servicio) {
  const valores = Object.keys(precios)
    .map((tipo) => precios[tipo][servicio])
    .filter((precio) => typeof precio === 'number');
  return Math.min(...valores);
}
