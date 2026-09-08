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

function direccionHtml(direccion) {
  return [
    `<li>Dirección: ${escapeHtml(direccion.calle)} ${escapeHtml(direccion.numero)}</li>`,
    `<li>Código postal: ${escapeHtml(direccion.codigoPostal)}</li>`,
    `<li>Ciudad: ${escapeHtml(direccion.ciudad)}</li>`,
    `<li>País: ${escapeHtml(direccion.pais)}</li>`,
  ].join('\n');
}

function glsHtmlPropietario(gls) {
  if (gls && gls.ok) {
    return `<li>Devolución GLS: ${escapeHtml(gls.trackId)} <small>(id ${escapeHtml(gls.returnOrderId)})</small></li>`;
  }
  return `<li><strong>⚠️ No se pudo crear la devolución GLS automáticamente — el cliente ha recibido instrucciones manuales.</strong> Motivo: ${escapeHtml(gls?.error ?? 'desconocido')}</li>`;
}

// Punto de entrega que GLS asigna al crear la devolución. El formateo está duplicado a
// propósito de js/punto-gls.js: worker/ se despliega solo (wrangler, su propio package.json)
// y no puede depender de la carpeta js/ del sitio estático. Si cambian las reglas de formato,
// hay que tocar los dos ficheros.
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

// Todo lo que hay aquí dentro viene de la API de GLS, así que todo pasa por escapeHtml.
function puntoHtml(punto) {
  if (!punto || !punto.name) return '';

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
      const tramos = (dia.hours ?? [])
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
      <li>País: ${escapeHtml(direccion.pais)}</li>
    </ul>
    <p><a href="${escapeHtml(gls?.portalUrl ?? '')}">Abrir el portal de GLS</a></p>
  `;
}

// `cantidad` tambien se escapa: el formulario solo produce enteros, pero /api/notify-order no
// tiene autenticacion y acepta cualquier cuerpo, asi que aqui no es un numero de confianza.
function formatearLineaCarrito(linea) {
  const subtotal = linea.precioSubtotal.toFixed(2);
  const cantidad = escapeHtml(linea.cantidad);
  if (linea.descripcion) {
    return `${escapeHtml(linea.descripcion)} ×${cantidad} — ${subtotal}€`;
  }
  const variante = linea.material ? ` (${escapeHtml(linea.material)})` : '';
  return `${escapeHtml(linea.tipoCalzado)} · ${escapeHtml(linea.servicio)}${variante} ×${cantidad} — ${subtotal}€`;
}

function lineasCarritoHtml(orderPayload) {
  const lineas = orderPayload.carrito.map((linea) => `<li>${formatearLineaCarrito(linea)}</li>`);
  if (orderPayload.transporte > 0) {
    lineas.push(`<li>Envío GLS: ${orderPayload.transporte.toFixed(2)}€</li>`);
  }
  return lineas.join('\n');
}

export function buildOwnerEmail(orderPayload, ownerEmail, gls) {
  const { orderId, precioTotal, nombre, direccion, telefono, email, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [ownerEmail],
    subject: `Nuevo pedido ${orderId}`,
    html: `
      <h2>Nuevo pedido ${escapeHtml(orderId)}</h2>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Nombre: ${escapeHtml(nombre)}</li>
        ${direccionHtml(direccion)}
        <li>Teléfono: ${escapeHtml(telefono)}</li>
        <li>Email: ${escapeHtml(email)}</li>
        <li>Pago: ${escapeHtml(metodoPago)}</li>
        ${glsHtmlPropietario(gls)}
      </ul>
    `,
  };
}

export function buildCustomerEmail(orderPayload, customerEmailAddress, gls) {
  const { orderId, precioTotal, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [customerEmailAddress],
    subject: `Hemos recibido tu pedido ${orderId} — Grip La Seu`,
    html: `
      <h2>¡Gracias por tu pedido!</h2>
      <p>Referencia: <strong>${escapeHtml(orderId)}</strong></p>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Pago: ${escapeHtml(metodoPago)}</li>
      </ul>
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
