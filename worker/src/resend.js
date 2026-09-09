import { describirLinea, nombrePais, nombreMetodoPago } from './catalogo.js';

const FROM_ADDRESS = 'Grip La Seu <pedidos@griplaseu.es>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

// --- Recibo -------------------------------------------------------------------------------
//
// Mismo recibo que pinta el sitio (js/order.js → buildOrderSummary): las mismas secciones, en
// el mismo orden, con los mismos nombres. Aquí se monta a mano porque worker/ se despliega
// solo y no puede importar de js/, y porque un email no es una página: hace falta una tabla
// con estilos en línea para que Gmail y Outlook respeten las dos columnas.
//
// El email es solo en castellano por diseño.

const ESTILO_TABLA = 'width:100%;border-collapse:collapse;margin:0 0 20px;';
const ESTILO_ETIQUETA = 'padding:6px 12px 6px 0;color:#6b7899;font-size:13px;text-align:left;vertical-align:top;';
const ESTILO_ARTICULO = 'padding:6px 12px 6px 0;color:#0b1b33;font-size:14px;text-align:left;vertical-align:top;';
const ESTILO_VALOR = 'padding:6px 0;color:#0b1b33;font-weight:600;text-align:right;white-space:nowrap;vertical-align:top;';
const ESTILO_TOTAL =
  'padding:10px 0 6px;color:#0b1b33;font-weight:700;font-size:16px;text-align:right;white-space:nowrap;vertical-align:top;border-top:1px solid #e4e0d4;';
const ESTILO_TOTAL_ETIQUETA =
  'padding:10px 12px 6px 0;color:#0b1b33;font-weight:700;font-size:16px;text-align:left;vertical-align:top;border-top:1px solid #e4e0d4;';
const ESTILO_SECCION = 'margin:24px 0 8px;font-size:13px;text-transform:uppercase;color:#6b7899;';

function fila(etiqueta, valor, tipo = 'dato') {
  return { etiqueta, valor, tipo };
}

// Todo lo que entra en una fila se escapa, sin excepción: el nombre y la dirección los teclea
// el cliente, la cantidad llega sin validar por /api/notify-order, y el servicio, el tipo de
// calzado y el material también, porque ese endpoint no está autenticado y acepta cualquier
// cuerpo. Las etiquetas fijas son nuestras, pero pasan por el mismo sitio para que no haya que
// acordarse de cuál es cuál.
function filaHtml({ etiqueta, valor, tipo }) {
  const estiloEtiqueta =
    tipo === 'total' ? ESTILO_TOTAL_ETIQUETA : tipo === 'articulo' ? ESTILO_ARTICULO : ESTILO_ETIQUETA;
  const estiloValor = tipo === 'total' ? ESTILO_TOTAL : ESTILO_VALOR;
  return `<tr><td style="${estiloEtiqueta}">${escapeHtml(etiqueta)}</td><td style="${estiloValor}">${escapeHtml(valor)}</td></tr>`;
}

function seccionHtml(titulo, filas) {
  return `
      <h3 style="${ESTILO_SECCION}">${escapeHtml(titulo)}</h3>
      <table role="presentation" cellpadding="0" cellspacing="0" style="${ESTILO_TABLA}">
        ${filas.map(filaHtml).join('\n        ')}
      </table>`;
}

function euros(importe) {
  return `${importe.toFixed(2)}€`;
}

function filasPedido(orderPayload, etiquetaReferencia) {
  const { orderId, carrito, transporte, precioTotal } = orderPayload;
  const filas = [
    fila(etiquetaReferencia, orderId),
    ...carrito.map((linea) =>
      fila(`${describirLinea(linea)} ×${linea.cantidad}`, euros(linea.precioSubtotal), 'articulo'),
    ),
  ];
  if (transporte > 0) {
    filas.push(fila('Envío GLS', euros(transporte)));
  }
  filas.push(fila('Precio total', euros(precioTotal), 'total'));
  return filas;
}

function filasEntrega(orderPayload) {
  const { nombre, direccion, telefono, email } = orderPayload;
  return [
    fila('Nombre', nombre),
    fila('Dirección', `${direccion.calle} ${direccion.numero}`),
    fila('Código postal', direccion.codigoPostal),
    fila('Ciudad', direccion.ciudad),
    fila('País', nombrePais(direccion.pais)),
    fila('Teléfono', telefono),
    fila('Email', email),
  ];
}

function filasPago(orderPayload) {
  return [fila('Método de pago', nombreMetodoPago(orderPayload.metodoPago))];
}

