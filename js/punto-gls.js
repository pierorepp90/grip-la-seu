// Formatea el punto de entrega que GLS asigna al crear la devolución.
//
// La forma del objeto está verificada contra una respuesta real de producción (2026-09-08),
// y está documentada en worker/src/gls.js. Todos los campos salvo `name` pueden faltar en
// otra respuesta, así que aquí nada se da por hecho: se degrada, no se rompe.
//
// worker/src/resend.js replica a mano el formateo Y la regla de capacidades de este fichero
// (worker/ se despliega solo y no puede importar de js/). Los dos cambian juntos.

// Se redondea antes de elegir unidad, no después: si no, 0.9996 km cae en la rama de metros
// y se pinta como "1000 m" en vez de "1.0 km".
export function formatearDistancia(km) {
  if (typeof km !== 'number' || Number.isNaN(km)) return null;
  const metros = Math.round(km * 1000);
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toFixed(1)} km`;
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

// GLS asigna a veces un punto que sus propios datos declaran incapaz de aceptar devoluciones:
// verificado en producción con un locker de Castelldefels (offersReturnDropOff: 'N'). El dueño
// confirma que en España los lockers de GLS solo recogen, nunca admiten devoluciones.
//
// La decisión se toma por capacidades, no por `type`: `type` es descriptivo y mañana puede
// haber un punto que no sea locker y tampoco admita devoluciones. Nuestra etiqueta es una
// devolución ya prepagada, así que hacen falta las dos capacidades.
//
// Se exige la 'Y' literal que manda GLS: si el campo falta, viene vacío o llega en otro
// formato, el punto se descarta. Mandar a alguien a un punto que le rechazará el paquete es
// peor que decirle que busque uno.
export function aceptaDevoluciones(punto) {
  const capacidades = punto?.parcelHandlingRestriction;
  if (!capacidades) return false;
  return capacidades.offersReturnDropOff === 'Y' && capacidades.offersPrepaidParcelDropOff === 'Y';
}

// Única decisión sobre qué pintar, compartida por el modal (js/app.js) y la página de gracias
// (js/gracias.js) para que no se separen. El email del worker (worker/src/resend.js) replica
// esta misma rama a mano.
//
//   { punto: {...}, noAdmiteDevoluciones: false }  → pintar el punto
//   { punto: null,  noAdmiteDevoluciones: true  }  → pintar el aviso, no el punto
//   { punto: null,  noAdmiteDevoluciones: false }  → no pintar nada (GLS no asignó punto)
//
// El enlace al buscador de GLS se pinta siempre, en los tres sitios, pase lo que pase.
export function resolverPunto(punto) {
  const formateado = formatearPunto(punto);
  if (!formateado) return { punto: null, noAdmiteDevoluciones: false };
  if (!aceptaDevoluciones(punto)) return { punto: null, noAdmiteDevoluciones: true };
  return { punto: formateado, noAdmiteDevoluciones: false };
}
