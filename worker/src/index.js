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

const KV_TTL_SEGUNDOS = 60 * 60 * 24 * 90;

// El binding es opcional a propósito: sin él (dev local, tests) el Worker sigue funcionando,
// simplemente sin deduplicar.
async function leerProcesado(env, clave) {
  if (!env.PEDIDOS) return null;
  const raw = await env.PEDIDOS.get(clave);
  return raw ? JSON.parse(raw) : null;
}

async function guardarProcesado(env, clave, valor) {
  if (!env.PEDIDOS) return;
  await env.PEDIDOS.put(clave, JSON.stringify(valor), { expirationTtl: KV_TTL_SEGUNDOS });
}

// Nunca lanza: un fallo de GLS no puede tumbar un pedido ya confirmado o ya cobrado.
// El propietario se entera por el aviso que buildOwnerEmail añade cuando ok es false.
async function resolveGlsReturn(orderPayload, env) {
  try {
    const request = buildReturnOrderRequest(orderPayload, env);
    const json = await createReturnOrder(request, env);
    return { ok: true, ...parseReturnOrderResponse(json) };
  } catch (error) {
    console.error('No se pudo crear la devolución GLS', error);
    return { ok: false, error: error.message, portalUrl: env.GLS_PORTAL_URL };
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

async function handleCreateCheckoutSession(request, env, cors) {
  const orderPayload = await request.json();
  const params = buildCheckoutSessionParams(orderPayload, env.SITE_URL);
  const session = await createStripeSession(params, env.STRIPE_SECRET_KEY);
  return Response.json({ url: session.url }, { headers: cors });
}

async function handleNotifyOrder(request, env, cors) {
  const orderPayload = await request.json();
  const clave = `order:${orderPayload.orderId}`;

  const yaProcesado = await leerProcesado(env, clave);
  if (yaProcesado) {
    return Response.json({ ok: true, gls: yaProcesado.gls }, { headers: cors });
  }

  const gls = await resolveGlsReturn(orderPayload, env);
  // Se guarda ANTES de enviar los emails, no después: en cuanto existe una devolución real
  // en GLS hay que impedir que un reintento cree una segunda. Si guardásemos al final, un
  // fallo de Resend dejaría KV vacío y la recarga del cliente duplicaría la devolución.
  await guardarProcesado(env, clave, { gls, processedAt: new Date().toISOString() });
  const emailsFallidos = await enviarEmails(orderPayload, gls, env);
  if (emailsFallidos.length > 0) {
    await guardarProcesado(env, clave, {
      gls,
      emailsFallidos,
      processedAt: new Date().toISOString(),
    });
  }

  return Response.json({ ok: true, gls }, { headers: cors });
}

async function handleConfirmPayment(url, env, cors) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return Response.json({ error: 'session_id inválido' }, { status: 400, headers: cors });
  }

  const clave = `session:${sessionId}`;
  const yaProcesado = await leerProcesado(env, clave);
  if (yaProcesado) {
    return Response.json(
      {
        ok: true,
        paid: true,
        orderId: yaProcesado.order.orderId,
        order: yaProcesado.order,
        gls: yaProcesado.gls,
      },
      { headers: cors },
    );
  }

  const session = await retrieveStripeSession(sessionId, env.STRIPE_SECRET_KEY);
  if (!parseSessionPaymentStatus(session)) {
    return Response.json({ ok: true, paid: false }, { headers: cors });
  }

  const orderPayload = orderPayloadFromSession(session);
  const gls = await resolveGlsReturn(orderPayload, env);
  // Igual que en handleNotifyOrder: guardar antes de los emails. Aquí importa todavía más,
  // porque el pedido ya está cobrado y recargar gracias.html es la reacción natural a un error.
  await guardarProcesado(env, clave, {
    gls,
    order: orderPayload,
    processedAt: new Date().toISOString(),
  });
  const emailsFallidos = await enviarEmails(orderPayload, gls, env);
  if (emailsFallidos.length > 0) {
    await guardarProcesado(env, clave, {
      gls,
      order: orderPayload,
      emailsFallidos,
      processedAt: new Date().toISOString(),
    });
  }

  return Response.json(
    { ok: true, paid: true, orderId: orderPayload.orderId, order: orderPayload, gls },
    { headers: cors },
  );
}

export default {
  async fetch(request, env) {
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
        return await handleNotifyOrder(request, env, cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/confirm-payment') {
        return await handleConfirmPayment(url, env, cors);
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500, headers: cors });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