function glsHtmlPropietario(gls) {
  if (gls && gls.ok) {
    return seccionHtml('Devolución GLS', [
      fila('Referencia', `${gls.trackId} (id ${gls.returnOrderId})`),
    ]);
  }
  return `
      <p style="border-left:3px solid #f0a83c;background:#fff7ea;padding:12px 16px;">
      <strong>⚠️ No se pudo crear la devolución GLS automáticamente — el cliente ha recibido
      instrucciones manuales.</strong> Motivo: ${escapeHtml(gls?.error ?? 'desconocido')}</p>`;
}

// Punto de entrega que GLS asigna al crear la devolución. El formateo, la regla de qué punto
// es utilizable y el colapso de los días abiertos 24 h están duplicados a propósito de
// js/punto-gls.js: worker/ se despliega solo (wrangler, su propio package.json) y no puede
// depender de la carpeta js/ del sitio estático. Si cambian, hay que tocar los dos ficheros.
const BUSCADOR_GLS_URL = 'https://www.gls-spain.es/es/parcel-shops/';

const DIAS_ES = {
  MON: 'Lunes',
  TUE: 'Martes',
  WED: 'Miércoles',
  THU: 'Jueves',
  FRI: 'Viernes',
  SAT: 'Sábado',
  SUN: 'Domingo',
};

// Se redondea antes de elegir unidad: si no, 0.9996 km cae en la rama de metros y se pinta
// como "1000 m" en vez de "1.0 km".
function formatearDistancia(km) {
  if (typeof km !== 'number' || Number.isNaN(km)) return null;
  const metros = Math.round(km * 1000);
  if (metros < 1000) return `${metros} m`;
  return `${(metros / 1000).toFixed(1)} km`;
}

// Espejo de aceptaDevoluciones() en js/punto-gls.js. GLS asigna a veces un punto que sus
// propios datos declaran incapaz de aceptar devoluciones (verificado en producción con un
// locker de Castelldefels). Se decide por capacidades, no por `type`, y se exige la 'Y'
// literal: sin el dato, el punto se descarta.
function aceptaDevoluciones(punto) {
  const capacidades = punto?.parcelHandlingRestriction;
  if (!capacidades) return false;
  return capacidades.offersReturnDropOff === 'Y' && capacidades.offersPrepaidParcelDropOff === 'Y';
}

// Espejo de cubreElDia() en js/punto-gls.js. GLS expresa un punto abierto 24/7 como dos tramos
// pegados por día (00:00–14:00 y 14:00–23:59); pintados literalmente son seis líneas casi
// idénticas de ruido.
function enMinutos(hora) {
  const partes = /^(\d{1,2}):(\d{2})$/.exec(String(hora));
  if (!partes) return null;
  return Number(partes[1]) * 60 + Number(partes[2]);
}

function cubreElDia(hours) {
  if (!Array.isArray(hours) || hours.length === 0) return false;
  const tramos = hours.map((tramo) => [enMinutos(tramo.openingTime), enMinutos(tramo.closingTime)]);
  if (tramos.some(([inicio, fin]) => inicio === null || fin === null)) return false;

  let alcance = 0;
  for (const [inicio, fin] of [...tramos].sort((a, b) => a[0] - b[0])) {
    if (inicio > alcance) return false;
    alcance = Math.max(alcance, fin === 0 ? 1440 : fin);
  }
  return alcance >= 1439;
}

// El email es solo en castellano por diseño; el equivalente traducido de este aviso vive en
// js/i18n.js bajo la clave gls_punto_no_devoluciones.
const AVISO_SIN_DEVOLUCIONES =
  '<p>El punto más cercano que ha asignado GLS no admite devoluciones. Elige otro en el ' +
  'buscador de puntos GLS.</p>';

