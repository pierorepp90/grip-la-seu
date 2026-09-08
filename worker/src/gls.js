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
