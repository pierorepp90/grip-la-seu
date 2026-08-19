export function calculateLinePrice(precios, tipoCalzado, servicio, material, grosor, cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error('cantidad debe ser un entero >= 1');
  }
  const porTipo = precios[tipoCalzado];
  if (!porTipo) {
    throw new Error(`tipo de calzado desconocido: ${tipoCalzado}`);
  }
  const porServicio = porTipo[servicio];
  if (porServicio == null) {
    throw new Error(`servicio desconocido: ${servicio}`);
  }
  if (typeof porServicio === 'number') {
    return porServicio * cantidad;
  }
  const porMaterial = porServicio[material];
  if (!porMaterial) {
    throw new Error(`material desconocido: ${material}`);
  }
  const precioUnitario = porMaterial[grosor];
  if (typeof precioUnitario !== 'number') {
    throw new Error(`grosor desconocido: ${grosor}`);
  }
  return precioUnitario * cantidad;
}

export function minPrecioServicio(precios, servicio) {
  const valores = [];
  for (const tipo of Object.keys(precios)) {
    const porServicio = precios[tipo][servicio];
    if (typeof porServicio === 'number') {
      valores.push(porServicio);
    } else {
      for (const porMaterial of Object.values(porServicio)) {
        valores.push(...Object.values(porMaterial));
      }
    }
  }
  return Math.min(...valores);
}
