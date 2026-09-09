export async function createCheckoutSession(apiBaseUrl, orderPayload, fetchFn = fetch) {
  const response = await fetchFn(`${apiBaseUrl}/api/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });
  if (!response.ok) {
    throw new Error('No se pudo iniciar el pago con tarjeta');
  }
  return response.json();
}

export async function notifyOrder(apiBaseUrl, orderPayload, fetchFn = fetch) {
  const response = await fetchFn(`${apiBaseUrl}/api/notify-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });
  if (!response.ok) {
    throw new Error('No se pudo confirmar el pedido');
  }
  return response.json();
}

export async function confirmPayment(apiBaseUrl, sessionId, fetchFn = fetch) {
  const response = await fetchFn(
    `${apiBaseUrl}/api/confirm-payment?session_id=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) {
    throw new Error('No se pudo confirmar el pago');
  }
  return response.json();
}

// --- Sondeo mientras el Worker está creando la devolución ---------------------------------
//
// El Worker marca el pedido en KV antes de llamar a GLS, así que una segunda petición del
// mismo pedido —un F5 en gracias.html mientras pone "Comprobando el pago…", otra pestaña, el
// mismo pedido llegando por las dos rutas de pago— recibe { enCurso: true } y todavía sin
// resultado. Volver a preguntar es lo único razonable: la primera petición está a punto de
// terminar (GLS aborta a los 10 s) y el resultado aparecerá en KV.
//
// La ventana total (INTENTOS_EN_CURSO × MS_ESPERA_EN_CURSO) tiene que ser MENOR que lo que
// dura la marca del Worker (TTL_EN_CURSO_SEGUNDOS en worker/src/pedidos.js). Si sondeáramos
// más allá de su caducidad, la última petición ya no vería la marca, arrancaría su propia
// llamada a GLS y podría crear una segunda etiqueta facturable. Hay un test que lo vigila.
export const MS_ESPERA_EN_CURSO = 3000;
export const INTENTOS_EN_CURSO = 10;

function esperaPorDefecto(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reintentarMientrasEnCurso(pedir, opciones = {}) {
  const {
    intentos = INTENTOS_EN_CURSO,
    msEspera = MS_ESPERA_EN_CURSO,
    esperar = esperaPorDefecto,
    alEsperar = () => {},
  } = opciones;

  let resultado = await pedir();
  for (let intento = 1; intento < intentos && resultado?.enCurso; intento += 1) {
    alEsperar(resultado);
    await esperar(msEspera);
    resultado = await pedir();
  }
  // Si se agotan los intentos, el último resultado sigue siendo enCurso: quien llama tiene
  // que decirle al cliente que su etiqueta se está preparando, no pintarle un error.
  return resultado;
}

export function confirmPaymentHastaResultado(apiBaseUrl, sessionId, opciones = {}) {
  const { fetchFn = fetch, ...resto } = opciones;
  return reintentarMientrasEnCurso(() => confirmPayment(apiBaseUrl, sessionId, fetchFn), resto);
}

export function notifyOrderHastaResultado(apiBaseUrl, orderPayload, opciones = {}) {
  const { fetchFn = fetch, ...resto } = opciones;
  return reintentarMientrasEnCurso(() => notifyOrder(apiBaseUrl, orderPayload, fetchFn), resto);
}
