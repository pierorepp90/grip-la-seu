import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TTL_EXITO_SEGUNDOS,
  TTL_FALLO_DEFINITIVO_SEGUNDOS,
  TTL_EN_CURSO_SEGUNDOS,
  FALLO_DEFINITIVO,
  FALLO_AMBIGUO,
  claveDedupe,
  clavesLectura,
  claveAvisoEmails,
  clasificarFalloGls,
  ttlDelRegistro,
  registroEnCurso,
  esEnCurso,
} from '../src/pedidos.js';
import { parseReturnOrderResponse } from '../src/gls.js';

// --- Claves ------------------------------------------------------------------------------
//
// Las dos rutas de pago (bizum por /api/notify-order, tarjeta por /api/confirm-payment)
// tienen que caer en la MISMA clave: si no, un pedido que pase por las dos crea dos
// devoluciones GLS de verdad, con dos etiquetas facturables.

test('claveDedupe es la misma en las dos rutas cuando hay orderId', () => {
  const desdeBizum = claveDedupe('GLS-1', null);
  const desdeTarjeta = claveDedupe('GLS-1', 'cs_test_abc');
  assert.equal(desdeBizum, desdeTarjeta);
  assert.equal(desdeBizum, 'order:GLS-1');
});

test('claveDedupe cae a la sesión de Stripe si la sesión no trae orderId', () => {
  assert.equal(claveDedupe(undefined, 'cs_test_abc'), 'session:cs_test_abc');
  assert.equal(claveDedupe('', 'cs_test_abc'), 'session:cs_test_abc');
});

test('claveDedupe devuelve null sin orderId ni sesión, en vez de una clave compartida', () => {
  // "order:undefined" sería una clave común a todos los pedidos sin referencia: el segundo
  // pedido leería el resultado del primero y se quedaría sin devolución.
  assert.equal(claveDedupe(undefined, undefined), null);
});

test('clavesLectura mira la clave de pedido y luego la clave de sesión antigua', () => {
  // Los pedidos guardados antes de unificar las claves siguen vivos en KV hasta 90 días.
  assert.deepEqual(clavesLectura('GLS-1', 'cs_test_abc'), ['order:GLS-1', 'session:cs_test_abc']);
});

test('clavesLectura omite las claves que no se pueden construir y no repite ninguna', () => {
  assert.deepEqual(clavesLectura('GLS-1', null), ['order:GLS-1']);
  assert.deepEqual(clavesLectura(null, 'cs_test_abc'), ['session:cs_test_abc']);
  assert.deepEqual(clavesLectura(null, null), []);
});

test('claveAvisoEmails vive en su propio prefijo, separada de la deduplicación', () => {
  assert.equal(claveAvisoEmails('GLS-1'), 'emails:GLS-1');
  assert.equal(claveAvisoEmails(''), null);
});

// --- Clasificación del fallo de GLS -------------------------------------------------------
//
// Reintentar una devolución que GLS pudo haber creado es exactamente como se acaba con dos
// etiquetas facturables. Solo se marca como definitivo lo que demuestra que no se creó nada.

test('un 4xx de GLS es un fallo definitivo: rechazó la petición sin crear nada', () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    const error = Object.assign(new Error(`HTTP ${status}`), { httpStatus: status });
    assert.equal(clasificarFalloGls(error), FALLO_DEFINITIVO, `status ${status}`);
  }
});

test('un 5xx de GLS es ambiguo: pudo caerse después de crear la devolución', () => {
  for (const status of [500, 502, 503, 504]) {
    const error = Object.assign(new Error(`HTTP ${status}`), { httpStatus: status });
    assert.equal(clasificarFalloGls(error), FALLO_AMBIGUO, `status ${status}`);
  }
});

test('un timeout o un abort son ambiguos: GLS pudo crear la devolución y no contestar', () => {
  const abortado = new Error('The operation was aborted');
  abortado.name = 'AbortError';
  assert.equal(clasificarFalloGls(abortado), FALLO_AMBIGUO);
});

