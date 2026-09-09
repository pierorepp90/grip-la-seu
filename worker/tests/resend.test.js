import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerEmail, buildCustomerEmail, sendEmail } from '../src/resend.js';

const orderPayload = {
  orderId: 'GLS-1',
  carrito: [
    {
      tipoCalzado: 'pie_de_gato',
      servicio: 'resolado_completo',
      material: 'vibram_xs_grip2',
      cantidad: 2,
      precioUnitario: 35,
      precioSubtotal: 70,
    },
  ],
  transporte: 5,
  precioTotal: 75,
  nombre: 'Ana Pérez',
  direccion: {
    calle: 'Carrer Major',
    numero: '12',
    codigoPostal: '25700',
    ciudad: "La Seu d'Urgell",
    pais: 'ES',
  },
  telefono: '+34612345678',
  email: 'ana@example.com',
  metodoPago: 'bizum',
};

// Forma real de dropOffLocation, copiada de una respuesta de producción de GLS.
const dropOffLocation = {
  name: 'PS GO PACK EXPRESS',
  type: 'SHOP',
  parcelHandlingRestriction: {
    offersParcelCollection: 'Y',
    offersReturnDropOff: 'Y',
    offersLabelPurchase: 'Y',
    offersPrepaidParcelDropOff: 'Y',
    offersLabellessDropOff: 'N',
  },
  distance: 0.18218337,
  address: {
    street: 'Carrer dels Canonges 52 bajos',
    city: "La Seu d'Urgell",
    zipCode: '25700',
    countryCode: 'ES',
  },
  externalContactDetails: { phone: '635106811' },
  openingDays: [
    { weekday: 'TUE', hours: [{ openingTime: '09:30', closingTime: '13:30' }] },
    { weekday: 'SAT', hours: [{ openingTime: '09:00', closingTime: '14:00' }] },
  ],
};

const glsOk = { ok: true, returnOrderId: 'RET-99', trackId: 'Z79MB8U2', dropOffLocation };
const glsOkSinPunto = { ...glsOk, dropOffLocation: null };

// Punto real que GLS asignó a un pedido de Castelldefels: un locker que, segun sus propios
// datos, no admite dejar devoluciones ni paquetes prepagados.
const lockerSinDevoluciones = {
  name: 'GLS Locker 24/7 MOEVE CASTELLDEFELS',
  type: 'LOCKER',
  parcelHandlingRestriction: {
    offersParcelCollection: 'Y',
    offersReturnDropOff: 'N',
    offersLabelPurchase: 'N',
    offersPrepaidParcelDropOff: 'N',
    offersLabellessDropOff: 'N',
  },
  distance: 0.17339578,
  address: { street: 'Carrer Granada 20', city: 'Castelldefels', zipCode: '08860', countryCode: 'ES' },
  openingDays: [{ weekday: 'MON', hours: [{ openingTime: '00:00', closingTime: '14:00' }] }],
};
const glsOkPuntoSinDevoluciones = { ...glsOk, dropOffLocation: lockerSinDevoluciones };
const glsFallo = {
  ok: false,
  error: 'HTTP 500',
  portalUrl: 'https://returns.gls-group.com/climberup/create-return',
};

test('buildOwnerEmail incluye el carrito, el envío y la dirección desglosada', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsOk);
  assert.deepEqual(email.to, ['owner@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Ana Pérez/);
  assert.match(email.html, /Resolado completo · Pie de gato · Vibram XS Grip2 ×2/);
  assert.match(email.html, /70\.00€/);
  assert.match(email.html, /Envío GLS/);
  assert.match(email.html, /5\.00€/);
  assert.match(email.html, /75\.00€/);
  assert.match(email.html, /Carrer Major 12/);
  assert.match(email.html, /25700/);
  assert.match(email.html, /La Seu d&#39;Urgell/);
  assert.match(email.html, /España/);
  assert.match(email.html, /Bizum/);
});

test('buildOwnerEmail muestra la referencia de la devolución cuando GLS respondió', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsOk);
  assert.match(email.html, /Devolución GLS/);
  assert.match(email.html, /Z79MB8U2/);
  assert.match(email.html, /id RET-99/);
  assert.doesNotMatch(email.html, /No se pudo crear/);
});

test('buildOwnerEmail avisa al propietario cuando GLS falló', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsFallo);
  assert.match(email.html, /No se pudo crear la devolución/);
  assert.match(email.html, /HTTP 500/);
});

