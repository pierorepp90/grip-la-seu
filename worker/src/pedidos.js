// worker/src/pedidos.js
//
// Política de deduplicación de pedidos en KV: qué clave identifica un pedido, cuánto dura
// cada resultado y cómo se marca uno que se está procesando ahora mismo.
//
// Todo lo de aquí es puro a propósito. index.js no tiene test (no hay arnés de Workers en el
// repo), así que las decisiones que se pueden equivocar —y que cuestan dinero cuando se
// equivocan, porque cada devolución GLS es una etiqueta facturable— viven aquí y se prueban
// en worker/tests/pedidos.test.js.

// Un éxito no caduca en la práctica: mientras el registro exista, ningún reintento vuelve a
// llamar a GLS.
export const TTL_EXITO_SEGUNDOS = 60 * 60 * 24 * 90;

// Un fallo del que sabemos con certeza que no creó nada caduca pronto: lo contrario clavaba
// el pedido en el modo manual durante tres meses aunque el problema (una clave caducada, un
// 429, un campo que GLS dejó de aceptar) se arreglara diez minutos después. Diez minutos son
// suficientes para que una ráfaga de F5 no machaque a GLS y bastante poco para que un
// reintento del cliente —o del propietario— pueda recuperar el modo automático.
export const TTL_FALLO_DEFINITIVO_SEGUNDOS = 60 * 10;

// La marca de "lo estoy procesando" dura lo mínimo que admite KV. Tiene que sobrevivir a la
// petición que la escribió (GLS aborta a los 10 s) y morir sola en cuanto esa petición deja
// de existir: una marca que no caduca es peor que no tener marca, porque atasca el pedido
// para siempre si el isolate se muere entre escribirla y guardar el resultado.
export const TTL_EN_CURSO_SEGUNDOS = 60;

export const FALLO_DEFINITIVO = 'definitivo';
export const FALLO_AMBIGUO = 'ambiguo';

// Una sola clave para las dos rutas de pago. El orderId lo genera el navegador una vez por
// pedido (js/app.js) y sobrevive a las dos: en bizum viaja en el cuerpo, en tarjeta va y
// vuelve en metadata[order_id] de Stripe. Sin esto, "Pagar con tarjeta" + atrás + bizum son
// dos devoluciones GLS del mismo pedido.
export function claveDedupe(orderId, sessionId) {
  if (orderId) return `order:${orderId}`;
  // Sin orderId todavía se puede deduplicar la ruta de tarjeta por la sesión de Stripe.
  if (sessionId) return `session:${sessionId}`;
  // Y sin ninguna de las dos, mejor no deduplicar que meter todos los pedidos sin referencia
  // en una clave común: el segundo leería el resultado del primero.
  return null;
}

// Las claves que hay que consultar antes de dar un pedido por nuevo. Además de la clave
// unificada se mira la clave de sesión que escribía la versión anterior: en KV hay hasta 90
// días de pedidos guardados así, y no leerlos duplicaría su devolución al recargar.
export function clavesLectura(orderId, sessionId) {
  const claves = [];
  if (orderId) claves.push(`order:${orderId}`);
  if (sessionId) claves.push(`session:${sessionId}`);
  return claves;
}

// Los emails fallidos se apuntan también aquí, en su propio prefijo y con la vida larga. En
// el registro del pedido siguen estando, pero ese registro caduca en diez minutos cuando el
// fallo de GLS es definitivo, y el aviso de que un email no salió es la única señal que
// tiene el propietario: no puede irse con él.
export function claveAvisoEmails(orderId) {
  return orderId ? `emails:${orderId}` : null;
}

// Definitivo = GLS rechazó la petición y no creó nada. Ambiguo = puede haberla creado.
//
// Solo se puede afirmar lo primero de un 4xx (la petición era inválida o no estaba
// autorizada; GLS contestó antes de hacer nada) y de un fallo anterior al envío. Todo lo
// demás —timeout, abort, corte de red, 5xx, una respuesta 2xx que no trae returnOrderId— es
// ambiguo: GLS pudo crear la devolución y no llegar a contárnoslo. Reintentar eso es
// exactamente como un cliente acaba con dos etiquetas facturables, así que por defecto se
// clasifica como ambiguo.
//
// El status viaja en error.httpStatus, que pone gls.js al lanzar. Es lo único fiable que hay
// para discriminar: en el mensaje el código va incrustado en texto libre y el resto de
// errores (abort, red) no traen nada que distinga una cosa de otra.
export function clasificarFalloGls(error, { peticionEnviada = true } = {}) {
  if (!peticionEnviada) return FALLO_DEFINITIVO;
  const status = error?.httpStatus;
  if (typeof status === 'number' && status >= 400 && status < 500) return FALLO_DEFINITIVO;
  return FALLO_AMBIGUO;
}

export function registroEnCurso(ahora = new Date()) {
  return { enCurso: true, startedAt: ahora.toISOString() };
}

export function esEnCurso(registro) {
  return registro?.enCurso === true;
}

export function ttlDelRegistro(registro) {
  if (esEnCurso(registro)) return TTL_EN_CURSO_SEGUNDOS;
  if (registro?.gls?.ok === false && registro.gls.fallo === FALLO_DEFINITIVO) {
    return TTL_FALLO_DEFINITIVO_SEGUNDOS;
  }
  return TTL_EXITO_SEGUNDOS;
}
