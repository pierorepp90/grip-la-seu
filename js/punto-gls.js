// Formatea el punto de entrega que GLS asigna al crear la devolución.
//
// La forma del objeto está verificada contra una respuesta real de producción (2026-09-08),
// y está documentada en worker/src/gls.js. Todos los campos salvo `name` pueden faltar en
// otra respuesta, así que aquí nada se da por hecho: se degrada, no se rompe.

export function formatearDistancia(km) {
  if (typeof km !== 'number' || Number.isNaN(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function formatearPunto(punto) {
  if (!punto || !punto.name) return null;

  const direccion = punto.address ?? {};
  const localidad = [direccion.zipCode, direccion.city].filter(Boolean).join(' ');

  return {
    nombre: punto.name,
    direccion: [direccion.street, localidad].filter(Boolean).join(', '),
    distancia: formatearDistancia(punto.distance),
    telefono: punto.externalContactDetails?.phone ?? null,
    horarios: (punto.openingDays ?? []).map((dia) => ({
      weekday: dia.weekday,
      tramos: (dia.hours ?? [])
        .map((tramo) => `${tramo.openingTime}–${tramo.closingTime}`)
        .join(', '),
    })),
  };
}