test('buildOwnerEmail omite la línea de envío cuando el transporte es 0', () => {
  const email = buildOwnerEmail({ ...orderPayload, transporte: 0 }, 'owner@example.com', glsOk);
  assert.doesNotMatch(email.html, /Envío GLS/);
});

test('buildCustomerEmail en modo A remite a la etiqueta que envía GLS', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOk);
  assert.deepEqual(email.to, ['ana@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Resolado completo · Pie de gato · Vibram XS Grip2 ×2/);
  assert.match(email.html, /Z79MB8U2/);
  assert.match(email.html, /GLS te ha enviado/);
  assert.doesNotMatch(email.html, /returns\.gls-group\.com/);
});

test('buildCustomerEmail en modo B da el enlace al portal y los datos a copiar', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsFallo);
  assert.match(email.html, /returns\.gls-group\.com\/climberup\/create-return/);
  assert.match(email.html, /GLS-1/);
  assert.match(email.html, /Carrer Major/);
  assert.match(email.html, /25700/);
  assert.doesNotMatch(email.html, /GLS te ha enviado/);
  assert.doesNotMatch(email.html, /HTTP 500/);
});

test('sendEmail hace POST autenticado a Resend', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization, 'Bearer re_test_123');
    assert.equal(JSON.parse(options.body).subject, 'asunto');
    return { ok: true, json: async () => ({ id: 'email_1' }) };
  };
  const result = await sendEmail({ subject: 'asunto' }, 're_test_123', fakeFetch);
  assert.equal(result.id, 'email_1');
});

test('sendEmail lanza error si Resend responde con error', async () => {
  const fakeFetch = async () => ({ ok: false });
  await assert.rejects(() => sendEmail({}, 're_test_123', fakeFetch));
});

test('buildOwnerEmail escapa caracteres HTML en campos de usuario', () => {
  const maliciousPayload = {
    ...orderPayload,
    nombre: '<script>alert(1)</script>',
    direccion: { ...orderPayload.direccion, calle: '"><img src=x>' },
    email: 'test<script>@example.com',
  };
  const email = buildOwnerEmail(maliciousPayload, 'owner@example.com', glsOk);
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
  assert(!email.html.includes('<img'));
  assert(email.html.includes('&lt;img'));
  assert(email.html.includes('&quot;&gt;&lt;img'));
});

test('buildOwnerEmail escapa la descripción reconstruida desde Stripe', () => {
  const payload = {
    ...orderPayload,
    carrito: [
      { descripcion: '<script>alert(1)</script>', cantidad: 1, precioUnitario: 10, precioSubtotal: 10 },
    ],
  };
  const email = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail escapa los campos estructurados del carrito (servicio/tipoCalzado/material)', () => {
  const payload = {
    ...orderPayload,
    carrito: [
      {
        tipoCalzado: '<script>alert(1)</script>',
        servicio: '<img src=x onerror=alert(1)>',
        material: '<b>x</b>',
        cantidad: 1,
        precioUnitario: 10,
        precioSubtotal: 10,
      },
    ],
  };
  const email = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!email.html.includes('<script>'));
  assert(!email.html.includes('<img'));
  assert(!email.html.includes('<b>x</b>'));
  assert(email.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail y buildCustomerEmail escapan orderId, teléfono, dirección y metodoPago', () => {
  const payload = {
    ...orderPayload,
    orderId: '<script>alert(1)</script>',
    telefono: '<img src=x onerror=alert(1)>',
    direccion: {
      calle: '<b>calle maliciosa</b>',
      numero: '"><i>1</i>',
      codigoPostal: '<u>25700</u>',
      ciudad: '<em>ciudad</em>',
      pais: 'ES',
    },
    metodoPago: '<i>bizum</i>',
  };
  const ownerEmail = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!ownerEmail.html.includes('<script>'));
  assert(!ownerEmail.html.includes('<img'));
  assert(!ownerEmail.html.includes('<b>calle maliciosa</b>'));
  assert(!ownerEmail.html.includes('<i>bizum</i>'));
  assert(ownerEmail.html.includes('&lt;script&gt;'));

  const customerEmail = buildCustomerEmail(payload, 'ana@example.com', glsFallo);
  assert(!customerEmail.html.includes('<script>'));
  assert(!customerEmail.html.includes('<b>calle maliciosa</b>'));
  assert(customerEmail.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail y buildCustomerEmail escapan el trackId, que viene de la API de GLS', () => {
  const glsMalicioso = {
    ok: true,
    returnOrderId: '<img src=x onerror=alert(1)>',
    trackId: '<script>alert(1)</script>',
    dropOffLocation: null,
  };
  const ownerEmail = buildOwnerEmail(orderPayload, 'owner@example.com', glsMalicioso);
  assert(!ownerEmail.html.includes('<script>'));
  assert(!ownerEmail.html.includes('<img'));
  assert(ownerEmail.html.includes('&lt;script&gt;'));

  const customerEmail = buildCustomerEmail(orderPayload, 'ana@example.com', glsMalicioso);
  assert(!customerEmail.html.includes('<script>'));
  assert(customerEmail.html.includes('&lt;script&gt;'));
});

