import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutSession, notifyOrder, confirmPayment } from '../js/api.js';

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
