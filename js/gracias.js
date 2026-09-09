// js/gracias.js
import { t } from './i18n.js';
import { buildOrderSummary } from './order.js';
import { confirmPayment } from './api.js';
import { API_BASE_URL, GLS_PORTAL_URL, GLS_BUSCADOR_URL } from './config.js';
import { resolverPunto } from './punto-gls.js';

const lang = localStorage.getItem('lang') || 'ca';
const titleEl = document.getElementById('gracias-title');
const messageEl = document.getElementById('gracias-message');
const summaryEl = document.getElementById('gracias-summary');

// El recibo se pinta con createElement/textContent, nunca con innerHTML: aquí dentro hay
// nombre, dirección y teléfono tal y como los tecleó el cliente.
function crearFila(fila) {
  const contenedor = document.createElement('div');
  contenedor.className = `recibo-fila recibo-fila--${fila.tipo}`;

  const etiqueta = document.createElement('dt');
  etiqueta.className = 'recibo-etiqueta';
  etiqueta.textContent = fila.etiqueta;

  const valor = document.createElement('dd');
  valor.className = 'recibo-valor';
  valor.textContent = fila.valor;

  contenedor.append(etiqueta, valor);
  return contenedor;
}

function crearSeccion(seccion) {
  const bloque = document.createElement('div');
  bloque.className = 'recibo-seccion';

  const titulo = document.createElement('h3');
  titulo.className = 'recibo-seccion-title';
  titulo.textContent = seccion.titulo;

  const filas = document.createElement('dl');
  filas.className = 'recibo-filas';
  filas.append(...seccion.filas.map(crearFila));

  bloque.append(titulo, filas);
  return bloque;
}

// La referencia del pedido es la primera fila del recibo y no se repite como titular; la de la
// devolución GLS la pinta renderGls(), pegada al aviso de la etiqueta.
function render(titleKey, messageKey, secciones = [], gls = null) {
  titleEl.textContent = t(lang, titleKey);
  messageEl.textContent = t(lang, messageKey);
  summaryEl.replaceChildren(...secciones.map(crearSeccion));
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

// GLS a veces asigna un punto que sus propios datos declaran incapaz de aceptar devoluciones.
// Ese punto no se pinta: ni nombre ni dirección, solo este aviso y el enlace al buscador.
function crearAvisoSinDevoluciones() {
  const aviso = document.createElement('p');
  aviso.className = 'punto-aviso';
  aviso.textContent = t(lang, 'gls_punto_no_devoluciones');
  return aviso;
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
  contenedor.classList.remove('gls-result', 'gls-manual');
  if (!gls) return;
  contenedor.classList.add('gls-result');

  if (gls.ok) {
    const aviso = document.createElement('p');
    aviso.textContent = t(lang, 'gls_etiqueta_enviada');
    const referencia = document.createElement('p');
    referencia.textContent = `${t(lang, 'gls_referencia')}: ${gls.trackId}`;
    contenedor.append(aviso, referencia);

    // El buscador se pinta siempre: aunque GLS no haya devuelto punto —o haya devuelto uno
    // que no admite devoluciones—, el cliente sigue necesitando saber dónde dejar el paquete.
    const { punto, noAdmiteDevoluciones } = resolverPunto(
      gls.dropOffLocation,
      t(lang, 'gls_punto_24h'),
    );
    if (punto) contenedor.append(crearBloquePunto(punto));
    else if (noAdmiteDevoluciones) contenedor.append(crearAvisoSinDevoluciones());
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
      const { secciones } = buildOrderSummary(result.order, lang);
      render('gracias_title', 'gracias_paid', secciones, result.gls);
    } else {
      render('gracias_title', 'gracias_not_paid');
    }
  } catch (error) {
    console.error(error);
    render('gracias_title', 'gracias_error');
  }
}

run();
