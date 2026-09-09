// worker/src/index.js
import { buildCorsHeaders } from './cors.js';
import {
  buildCheckoutSessionParams,
  createStripeSession,
  retrieveStripeSession,
  parseSessionPaymentStatus,
  orderPayloadFromSession,
} from './stripe.js';
import { buildOwnerEmail, buildCustomerEmail, sendEmail } from './resend.js';
import { buildReturnOrderRequest, createReturnOrder, parseReturnOrderResponse } from './gls.js';
import {
  TTL_EXITO_SEGUNDOS,
  claveDedupe,
  clavesLectura,
  claveAvisoEmails,
  clasificarFalloGls,
  ttlDelRegistro,
  registroEnCurso,
  esEnCurso,
} from './pedidos.js';

// El binding es opcional a propósito: sin él (dev local, tests) el Worker sigue funcionando,
// simplemente sin deduplicar. Todo lo que se añada aquí tiene que seguir cumpliéndolo.
async function leerRegistro(env, claves) {
  if (!env.PEDIDOS) return null;
  for (const clave of claves) {
    const raw = await env.PEDIDOS.get(clave);
    if (raw) return JSON.parse(raw);
  }
  return null;
}

// Cuánto vive cada registro lo decide pedidos.js mirando el propio registro: 90 días un éxito
// o un fallo del que no sabemos si creó algo, diez minutos un fallo que seguro no creó nada,
// un minuto la marca de "en curso".
async function guardarRegistro(env, clave, registro) {
  if (!env.PEDIDOS || !clave) return;
  await env.PEDIDOS.put(clave, JSON.stringify(registro), {
    expirationTtl: ttlDelRegistro(registro),
  });
}

// El motivo viaja con la respuesta —igual que portalUrl— para que la lista de datos que el
// cliente tiene que copiar en el portal (el modal, gracias.html y el email) nombre siempre
// la misma opción del desplegable que habríamos elegido nosotros. Escrito a mano en cada
// sitio, cambiar GLS_RETURN_REASON los dejaba atrás en silencio.
//
// Es un campo añadido, no un cambio de forma: quien no lo reciba (una página cacheada, un
// pedido guardado en KV antes de esto) cae a su respaldo y sigue viendo la lista entera.
//
// `fallo` es lo único nuevo y no lo mira nadie más que la política de caducidad de KV: ni el
// cliente ni el email cambian por él.
function falloGls(error, fallo, env) {
  console.error('No se pudo crear la devolución GLS', error);
  return {
    ok: false,
    error: error.message,
    fallo,
    portalUrl: env.GLS_PORTAL_URL,
    returnReason: env.GLS_RETURN_REASON,
  };
}

// Nunca lanza: un fallo de GLS no puede tumbar un pedido ya confirmado o ya cobrado.
// El propietario se entera por el aviso que buildOwnerEmail añade cuando ok es false.
async function resolveGlsReturn(orderPayload, env) {
  let request;
  try {
    request = buildReturnOrderRequest(orderPayload, env);
  } catch (error) {
    // Un pedido tan mal formado que ni se puede construir la petición: no ha salido nada
    // hacia GLS, así que no hay ninguna devolución que se pueda duplicar al reintentar.
    return falloGls(error, clasificarFalloGls(error, { peticionEnviada: false }), env);
  }

  try {
    const json = await createReturnOrder(request, env);
    return { ok: true, ...parseReturnOrderResponse(json) };
  } catch (error) {
    return falloGls(error, clasificarFalloGls(error), env);
  }
}

