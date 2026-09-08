// js/gracias.js
import { t } from './i18n.js';
import { buildOrderSummary } from './order.js';
import { confirmPayment } from './api.js';
import { API_BASE_URL, GLS_PORTAL_URL, GLS_BUSCADOR_URL } from './config.js';
import { formatearPunto } from './punto-gls.js';

const lang = localStorage.getItem('lang') || 'ca';
const titleEl = document.getElementById('gracias-title');
const messageEl = document.getElementById('gracias-message');
const orderIdEl = document.getElementById('gracias-order-id');
const summaryEl = document.getElementById('gracias-summary');

function render(titleKey, messageKey, orderId = '', summaryLines = [], gls = null) {
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
  renderGls(gls);
}

function crearBloquePunto(punto) {
  const bloque = document.createElement('div');
  bloque.className = 'punto-gls';

  const titulo = document.createElement('h3');
  titulo.textContent = t(lang, 'gls_punto_title');
  bloque.append(titulo);

  const nombre = document.createElement('p');
  nombre.className = 'punto-nombre';
  nombre.textContent = punto.distancia ? `${punto.nombre} · ${punto.distancia}` : punto.nombre;
  bloque.append(nombre);

  const direccion = document.createElement('p');
  direccion.textContent = punto.direccion;
  bloque.append(direccion);

  if (punto.telefono) {
    const telefono = document.createElement('p');
    telefono.textContent = `${t(lang, 'gls_punto_telefono')}: ${punto.telefono}`;
    bloque.append(telefono);
  }

  if (punto.horarios.length > 0) {
    const horarioTitulo = document.createElement('p');
    horarioTitulo.className = 'punto-horario-title';
    horarioTitulo.textContent = t(lang, 'gls_punto_horario');
    const lista = document.createElement('ul');
    lista.className = 'punto-horarios';
    for (const dia of punto.horarios) {
      const li = document.createElement('li');
      const nombreDia = document.createElement('span');
      nombreDia.className = 'punto-dia';
      nombreDia.textContent = t(lang, `dia_${dia.weekday}`);
      const tramos = document.createElement('span');
      tramos.textContent = dia.tramos;
      li.append(nombreDia, tramos);
      lista.append(li);
    }
    bloque.append(horarioTitulo, lista);
  }

  return bloque;
}

function crearEnlaceBuscador() {
  const enlace = document.createElement('a');
  enlace.className = 'punto-otros';
  enlace.href = GLS_BUSCADOR_URL;
  enlace.target = '_blank';
  enlace.rel = 'noopener';
  enlace.textContent = t(lang, 'gls_punto_otros');
  return enlace;
}

function renderGls(gls) {
  const contenedor = document.getElementById('gracias-gls');
  if (!contenedor) return;
  contenedor.replaceChildren();
  contenedor.classList.remove('gls-manual');
  if (!gls) return;

  if (gls.ok) {
    const aviso = document.createElement('p');
    aviso.textContent = t(lang, 'gls_etiqueta_enviada');
    const referencia = document.createElement('p');
    referencia.textContent = `${t(lang, 'gls_referencia')}: ${gls.trackId}`;
    contenedor.append(aviso, referencia);

    // El buscador se pinta siempre: aunque GLS no haya devuelto punto, el cliente sigue
    // necesitando saber dónde dejar el paquete.
    const punto = formatearPunto(gls.dropOffLocation);
    if (punto) contenedor.append(crearBloquePunto(punto));
    contenedor.append(crearEnlaceBuscador());
    return;
  }

  // En la ruta de fallo este enlace es la única acción de recuperación que le queda a alguien
  // que ya ha pagado, así que se pinta como botón primario igual que en el modal.
  contenedor.classList.add('gls-manual');

  const titulo = document.createElement('h3');
  titulo.textContent = t(lang, 'gls_manual_title');
  const descripcion = document.createElement('p');
  descripcion.textContent = t(lang, 'gls_manual_desc');
  const enlace = document.createElement('a');
  enlace.className = 'btn btn-primary';
  enlace.href = gls.portalUrl || GLS_PORTAL_URL;
  enlace.target = '_blank';
  enlace.rel = 'noopener';
  enlace.textContent = t(lang, 'gls_manual_link');
  contenedor.append(titulo, descripcion, enlace);
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
      const summaryLines = buildOrderSummary({ ...result.order, gls: result.gls }).lineas;
      render('gracias_title', 'gracias_paid', result.orderId, summaryLines, result.gls);
    } else {
      render('gracias_title', 'gracias_not_paid');
    }
  } catch (error) {
    console.error(error);
    render('gracias_title', 'gracias_not_paid');
  }
}

run();