test('buildOwnerEmail escapa la cantidad, que llega sin validar por /api/notify-order', () => {
  const payload = {
    ...orderPayload,
    carrito: [
      {
        tipoCalzado: 'pie_de_gato',
        servicio: 'resolado_completo',
        material: null,
        cantidad: '1<img src=x onerror=alert(1)>',
        precioUnitario: 10,
        precioSubtotal: 10,
      },
    ],
  };
  const email = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!email.html.includes('<img'));
  assert(email.html.includes('&lt;img'));
});

test('buildOwnerEmail escapa la cantidad tambien en la linea reconstruida desde Stripe', () => {
  const payload = {
    ...orderPayload,
    carrito: [
      {
        descripcion: 'resolado_completo (pie_de_gato)',
        cantidad: '1<img src=x onerror=alert(1)>',
        precioUnitario: 10,
        precioSubtotal: 10,
      },
    ],
  };
  const email = buildOwnerEmail(payload, 'owner@example.com', glsOk);
  assert(!email.html.includes('<img'));
  assert(email.html.includes('&lt;img'));
});

test('buildOwnerEmail escapa el returnOrderId y el error que vienen de GLS', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', {
    ok: false,
    error: '<script>alert(1)</script>',
    portalUrl: 'https://returns.gls-group.com/climberup/create-return',
  });
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
});

test('buildCustomerEmail en modo A enseña el punto de entrega que asignó GLS', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOk);
  assert.match(email.html, /Dónde dejar el paquete/);
  assert.match(email.html, /PS GO PACK EXPRESS/);
  assert.match(email.html, /Carrer dels Canonges 52 bajos, 25700 La Seu d&#39;Urgell/);
  assert.match(email.html, /182 m/);
  assert.match(email.html, /635106811/);
  assert.match(email.html, /Martes: 09:30–13:30/);
  assert.match(email.html, /Sábado: 09:00–14:00/);
});

test('buildCustomerEmail en modo A enlaza el buscador de puntos GLS', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOk);
  assert(email.html.includes('https://www.gls-spain.es/es/parcel-shops/'));
});

test('buildCustomerEmail en modo A sigue funcionando si GLS no devolvió punto', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOkSinPunto);
  assert.match(email.html, /GLS te ha enviado/);
  assert.match(email.html, /Z79MB8U2/);
  assert.doesNotMatch(email.html, /Dónde dejar el paquete/);
  assert.doesNotMatch(email.html, /undefined|null|NaN/);
  // El buscador se enseña igual: sin punto asignado es la única pista de dónde dejarlo.
  assert(email.html.includes('https://www.gls-spain.es/es/parcel-shops/'));
});

test('buildCustomerEmail escapa el punto de entrega, que viene entero de la API de GLS', () => {
  const glsMalicioso = {
    ...glsOk,
    dropOffLocation: {
      name: '<script>alert(1)</script>',
      parcelHandlingRestriction: { offersReturnDropOff: 'Y', offersPrepaidParcelDropOff: 'Y' },
      distance: 0.5,
      address: {
        street: '<img src=x onerror=alert(1)>',
        city: '<b>ciudad</b>',
        zipCode: '"><i>25700</i>',
        countryCode: 'ES',
      },
      externalContactDetails: { phone: '<u>635106811</u>' },
      openingDays: [
        { weekday: '<em>TUE</em>', hours: [{ openingTime: '<s>09:30</s>', closingTime: '13:30' }] },
      ],
    },
  };
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsMalicioso);
  assert(!email.html.includes('<script>'));
  assert(!email.html.includes('<img'));
  assert(!email.html.includes('<b>ciudad</b>'));
  assert(!email.html.includes('<i>25700</i>'));
  assert(!email.html.includes('<u>635106811</u>'));
  assert(!email.html.includes('<em>TUE</em>'));
  assert(!email.html.includes('<s>09:30</s>'));
  assert(email.html.includes('&lt;script&gt;'));
  assert(email.html.includes('&lt;img'));
  // El punto tiene que haberse pintado: si no, el test pasaria sin escapar nada.
  assert.match(email.html, /Dónde dejar el paquete/);
});

