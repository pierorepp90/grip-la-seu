// js/gracias.js
import { t } from './i18n.js';
import { buildOrderSummary, buildDatosPortal } from './order.js';
import { confirmPayment } from './api.js';
import { API_BASE_URL, GLS_PORTAL_URL, GLS_BUSCADOR_URL } from './config.js';
import { resolverPunto } from './punto-gls.js';
import { copiarAlPortapapeles, MS_CONFIRMACION_COPIADO } from './portapapeles.js';

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
//
// El pedido llega hasta renderGls() porque en modo B hay que pintar los datos que el cliente
// tiene que copiar en el portal, y salen de ahí.
function render(titleKey, messageKey, secciones = [], gls = null, order = null) {
  titleEl.textContent = t(lang, titleKey);
  messageEl.textContent = t(lang, messageKey);
  summaryEl.replaceChildren(...secciones.map(crearSeccion));
  renderGls(gls, order);
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

// El mismo botón que el modal de index.html: dice "Copiado" y vuelve solo a los dos segundos,
// y solo lo dice si se ha copiado de verdad.
function crearBotonCopiar(valor) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn btn-secondary';
  boton.textContent = t(lang, 'btn_copiar');

  let temporizador = null;
  boton.addEventListener('click', async () => {
    if (!(await copiarAlPortapapeles(valor))) return;
    boton.textContent = t(lang, 'btn_copiado');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      boton.textContent = t(lang, 'btn_copiar');
    }, MS_CONFIRMACION_COPIADO);
  });

  return boton;
}

// La lista de datos del portal, la misma que pinta el modal de index.html y con las mismas
// clases. Las etiquetas van en castellano a propósito: nombran los campos del formulario de
// GLS (ver js/order.js).
function crearListaDatos(datos) {
  const lista = document.createElement('ul');
  lista.className = 'copy-list';

  for (const dato of datos) {
    const li = document.createElement('li');

    const etiqueta = document.createElement('span');
    etiqueta.className = 'copy-label';
    etiqueta.textContent = dato.etiqueta;

    const valor = document.createElement('span');
    valor.className = 'copy-value';
    valor.textContent = dato.valor;

    li.append(etiqueta, valor, crearBotonCopiar(dato.valor));
    lista.append(li);
  }

  return lista;
}

function renderGls(gls, order = null) {
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

  // En la ruta de fallo el portal es la única acción de recuperación que le queda a alguien que
  // ya ha pagado, así que se pinta igual que en el modal: el enlace como botón primario y los
  // datos que hay que copiar en él. Fiarlo todo al email de GLS —o al nuestro, que también es
  // best-effort— sería apoyarse justo en lo que este modo B existe para suplir.
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
  const lista = crearListaDatos(buildDatosPortal(order, gls.returnReason));
  contenedor.append(titulo, descripcion, lista, enlace);
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
      render('gracias_title', 'gracias_paid', secciones, result.gls, result.order);
    } else {
      render('gracias_title', 'gracias_not_paid');
    }
  } catch (error) {
    console.error(error);
    render('gracias_title', 'gracias_error');
  }
}

run();
