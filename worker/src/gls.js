// Cliente de la API del portal de devoluciones de GLS.
//
// OJO: es la API interna que usa el propio portal (returns.gls-group.com), no una API
// publicada para integradores. Las credenciales salen de su frontend público. Puede cambiar
// sin aviso; por eso index.js nunca deja que un fallo aquí tumbe el pedido. La vía sostenible
// es el ShopReturnService API oficial, solicitado a GLS y pendiente de respuesta.

// Límites extraídos de los validadores del portal. El formulario ya los aplica; los repetimos
// aquí para que relajar el frontend no haga que GLS empiece a rechazar pedidos.
const LIMITES = {
  originalOrderReference: 50,
  personName: 40,
  email: 255,
  calle: 40,
  numero: 6,
  codigoPostal: 10,
  ciudad: 40,
};

// GLS no soporta catalán.
const IDIOMA_GLS = { ca: 'es', es: 'es', en: 'en', pt: 'pt' };

function truncar(valor, maximo) {
  return String(valor ?? '').trim().slice(0, maximo);
}

export function buildReturnOrderRequest(orderPayload, env) {
  const { orderId, nombre, email, direccion, lang } = orderPayload;
  const calle = truncar(direccion.calle, LIMITES.calle);
  const numero = truncar(direccion.numero, LIMITES.numero);
  const emailLimpio = truncar(email, LIMITES.email);

  return {
    originalOrderReference: truncar(orderId, LIMITES.originalOrderReference),
    returnReason: env.GLS_RETURN_REASON,
    options: {
      confirmationMail: { sendTo: [emailLimpio] },
      languageCode: IDIOMA_GLS[lang] ?? 'es',
    },
    sender: {
      personName: truncar(nombre, LIMITES.personName),
      email: emailLimpio,
      address: {
        street: `${calle} ${numero}`.trim(),
        city: truncar(direccion.ciudad, LIMITES.ciudad),
        zipCode: truncar(direccion.codigoPostal, LIMITES.codigoPostal),
        countryCode: direccion.pais,
      },
    },
  };
}

// Forma real de la respuesta, verificada contra producción el 2026-09-08:
//
//   returnOrderId: "b6e39dbf-6834-40d0-a3bc-e53c97f72e04"   (UUID interno)
//   references: { trackId: "Z79MB8U2", parcelId: "374549840588" }
//   dropOffLocations.data[0]: {
//     parcelShopId, name: "PS GO PACK EXPRESS", type: "SHOP",
//     distance: 0.182,                                  (km)
//     address: { street, city, zipCode, countryCode, latitude, longitude },
//     externalContactDetails: { phone }, openingDays: [{ weekday, hours: [...] }]
//   }
//
// `trackId` es el codigo corto que una persona usa para seguir el envio; `returnOrderId` es
// un UUID que solo sirve para la API. Al cliente se le enseña el primero. Se deja un respaldo
// al UUID por si GLS dejara de mandar `references`.
// `dropOffLocation` sigue pasandose crudo: es un objeto grande y quien lo pinte elige que
// campos usar.
export function parseReturnOrderResponse(json) {
  if (!json || !json.returnOrderId) {
    throw new Error('GLS respondió sin returnOrderId');
  }
  return {
    returnOrderId: json.returnOrderId,
    trackId: json.references?.trackId ?? json.returnOrderId,
    dropOffLocation: json.dropOffLocations?.data?.[0] ?? null,
  };
}

const TIMEOUT_MS = 10000;

export async function createReturnOrder(request, env, fetchFn = fetch, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const temporizador = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${env.GLS_API_BASE}/${env.GLS_PORTAL_NAME}/return-orders`, {
      method: 'POST',
      headers: {
        Authorization: env.GLS_CLIENT_KEY,
        'X-Portal-Token': env.GLS_PORTAL_TOKEN,
        'X-Portal-Name': env.GLS_PORTAL_NAME,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`GLS rechazó la creación de la devolución (HTTP ${response.status})`);
      // El status va como propiedad, no solo dentro del mensaje: quien decide si se puede
      // reintentar (worker/src/pedidos.js) necesita distinguir un 4xx —GLS rechazó la
      // petición sin crear nada— de un 5xx, y sacarlo del texto a base de regex se rompe a
      // la primera vez que alguien retoque el mensaje.
      error.httpStatus = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(temporizador);
  }
}