test('buildCustomerEmail no enseña un punto que no admite devoluciones', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOkPuntoSinDevoluciones);
  // Ni el nombre ni las señas: mandar a alguien a un punto que le rechace el paquete es peor
  // que decirle que busque uno.
  assert.doesNotMatch(email.html, /MOEVE CASTELLDEFELS/);
  assert.doesNotMatch(email.html, /Carrer Granada 20/);
  assert.doesNotMatch(email.html, /Dónde dejar el paquete/);
  assert.match(email.html, /no admite devoluciones/);
  // La etiqueta sigue siendo válida y el buscador sigue siendo la salida.
  assert.match(email.html, /Z79MB8U2/);
  assert(email.html.includes('https://www.gls-spain.es/es/parcel-shops/'));
});

test('buildCustomerEmail tampoco enseña un punto sin parcelHandlingRestriction', () => {
  const sinDatos = {
    ...glsOk,
    dropOffLocation: { name: 'PS SIN DATOS', address: { street: 'Carrer Major 1', city: 'Berga' } },
  };
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', sinDatos);
  assert.doesNotMatch(email.html, /PS SIN DATOS/);
  assert.match(email.html, /no admite devoluciones/);
});

test('buildCustomerEmail solo avisa si GLS llegó a asignar un punto', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOkSinPunto);
  assert.doesNotMatch(email.html, /no admite devoluciones/);
});

// --- Nada de identificadores internos en el email -----------------------------------------

// Texto que ve el cliente, sin etiquetas ni atributos: es donde no puede aparecer nunca un
// nombre de variable. Las urls y los estilos quedan fuera a propósito.
function textoVisible(html) {
  return html.replace(/<[^>]*>/g, ' ');
}

test('buildCustomerEmail no deja ningún identificador interno en el texto del email', () => {
  for (const gls of [glsOk, glsFallo]) {
    const email = buildCustomerEmail(orderPayload, 'ana@example.com', gls);
    assert.doesNotMatch(textoVisible(email.html), /_/);
  }
});

test('buildOwnerEmail tampoco deja identificadores internos en el texto del email', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsOk);
  assert.doesNotMatch(textoVisible(email.html), /_/);
});

test('los emails llaman al servicio por su nombre, no por el identificador', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', glsOk);
  assert.doesNotMatch(email.html, /resolado_completo|pie_de_gato|vibram_xs_grip2/);
  assert.match(email.html, /Resolado completo · Pie de gato · Vibram XS Grip2 ×2/);
});

test('los emails traducen país y método de pago en vez de enseñar el código', () => {
  const email = buildOwnerEmail({ ...orderPayload, metodoPago: 'tarjeta' }, 'owner@example.com', glsOk);
  assert.match(email.html, /España/);
  assert.match(email.html, /Tarjeta/);
});

test('buildOwnerEmail usa la descripción ya montada cuando el pedido viene de Stripe', () => {
  const email = buildOwnerEmail(
    {
      ...orderPayload,
      carrito: [
        {
          descripcion: 'Resolado completo · Pie de gato · Vibram XS Grip2',
          cantidad: 2,
          precioUnitario: 35,
          precioSubtotal: 70,
        },
      ],
    },
    'owner@example.com',
    glsOk,
  );
  assert.match(email.html, /Resolado completo · Pie de gato · Vibram XS Grip2 ×2/);
});

// --- Puntos abiertos las 24 h -------------------------------------------------------------

test('buildCustomerEmail colapsa a "24 h" el día que GLS parte en dos tramos pegados', () => {
  const punto24h = {
    ...dropOffLocation,
    openingDays: [
      {
        weekday: 'MON',
        hours: [
          { openingTime: '00:00', closingTime: '14:00' },
          { openingTime: '14:00', closingTime: '23:59' },
        ],
      },
      { weekday: 'TUE', hours: [{ openingTime: '09:30', closingTime: '13:30' }] },
    ],
  };
  const email = buildCustomerEmail(orderPayload, 'ana@example.com', {
    ...glsOk,
    dropOffLocation: punto24h,
  });
  assert.match(email.html, /Lunes: Abierto 24 h/);
  assert.doesNotMatch(email.html, /00:00–14:00/);
  // Un horario normal se sigue enseñando entero.
  assert.match(email.html, /Martes: 09:30–13:30/);
});
