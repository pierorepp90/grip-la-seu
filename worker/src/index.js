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

async function enviarEmails(orderPayload, gls, env) {
  await Promise.all([
    sendEmail(buildOwnerEmail(orderPayload, env.OWNER_EMAIL, gls), env.RESEND_API_KEY),
    sendEmail(buildCustomerEmail(orderPayload, orderPayload.email, gls), env.RESEND_API_KEY),
  ]);
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
  await enviarEmails(orderPayload, gls, env);
  await guardarProcesado(env, clave, { gls, processedAt: new Date().toISOString() });

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
  await enviarEmails(orderPayload, gls, env);
  await guardarProcesado(env, clave, {
    gls,
    order: orderPayload,
    processedAt: new Date().toISOString(),
  });

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
