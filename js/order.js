import { t } from './i18n.js';
import { GLS_MOTIVO_DEVOLUCION } from './config.js';

export function generateOrderId(now = new Date(), randomFn = Math.random) {
  const datePart = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const randomPart = Math.floor(randomFn() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `GLS-${datePart}-${randomPart}`;
}

// Nombres del catálogo. Las claves ya existen en js/i18n.js y son las mismas que pinta el
// formulario, así que el recibo llama a cada servicio exactamente igual que la calculadora.
//
// worker/src/catalogo.js replica esto a mano en castellano: worker/ se despliega solo y no
// puede importar de js/. Si aquí se añade un servicio, un tipo de calzado o un material, hay
// que añadirlo allí también o el nombre del producto en Stripe y el email se quedarán atrás.
const CLAVES_SERVICIO = {
  resolado_completo: 'service_resolado_completo_title',
  media_suela: 'service_media_suela_title',
  puntera: 'service_puntera_title',
};

const CLAVES_TIPO_CALZADO = {
  bota: 'tipo_bota',
  pie_de_gato: 'tipo_pie_de_gato',
};

const CLAVES_MATERIAL = {
  vibram_xs_grip2: 'material_vibram_xs_grip2',
  vibram_xs_grip_edge: 'material_vibram_xs_grip_edge',
};

const CLAVES_PAIS = {
  ES: 'pais_es',
  PT: 'pais_pt',
};

const CLAVES_METODO_PAGO = {
  tarjeta: 'pago_tarjeta',
  bizum: 'pago_bizum',
  transferencia: 'pago_transferencia',
};

// Red de seguridad, no traducción. t() devuelve la clave cuando no la encuentra, así que
// traducir a ciegas un identificador desconocido pintaría "service_lo_que_sea_title" en la
// cara del cliente. Antes de traducir se comprueba que la clave existe; si no, se humaniza.
export function humanizarIdentificador(valor) {
  if (!valor) return '';
  const texto = String(valor).replace(/_/g, ' ').trim();
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function traducirIdentificador(claves, identificador, lang) {
  if (!identificador) return '';
  return Object.hasOwn(claves, identificador)
    ? t(lang, claves[identificador])
    : humanizarIdentificador(identificador);
}

// Dos formas de línea conviven en el carrito y las dos tienen que seguir funcionando: la ruta
// de bizum/transferencia manda la línea estructurada, y la de tarjeta la reconstruye desde
// Stripe con la descripción ya montada por el Worker. Esa descripción se pinta tal cual: ya
// está en palabras, y el Worker no sabe en qué idioma navega el cliente.
export function describirLineaCarrito(linea, lang) {
  if (linea.descripcion) return linea.descripcion;
  return [
    traducirIdentificador(CLAVES_SERVICIO, linea.servicio, lang),
    traducirIdentificador(CLAVES_TIPO_CALZADO, linea.tipoCalzado, lang),
    traducirIdentificador(CLAVES_MATERIAL, linea.material, lang),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function nombrePais(codigo, lang) {
  if (!codigo) return '';
  return Object.hasOwn(CLAVES_PAIS, codigo) ? t(lang, CLAVES_PAIS[codigo]) : String(codigo);
}

export function nombreMetodoPago(metodo, lang) {
  return traducirIdentificador(CLAVES_METODO_PAGO, metodo, lang);
}

function euros(importe) {
  return `${importe.toFixed(2)}€`;
}

function fila(etiqueta, valor, tipo = 'dato') {
  return { etiqueta, valor, tipo };
}

// El artículo ocupa la columna izquierda del recibo pero no es una etiqueta: es contenido, y
// se pinta con el mismo peso que el precio. De ahí el tipo, que los tres sitios que pintan el
// recibo usan para elegir la clase.
export function formatearLineaCarrito(linea, lang) {
  return fila(
    `${describirLineaCarrito(linea, lang)} ×${linea.cantidad}`,
    euros(linea.precioSubtotal),
    'articulo',
  );
}

function seccionPedido(orderPayload, lang) {
  const { orderId, carrito, transporte, precioTotal } = orderPayload;
  const filas = [
    fila(t(lang, 'recibo_referencia_label'), orderId),
    ...carrito.map((linea) => formatearLineaCarrito(linea, lang)),
  ];
  if (transporte > 0) {
    filas.push(fila(t(lang, 'envio_gls_label'), euros(transporte)));
  }
  filas.push(fila(t(lang, 'precio_total_label'), euros(precioTotal), 'total'));
  return { titulo: t(lang, 'recibo_pedido_title'), filas };
}

function seccionEntrega(orderPayload, lang) {
  const { nombre, direccion, telefono, email } = orderPayload;
  return {
    titulo: t(lang, 'recibo_entrega_title'),
    filas: [
      fila(t(lang, 'nombre_label'), nombre),
      fila(t(lang, 'direccion_label'), `${direccion.calle} ${direccion.numero}`),
      fila(t(lang, 'cp_label'), direccion.codigoPostal),
      fila(t(lang, 'ciudad_label'), direccion.ciudad),
      fila(t(lang, 'pais_label'), nombrePais(direccion.pais, lang)),
      fila(t(lang, 'telefono_label'), telefono),
      fila(t(lang, 'email_label'), email),
    ],
  };
}

function seccionPago(orderPayload, lang) {
  return {
    titulo: t(lang, 'recibo_pago_title'),
    filas: [fila(t(lang, 'pago_label'), nombreMetodoPago(orderPayload.metodoPago, lang))],
  };
}

// El recibo es una lista de secciones de filas etiqueta/valor, no un montón de cadenas planas:
// los tres sitios que lo pintan (el modal de index.html, js/gracias.js y el email del Worker)
// necesitan las dos columnas por separado para poder maquetarlas.
//
// La referencia de la devolución GLS NO sale de aquí: la pinta el bloque de GLS, pegada al
// aviso de la etiqueta y al punto de entrega, que es donde el cliente la busca.
export function buildOrderSummary(orderPayload, lang) {
  return {
    orderId: orderPayload.orderId,
    secciones: [
      seccionPedido(orderPayload, lang),
      seccionEntrega(orderPayload, lang),
      seccionPago(orderPayload, lang),
    ],
  };
}

// Modo B: GLS no ha podido crear la devolución y el cliente tiene que crearla él en el portal.
// Estas son las filas que copia campo a campo en el formulario del portal.
//
// Las etiquetas NO se traducen, y por eso esta función no recibe lang: nombran los campos del
// formulario de GLS, que está en castellano. Traducirlas mandaría a un cliente inglés a buscar
// "Postcode" en una página que dice "Código postal". El texto que rodea a la lista
// (gls_manual_title, gls_manual_desc, gls_manual_link, btn_copiar/btn_copiado) sí está traducido.
//
// El motivo lo elige el Worker (GLS_RETURN_REASON) y viaja en gls.returnReason: escribirlo
// aquí a mano haría que cambiar la variable dejara al cliente eligiendo otra opción del
// desplegable del portal. Si la respuesta no lo trae, se cae al respaldo de js/config.js.
//
// Los campos vacíos no se pintan: un botón "Copiar" que copia una cadena vacía y luego dice
// "Copiado" miente, y la fila no le da al cliente nada que pegar.
export function buildDatosPortal(orderPayload, motivoDevolucion) {
  const { orderId, nombre, email } = orderPayload ?? {};
  const direccion = orderPayload?.direccion ?? {};
  return [
    ['Número de pedido', orderId],
    ['Motivo de devolución', motivoDevolucion || GLS_MOTIVO_DEVOLUCION],
    ['Nombre', nombre],
    ['Correo electrónico', email],
    ['Calle', direccion.calle],
    ['Número', direccion.numero],
    ['Código postal', direccion.codigoPostal],
    ['Ciudad', direccion.ciudad],
    ['País', direccion.pais],
  ]
    .map(([etiqueta, valor]) => ({ etiqueta, valor: String(valor ?? '').trim() }))
    .filter((dato) => dato.valor !== '');
}