// Todo lo que hay aquí dentro viene de la API de GLS, así que todo pasa por escapeHtml.
function puntoHtml(punto) {
  if (!punto || !punto.name) return '';

  // Del punto rechazado no sale ni un dato al email: no queremos que nadie camine hasta un
  // sitio que le va a rechazar el paquete.
  if (!aceptaDevoluciones(punto)) return AVISO_SIN_DEVOLUCIONES;

  const direccion = punto.address ?? {};
  const localidad = [direccion.zipCode, direccion.city].filter(Boolean).join(' ');
  const senas = [direccion.street, localidad].filter(Boolean).join(', ');
  const distancia = formatearDistancia(punto.distance);
  const telefono = punto.externalContactDetails?.phone;

  const horarios = (punto.openingDays ?? [])
    .map((dia) => {
      // hasOwn y no DIAS_ES[dia.weekday]: un weekday como "toString" devolvería una función.
      const nombreDia = Object.hasOwn(DIAS_ES, dia.weekday)
        ? DIAS_ES[dia.weekday]
        : escapeHtml(dia.weekday);
      const tramos = cubreElDia(dia.hours)
        ? 'Abierto 24 h'
        : (dia.hours ?? [])
            .map((tramo) => `${escapeHtml(tramo.openingTime)}–${escapeHtml(tramo.closingTime)}`)
            .join(', ');
      return `<li>${nombreDia}: ${tramos}</li>`;
    })
    .join('\n');

  return `
    <h3>Dónde dejar el paquete</h3>
    <p><strong>${escapeHtml(punto.name)}</strong>${distancia ? ` · ${escapeHtml(distancia)}` : ''}</p>
    ${senas ? `<p>${escapeHtml(senas)}</p>` : ''}
    ${telefono ? `<p>Teléfono: ${escapeHtml(telefono)}</p>` : ''}
    ${horarios ? `<p>Horario:</p>\n    <ul>\n${horarios}\n    </ul>` : ''}
  `;
}

function glsHtmlCliente(orderPayload, gls) {
  if (gls && gls.ok) {
    return `
      <p><strong>GLS te ha enviado</strong> un email aparte con tu etiqueta de envío y el código QR
      para dejar el paquete en tu punto GLS más cercano.</p>
      <p>Referencia de la devolución: <strong>${escapeHtml(gls.trackId)}</strong></p>
      ${puntoHtml(gls.dropOffLocation)}
      <p><a href="${BUSCADOR_GLS_URL}">Ver otros puntos GLS</a></p>
    `;
  }
  const { orderId, nombre, email, direccion } = orderPayload;
  return `
    <h3>Crea tu etiqueta de envío</h3>
    <p><strong>Antes de nada:</strong> revisa si te ha llegado un email de GLS con tu etiqueta. Si
    lo tienes, ignora el resto de este mensaje — la etiqueta ya existe y no hace falta crear otra.</p>
    <p>Si no te ha llegado, créala tú en el portal de GLS —tarda menos de un minuto— con estos
    datos:</p>
    <ul>
      <li>Número de pedido: <strong>${escapeHtml(orderId)}</strong></li>
      <li>Motivo de devolución: Sin motivo específico</li>
      <li>Nombre: ${escapeHtml(nombre)}</li>
      <li>Correo electrónico: ${escapeHtml(email)}</li>
      <li>Calle: ${escapeHtml(direccion.calle)}</li>
      <li>Número: ${escapeHtml(direccion.numero)}</li>
      <li>Código postal: ${escapeHtml(direccion.codigoPostal)}</li>
      <li>Ciudad: ${escapeHtml(direccion.ciudad)}</li>
      <li>País: ${escapeHtml(nombrePais(direccion.pais))}</li>
    </ul>
    <p><a href="${escapeHtml(gls?.portalUrl ?? '')}">Abrir el portal de GLS</a></p>
  `;
}

export function buildOwnerEmail(orderPayload, ownerEmail, gls) {
  const { orderId } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [ownerEmail],
    subject: `Nuevo pedido ${orderId}`,
    html: `
      <h2>Nuevo pedido ${escapeHtml(orderId)}</h2>
      ${seccionHtml('Pedido', filasPedido(orderPayload, 'Referencia'))}
      ${seccionHtml('Entrega', filasEntrega(orderPayload))}
      ${seccionHtml('Pago', filasPago(orderPayload))}
      ${glsHtmlPropietario(gls)}
    `,
  };
}

export function buildCustomerEmail(orderPayload, customerEmailAddress, gls) {
  const { orderId } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [customerEmailAddress],
    subject: `Hemos recibido tu pedido ${orderId} — Grip La Seu`,
    html: `
      <h2>¡Gracias por tu pedido!</h2>
      ${seccionHtml('Tu pedido', filasPedido(orderPayload, 'Referencia'))}
      ${seccionHtml('Pago', filasPago(orderPayload))}
      ${glsHtmlCliente(orderPayload, gls)}
      <p>Nos pondremos en contacto contigo si necesitamos algo más.</p>
    `,
  };
}

export async function sendEmail(payload, apiKey, fetchFn = fetch) {
  const response = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Resend rechazó el envío del email');
  }
  return response.json();
}
