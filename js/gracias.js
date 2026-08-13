// js/gracias.js
import { t } from './i18n.js';
import { buildOrderSummary } from './order.js';
import { confirmPayment } from './api.js';
import { API_BASE_URL } from './config.js';

const lang = localStorage.getItem('lang') || 'ca';
const titleEl = document.getElementById('gracias-title');
const messageEl = document.getElementById('gracias-message');
const orderIdEl = document.getElementById('gracias-order-id');
const summaryEl = document.getElementById('gracias-summary');

function render(titleKey, messageKey, orderId = '', summaryLines = []) {
  titleEl.textContent = t(lang, titleKey);
  messageEl.textContent = t(lang, messageKey);
  orderIdEl.textContent = orderId;
  summaryEl.replaceChildren(
    ...summaryLines.map((linea) => {
      const li = document.createElement('li');
      li.textContent = linea;
      return li;
    }),
  );
}

async function run() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  if (!sessionId) {
    render('gracias_title', 'gracias_not_paid');
    return;
  }

  render('gracias_title', 'gracias_pending');

  try {
    const result = await confirmPayment(API_BASE_URL, sessionId);
    if (result.paid) {
      const summaryLines = buildOrderSummary(result.order).lineas;
      render('gracias_title', 'gracias_paid', result.orderId, summaryLines);
    } else {
      render('gracias_title', 'gracias_not_paid');
    }
  } catch (error) {
    render('gracias_title', 'gracias_not_paid');
  }
}

run();
