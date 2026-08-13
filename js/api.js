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
