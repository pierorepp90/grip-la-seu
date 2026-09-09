// Formatea el punto de entrega que GLS asigna al crear la devolución.
//
// La forma del objeto está verificada contra una respuesta real de producción (2026-09-08),
// y está documentada en worker/src/gls.js. Todos los campos salvo `name` pueden faltar en
// otra respuesta, así que aquí nada se da por hecho: se degrada, no se rompe.
//
// Este módulo lo comparten el sitio (js/app.js, js/gracias.js) y el Worker
// (worker/src/resend.js). Que worker/ tenga su propio package.json y se despliegue por su
// cuenta no impide importarlo: esbuild sigue el import relativo y lo inlina en el bundle.
// Comprobado el 2026-09-09 con `wrangler deploy --dry-run` sobre worker/: el bundle trae
// este fichero una sola vez y el sourcemap lo declara entre sus fuentes.
//
// El precio de compartirlo es que aquí no puede entrar nada del navegador: ni DOM, ni
// `window`, ni `document`, ni idiomas. Solo lógica pura sobre el objeto que manda GLS.

// Se redondea antes de elegir unidad, no después: si no, 0.9996 km cae en la rama de metros
// y se pinta como "1000 m" en vez de "1.0 km".
export function formatearDistancia(km) {
  if (typeof km !== 'number' || Number.isNaN(km)) return null;
  const metros = Math.round(km * 1000);
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toFixed(1)} km`;
}

// GLS expresa un punto abierto 24/7 como dos tramos pegados por día: 00:00–14:00 y
// 14:00–23:59. Pintados literalmente son seis líneas casi idénticas de ruido, así que un día
// cuyos tramos cubren el día entero se colapsa a "24 h". El filtro de puntos deja fuera casi
// todos los lockers, pero una tienda puede declarar esta misma forma y el formateador no debe
// producir un sinsentido cuando lo haga.
//
// Se exige que los tramos arranquen a medianoche y lleguen encadenados hasta el final del día:
// con un hueco en medio el punto NO está abierto las 24 h y hay que enseñar los tramos reales.
function enMinutos(hora) {
  const partes = /^(\d{1,2}):(\d{2})$/.exec(String(hora));
  if (!partes) return null;
  return Number(partes[1]) * 60 + Number(partes[2]);
}

export function cubreElDia(hours) {
  if (!Array.isArray(hours) || hours.length === 0) return false;
  const tramos = hours.map((tramo) => [enMinutos(tramo.openingTime), enMinutos(tramo.closingTime)]);
  if (tramos.some(([inicio, fin]) => inicio === null || fin === null)) return false;

  let alcance = 0;
  for (const [inicio, fin] of [...tramos].sort((a, b) => a[0] - b[0])) {
    if (inicio > alcance) return false;
    // Un tramo que cierra a las 00:00 cierra a medianoche del día siguiente, no a la de hoy.
    alcance = Math.max(alcance, fin === 0 ? 1440 : fin);
  }
  // 23:59 es como GLS escribe "hasta el final del día"; no le faltan 60 segundos.
  return alcance >= 1439;
}

// La etiqueta llega ya traducida en vez de resolverse aquí: así este fichero sigue sin saber
// nada de idiomas y los tres sitios que pintan el horario no tienen que repetir la rama.
export function formatearPunto(punto, etiqueta24h = '24 h') {
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
      tramos: cubreElDia(dia.hours)
        ? etiqueta24h
        : (dia.hours ?? [])
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

// Única decisión sobre qué pintar, compartida por los tres sitios que la necesitan para que no
// se separen: el modal (js/app.js), la página de gracias (js/gracias.js) y el email del Worker
// (worker/src/resend.js).
//
//   { punto: {...}, noAdmiteDevoluciones: false }  → pintar el punto
//   { punto: null,  noAdmiteDevoluciones: true  }  → pintar el aviso, no el punto
//   { punto: null,  noAdmiteDevoluciones: false }  → no pintar nada (GLS no asignó punto)
//
// El enlace al buscador de GLS se pinta siempre, en los tres sitios, pase lo que pase.
export function resolverPunto(punto, etiqueta24h) {
  const formateado = formatearPunto(punto, etiqueta24h);
  if (!formateado) return { punto: null, noAdmiteDevoluciones: false };
  if (!aceptaDevoluciones(punto)) return { punto: null, noAdmiteDevoluciones: true };
  return { punto: formateado, noAdmiteDevoluciones: false };
}
