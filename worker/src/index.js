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

async function handleCreateCheckoutSession(request, env, cors) {
  const orderPayload = await request.json();
  const params = buildCheckoutSessionParams(orderPayload, env.SITE_URL);
  const session = await createStripeSession(params, env.STRIPE_SECRET_KEY);
  return Response.json({ url: session.url }, { headers: cors });
}

async function handleNotifyOrder(request, env, cors) {
  const orderPayload = await request.json();
  const ownerEmail = buildOwnerEmail(orderPayload, env.OWNER_EMAIL);
  const customerEmail = buildCustomerEmail(orderPayload, orderPayload.email);
  await Promise.all([
    sendEmail(ownerEmail, env.RESEND_API_KEY),
    sendEmail(customerEmail, env.RESEND_API_KEY),
  ]);
  return Response.json({ ok: true }, { headers: cors });
}

// Nota: sin base de datos no hay forma de deduplicar. Si el cliente recarga
// gracias.html tras un pago ya confirmado, esta función reenvía ambos emails.
// Limitación aceptada para este alcance (mismo criterio que la ausencia de
// webhook de Stripe, documentada en la spec) — no añadir Workers KV u otra
// infraestructura para esto salvo que el propietario lo pida explícitamente.
async function handleConfirmPayment(url, env, cors) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return Response.json({ error: 'session_id inválido' }, { status: 400, headers: cors });
  }
  const session = await retrieveStripeSession(sessionId, env.STRIPE_SECRET_KEY);
  if (!parseSessionPaymentStatus(session)) {
    return Response.json({ ok: true, paid: false }, { headers: cors });
  }
  const orderPayload = orderPayloadFromSession(session);
  const ownerEmail = buildOwnerEmail(orderPayload, env.OWNER_EMAIL);
  const customerEmail = buildCustomerEmail(orderPayload, orderPayload.email);
  await Promise.all([
    sendEmail(ownerEmail, env.RESEND_API_KEY),
    sendEmail(customerEmail, env.RESEND_API_KEY),
  ]);
  return Response.json(
    { ok: true, paid: true, orderId: orderPayload.orderId, order: orderPayload },
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