test('un corte de red es ambiguo', () => {
  assert.equal(clasificarFalloGls(new TypeError('fetch failed')), FALLO_AMBIGUO);
});

test('una respuesta 2xx sin returnOrderId es ambigua: GLS aceptó la petición', () => {
  let error;
  try {
    parseReturnOrderResponse({});
  } catch (lanzado) {
    error = lanzado;
  }
  assert.ok(error, 'parseReturnOrderResponse tiene que lanzar sin returnOrderId');
  assert.equal(clasificarFalloGls(error), FALLO_AMBIGUO);
});

test('un error desconocido es ambiguo por defecto', () => {
  assert.equal(clasificarFalloGls(new Error('vete a saber')), FALLO_AMBIGUO);
  assert.equal(clasificarFalloGls(undefined), FALLO_AMBIGUO);
});

test('si la petición ni siquiera salió, el fallo es definitivo', () => {
  // buildReturnOrderRequest revienta con un pedido mal formado: no hubo llamada a GLS.
  const error = new TypeError("Cannot read properties of undefined (reading 'calle')");
  assert.equal(clasificarFalloGls(error, { peticionEnviada: false }), FALLO_DEFINITIVO);
});

// --- Caducidad ----------------------------------------------------------------------------

test('un éxito se guarda 90 días', () => {
  const ttl = ttlDelRegistro({ gls: { ok: true, trackId: 'Z1' } });
  assert.equal(ttl, TTL_EXITO_SEGUNDOS);
  assert.equal(TTL_EXITO_SEGUNDOS, 60 * 60 * 24 * 90);
});

test('un fallo definitivo caduca pronto para que un reintento pueda recuperarse', () => {
  const ttl = ttlDelRegistro({ gls: { ok: false, fallo: FALLO_DEFINITIVO } });
  assert.equal(ttl, TTL_FALLO_DEFINITIVO_SEGUNDOS);
  assert.ok(TTL_FALLO_DEFINITIVO_SEGUNDOS <= 60 * 60, 'tiene que caducar en menos de una hora');
  assert.ok(TTL_FALLO_DEFINITIVO_SEGUNDOS >= 60, 'KV no admite un expirationTtl menor de 60 s');
});

test('un fallo ambiguo se guarda 90 días: reintentarlo puede duplicar la etiqueta', () => {
  assert.equal(ttlDelRegistro({ gls: { ok: false, fallo: FALLO_AMBIGUO } }), TTL_EXITO_SEGUNDOS);
});

test('un fallo sin clase se guarda 90 días, como los pedidos guardados antes de clasificar', () => {
  assert.equal(ttlDelRegistro({ gls: { ok: false, error: 'lo que sea' } }), TTL_EXITO_SEGUNDOS);
});

test('la marca de "en curso" caduca sola en un minuto', () => {
  assert.equal(ttlDelRegistro(registroEnCurso()), TTL_EN_CURSO_SEGUNDOS);
  // 60 s es el mínimo que acepta KV y sobra para una llamada a GLS, que aborta a los 10 s.
  assert.equal(TTL_EN_CURSO_SEGUNDOS, 60);
});

test('ttlDelRegistro no revienta con un registro vacío', () => {
  assert.equal(ttlDelRegistro(null), TTL_EXITO_SEGUNDOS);
  assert.equal(ttlDelRegistro({}), TTL_EXITO_SEGUNDOS);
});

// --- Marca de "en curso" ------------------------------------------------------------------

test('registroEnCurso se reconoce y lleva la hora de arranque', () => {
  const marca = registroEnCurso(new Date('2026-09-09T10:00:00.000Z'));
  assert.equal(esEnCurso(marca), true);
  assert.equal(marca.startedAt, '2026-09-09T10:00:00.000Z');
});

test('un pedido ya resuelto no se confunde con una marca en curso', () => {
  assert.equal(esEnCurso({ gls: { ok: true }, processedAt: 'x' }), false);
  assert.equal(esEnCurso({ gls: { ok: false }, order: {}, processedAt: 'x' }), false);
  assert.equal(esEnCurso(null), false);
});
