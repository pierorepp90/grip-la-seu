import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckoutSession,
  notifyOrder,
  confirmPayment,
  reintentarMientrasEnCurso,
  confirmPaymentHastaResultado,
  notifyOrderHastaResultado,
  INTENTOS_EN_CURSO,
  MS_ESPERA_EN_CURSO,
} from '../js/api.js';

test('createCheckoutSession hace POST y devuelve el JSON', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.example.com/api/create-checkout-session');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).orderId, 'GLS-1');
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/xyz' }) };
  };
  const result = await createCheckoutSession('https://api.example.com', { orderId: 'GLS-1' }, fakeFetch);
  assert.equal(result.url, 'https://checkout.stripe.com/xyz');
});

test('createCheckoutSession lanza error si la respuesta no es ok', async () => {
  const fakeFetch = async () => ({ ok: false });
  await assert.rejects(() => createCheckoutSession('https://api.example.com', {}, fakeFetch));
});

test('notifyOrder hace POST al endpoint correcto', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.example.com/api/notify-order');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const result = await notifyOrder('https://api.example.com', { orderId: 'GLS-1' }, fakeFetch);
  assert.equal(result.ok, true);
});

test('confirmPayment hace GET con session_id en la query', async () => {
  const fakeFetch = async (url) => {
    assert.equal(url, 'https://api.example.com/api/confirm-payment?session_id=sess_123');
    return { ok: true, json: async () => ({ ok: true, paid: true, orderId: 'GLS-1' }) };
  };
  const result = await confirmPayment('https://api.example.com', 'sess_123', fakeFetch);
  assert.equal(result.paid, true);
});

// --- Sondeo mientras el Worker está creando la devolución ---------------------------------
//
// El Worker marca el pedido como "en curso" antes de llamar a GLS y contesta { enCurso: true }
// a cualquier otra petición del mismo pedido que llegue mientras tanto (un F5 en gracias.html,
// una segunda pestaña). Esa respuesta no trae resultado todavía, así que el cliente vuelve a
// preguntar en vez de pintar un error o quedarse colgado.

test('reintentarMientrasEnCurso devuelve a la primera si el pedido ya está resuelto', async () => {
  let llamadas = 0;
  const resultado = await reintentarMientrasEnCurso(
    async () => {
      llamadas += 1;
      return { ok: true, paid: true, gls: { ok: true } };
    },
    { esperar: async () => {} },
  );
  assert.equal(llamadas, 1);
  assert.equal(resultado.gls.ok, true);
});

test('reintentarMientrasEnCurso vuelve a preguntar mientras el Worker conteste enCurso', async () => {
  const respuestas = [
    { ok: true, paid: true, enCurso: true },
    { ok: true, paid: true, enCurso: true },
    { ok: true, paid: true, gls: { ok: true, trackId: 'Z1' } },
  ];
  const esperas = [];
  const resultado = await reintentarMientrasEnCurso(async () => respuestas.shift(), {
    esperar: async (ms) => esperas.push(ms),
    msEspera: 3000,
  });
  assert.equal(resultado.gls.trackId, 'Z1');
  assert.deepEqual(esperas, [3000, 3000]);
});

test('reintentarMientrasEnCurso se rinde y devuelve el último enCurso', async () => {
  let llamadas = 0;
  const resultado = await reintentarMientrasEnCurso(
    async () => {
      llamadas += 1;
      return { ok: true, paid: true, enCurso: true };
    },
    { esperar: async () => {}, intentos: 4 },
  );
  assert.equal(llamadas, 4);
  assert.equal(resultado.enCurso, true);
});

test('reintentarMientrasEnCurso avisa del resultado parcial antes de cada espera', async () => {
  const respuestas = [
    { ok: true, paid: true, enCurso: true, order: { orderId: 'GLS-1' } },
    { ok: true, paid: true, gls: { ok: true } },
  ];
  const avisos = [];
  await reintentarMientrasEnCurso(async () => respuestas.shift(), {
    esperar: async () => {},
    alEsperar: (parcial) => avisos.push(parcial),
  });
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].order.orderId, 'GLS-1');
});

test('confirmPaymentHastaResultado sondea el endpoint de confirmación', async () => {
  const respuestas = [
    { ok: true, paid: true, enCurso: true },
    { ok: true, paid: true, gls: { ok: true, trackId: 'Z9' } },
  ];
  const fakeFetch = async (url) => {
    assert.equal(url, 'https://api.example.com/api/confirm-payment?session_id=sess_1');
    return { ok: true, json: async () => respuestas.shift() };
  };
  const resultado = await confirmPaymentHastaResultado('https://api.example.com', 'sess_1', {
    fetchFn: fakeFetch,
    esperar: async () => {},
  });
  assert.equal(resultado.gls.trackId, 'Z9');
});

test('notifyOrderHastaResultado sondea el endpoint de aviso de pedido', async () => {
  const respuestas = [{ ok: true, enCurso: true }, { ok: true, gls: { ok: false } }];
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.example.com/api/notify-order');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => respuestas.shift() };
  };
  const resultado = await notifyOrderHastaResultado(
    'https://api.example.com',
    { orderId: 'GLS-1' },
    { fetchFn: fakeFetch, esperar: async () => {} },
  );
  assert.equal(resultado.gls.ok, false);
});

// Invariante que cruza las dos mitades del proyecto (por eso el test importa del worker, que
// el sitio nunca importa en producción): el sondeo tiene que rendirse ANTES de que caduque la
// marca del Worker. Si sondeara más tiempo, la última petición encontraría la marca ya
// caducada, arrancaría su propia llamada a GLS y podría crear una segunda etiqueta —
// justamente lo que la marca existe para evitar.
test('la ventana de sondeo se agota antes de que caduque la marca en curso del Worker', async () => {
  const { TTL_EN_CURSO_SEGUNDOS } = await import('../worker/src/pedidos.js');
  const ventanaMs = INTENTOS_EN_CURSO * MS_ESPERA_EN_CURSO;
  assert.ok(
    ventanaMs < TTL_EN_CURSO_SEGUNDOS * 1000,
    `el sondeo dura ${ventanaMs} ms y la marca solo ${TTL_EN_CURSO_SEGUNDOS * 1000} ms`,
  );
});