// Tampoco lanza. Un pedido ya cobrado no se puede tumbar porque Resend falle: el cliente
// tiene igualmente su etiqueta, que se la manda GLS directamente. Los fallos se registran y
// se guardan en KV para que quede rastro de qué email no salió.
async function enviarEmails(orderPayload, gls, env) {
  // Los emails se CONSTRUYEN dentro de la promesa, no fuera. Si se construyen fuera, una
  // excepcion sincrona en un builder (p.ej. una linea de carrito sin precioSubtotal) escapa
  // de allSettled, sube al handler y devuelve un 500 con la devolucion GLS ya creada y KV ya
  // marcado como procesado: el reintento corta por la rama cacheada y nadie recibe email nunca.
  const envios = [
    { quien: 'propietario', construir: () => buildOwnerEmail(orderPayload, env.OWNER_EMAIL, gls) },
    { quien: 'cliente', construir: () => buildCustomerEmail(orderPayload, orderPayload.email, gls) },
  ];

  const resultados = await Promise.allSettled(
    envios.map(({ construir }) =>
      Promise.resolve().then(() => sendEmail(construir(), env.RESEND_API_KEY)),
    ),
  );

  const fallidos = resultados
    .map((resultado, indice) =>
      resultado.status === 'rejected' ? `${envios[indice].quien}: ${resultado.reason?.message}` : null,
    )
    .filter(Boolean);

  if (fallidos.length > 0) {
    console.error(`Emails fallidos del pedido ${orderPayload.orderId}`, fallidos);
  }
  return fallidos;
}

// El apunte de siempre —el registro del pedido con la lista de emails que no salieron— y otro
// aparte con vida larga. El del pedido caduca en diez minutos cuando el fallo de GLS es
// definitivo, y que un email no haya salido es la única señal que le queda al propietario: no
// puede irse con él. Con prefijo propio, además, se listan todos de golpe desde KV.
async function guardarAvisoEmails(env, orderId, registro, emailsFallidos) {
  const clave = claveAvisoEmails(orderId);
  if (!env.PEDIDOS || !clave) return;
  await env.PEDIDOS.put(
    clave,
    JSON.stringify({
      orderId,
      emailsFallidos,
      glsOk: registro.gls?.ok === true,
      at: new Date().toISOString(),
    }),
    { expirationTtl: TTL_EXITO_SEGUNDOS },
  );
}

async function registrarEnvioDeEmails(env, clave, registro, orderPayload) {
  try {
    const emailsFallidos = await enviarEmails(orderPayload, registro.gls, env);
    if (emailsFallidos.length === 0) return;
    await guardarRegistro(env, clave, { ...registro, emailsFallidos });
    await guardarAvisoEmails(env, orderPayload.orderId, registro, emailsFallidos);
  } catch (error) {
    // enviarEmails no lanza; lo que puede fallar aquí es KV. Esto corre ya después de haber
    // respondido, así que un rechazo sin capturar no llegaría a nadie: se registra y punto.
    console.error('No se pudo anotar el resultado de los emails', error);
  }
}

// Los emails ya no los espera el cliente. Son best-effort desde siempre (allSettled, fallos
// registrados y guardados), y hacerle esperar dos llamadas a Resend con el pedido ya cobrado
// solo alarga la pantalla de "Comprobando el pago…" y con ella la ventana en la que le da a
// F5. ctx.waitUntil mantiene la tarea viva después de la respuesta, así que la contabilidad
// de fallos se sigue haciendo igual.
function despacharEmails(ctx, env, clave, registro, orderPayload) {
  const tarea = registrarEnvioDeEmails(env, clave, registro, orderPayload);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(tarea);
    return;
  }
  // Sin ctx (dev local, un arnés de pruebas) la tarea sigue viva en el mismo isolate; lo
  // único que hay que garantizar es que no quede un rechazo sin capturar.
  tarea.catch(() => {});
}

// El trabajo caro e irreversible, con la marca de "en curso" alrededor.
//
// KV no tiene compare-and-set, así que dos peticiones simultáneas pueden seguir colándose;
// lo que se puede hacer sin un Durable Object es estrechar la ventana. Antes iba desde la
// lectura hasta después de la llamada a GLS —hasta diez segundos, justo mientras el cliente
// mira "Comprobando el pago…" y le entran ganas de recargar—; ahora va desde la lectura
// hasta la escritura de la marca, que son milisegundos.
async function procesarPedido(orderPayload, env, ctx, clave) {
  await guardarRegistro(env, clave, registroEnCurso());
  const gls = await resolveGlsReturn(orderPayload, env);

  // Se guarda ANTES de responder y antes de los emails: en cuanto existe una devolución real
  // en GLS hay que impedir que un reintento cree una segunda. Es también la escritura que
  // sustituye la marca de "en curso"; si el isolate se muriera antes de llegar aquí, la marca
  // caduca sola en un minuto y el pedido no se queda atascado para siempre.
  const registro = { gls, order: orderPayload, processedAt: new Date().toISOString() };
  await guardarRegistro(env, clave, registro);
  despacharEmails(ctx, env, clave, registro, orderPayload);
  return gls;
}

async function handleCreateCheckoutSession(request, env, cors) {
  const orderPayload = await request.json();
  const params = buildCheckoutSessionParams(orderPayload, env.SITE_URL);
  const session = await createStripeSession(params, env.STRIPE_SECRET_KEY);
  return Response.json({ url: session.url }, { headers: cors });
}

async function handleNotifyOrder(request, env, ctx, cors) {
  const orderPayload = await request.json();
  const { orderId } = orderPayload;

  const registro = await leerRegistro(env, clavesLectura(orderId, null));
  if (esEnCurso(registro)) {
    // Otra petición del mismo pedido está creando la devolución ahora mismo. No hay resultado
    // que dar, pero tampoco es un error: el cliente vuelve a preguntar en unos segundos.
    return Response.json({ ok: true, enCurso: true }, { headers: cors });
  }
  if (registro) {
    return Response.json({ ok: true, gls: registro.gls }, { headers: cors });
  }

  const gls = await procesarPedido(orderPayload, env, ctx, claveDedupe(orderId, null));
  return Response.json({ ok: true, gls }, { headers: cors });
}

async function handleConfirmPayment(url, env, ctx, cors) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return Response.json({ error: 'session_id inválido' }, { status: 400, headers: cors });
  }

  // Stripe antes que KV, y no al revés: la clave de deduplicación es la del PEDIDO, no la de
  // la sesión, y el orderId solo se conoce después de recuperar la sesión (va en
  // metadata[order_id] y vuelve en orderPayloadFromSession). Es un GET idempotente y barato,
  // y a cambio la ruta de tarjeta y la de bizum comparten por fin la misma clave: pagar con
  // tarjeta, darle a "atrás" y confirmar por bizum ya no crea dos devoluciones del mismo
  // pedido.
  const session = await retrieveStripeSession(sessionId, env.STRIPE_SECRET_KEY);
  if (!parseSessionPaymentStatus(session)) {
    return Response.json({ ok: true, paid: false }, { headers: cors });
  }

  const orderPayload = orderPayloadFromSession(session);
  const { orderId } = orderPayload;
  // Se sigue mirando la clave de sesión que escribía la versión anterior: en KV quedan hasta
  // 90 días de pedidos guardados así, y no leerlos duplicaría su devolución al recargar.
  const registro = await leerRegistro(env, clavesLectura(orderId, sessionId));

  if (esEnCurso(registro)) {
    // Aquí todavía no hay resultado de GLS, pero sí un pago confirmado y un pedido: se
    // responden igual, con enCurso, para que gracias.html pinte el recibo y vuelva a
    // preguntar en unos segundos en vez de dejar al cliente ante un error o un spinner eterno.
    return Response.json(
      { ok: true, paid: true, enCurso: true, orderId, order: orderPayload },
      { headers: cors },
    );
  }
  if (registro) {
    // El pedido se responde con lo que acaba de decir Stripe, no con lo guardado: es el mismo
    // contenido y así sirve igual un registro escrito por la ruta de bizum.
    return Response.json(
      { ok: true, paid: true, orderId, order: orderPayload, gls: registro.gls },
      { headers: cors },
    );
  }

  const gls = await procesarPedido(orderPayload, env, ctx, claveDedupe(orderId, sessionId));
  return Response.json({ ok: true, paid: true, orderId, order: orderPayload, gls }, { headers: cors });
}

export default {
  // ctx hace falta para ctx.waitUntil: los emails se mandan después de responder al cliente.
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = buildCorsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (request.method === 'POST' && url.pathname === '/api/create-checkout-session') {
        return await handleCreateCheckoutSession(request, env, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/notify-order') {
        return await handleNotifyOrder(request, env, ctx, cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/confirm-payment') {
        return await handleConfirmPayment(url, env, ctx, cors);
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500, headers: cors });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
