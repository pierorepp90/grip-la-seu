import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOrderId,
  humanizarIdentificador,
  describirLineaCarrito,
  formatearLineaCarrito,
  buildOrderSummary,
  buildDatosPortal,
} from '../js/order.js';

test('generateOrderId incluye fecha y es determinista con inyección de reloj/random', () => {
  const fixedDate = new Date('2026-08-13T12:00:00.000Z');
  const id = generateOrderId(fixedDate, () => 0.5);
  assert.match(id, /^GLS-20260813120000-[0-9A-Z]{4}$/);
});

test('generateOrderId produce ids distintos con random distinto', () => {
  const fixedDate = new Date('2026-08-13T12:00:00.000Z');
  const id1 = generateOrderId(fixedDate, () => 0.1);
  const id2 = generateOrderId(fixedDate, () => 0.9);
  assert.notEqual(id1, id2);
});

const direccion = {
  calle: 'Carrer Major',
  numero: '12',
  codigoPostal: '25700',
  ciudad: "La Seu d'Urgell",
  pais: 'ES',
};

const lineaEstructurada = {
  tipoCalzado: 'pie_de_gato',
  servicio: 'resolado_completo',
  material: 'vibram_xs_grip2',
  cantidad: 2,
  precioUnitario: 35,
  precioSubtotal: 70,
};

// --- Nombres del catálogo ------------------------------------------------------------------

test('describirLineaCarrito traduce servicio, tipo de calzado y material a cada idioma', () => {
  assert.equal(
    describirLineaCarrito(lineaEstructurada, 'es'),
    'Resolado completo · Pie de gato · Vibram XS Grip2',
  );
  assert.equal(
    describirLineaCarrito(lineaEstructurada, 'ca'),
    'Ressolat complet · Peu de gat · Vibram XS Grip2',
  );
  assert.equal(
    describirLineaCarrito(lineaEstructurada, 'en'),
    'Full resole · Climbing shoe · Vibram XS Grip2',
  );
  assert.equal(
    describirLineaCarrito(lineaEstructurada, 'pt'),
    'Resolamento completo · Pé de gato · Vibram XS Grip2',
  );
});

test('describirLineaCarrito omite el material cuando la línea no lo lleva', () => {
  assert.equal(
    describirLineaCarrito({ servicio: 'puntera', tipoCalzado: 'bota', material: null }, 'es'),
    'Puntera · Bota',
  );
});

test('describirLineaCarrito devuelve tal cual la descripción reconstruida desde Stripe', () => {
  // La ruta de tarjeta recompone la línea desde los line_items de Stripe: ahí la descripción
  // ya viene montada por el Worker y en ningún idioma hay que volver a tocarla.
  const linea = { descripcion: 'Resolado completo · Pie de gato · Vibram XS Grip2', cantidad: 1 };
  for (const lang of ['ca', 'es', 'en', 'pt']) {
    assert.equal(
      describirLineaCarrito(linea, lang),
      'Resolado completo · Pie de gato · Vibram XS Grip2',
    );
  }
});

test('describirLineaCarrito no deja escapar identificadores que falten en el diccionario', () => {
  const descripcion = describirLineaCarrito(
    { servicio: 'servicio_nuevo', tipoCalzado: 'zapatilla_trail', material: null },
    'es',
  );
  assert.doesNotMatch(descripcion, /_/);
  assert.equal(descripcion, 'Servicio nuevo · Zapatilla trail');
});

test('humanizarIdentificador convierte guiones bajos en palabras', () => {
  assert.equal(humanizarIdentificador('media_suela'), 'Media suela');
  assert.equal(humanizarIdentificador(''), '');
  assert.equal(humanizarIdentificador(null), '');
});

// --- Filas del carrito ---------------------------------------------------------------------

test('formatearLineaCarrito devuelve la fila de dos columnas de una línea estructurada', () => {
  assert.deepEqual(formatearLineaCarrito(lineaEstructurada, 'es'), {
    etiqueta: 'Resolado completo · Pie de gato · Vibram XS Grip2 ×2',
    valor: '70.00€',
    tipo: 'articulo',
  });
});

test('formatearLineaCarrito devuelve la fila de una línea reconstruida desde Stripe', () => {
  assert.deepEqual(
    formatearLineaCarrito(
      {
        descripcion: 'Resolado completo · Pie de gato · Vibram XS Grip2',
        cantidad: 1,
        precioUnitario: 44,
        precioSubtotal: 44,
      },
      'ca',
    ),
    {
      etiqueta: 'Resolado completo · Pie de gato · Vibram XS Grip2 ×1',
      valor: '44.00€',
      tipo: 'articulo',
    },
  );
});

// --- Resumen del pedido --------------------------------------------------------------------

const orderPayload = {
  orderId: 'GLS-TEST-0001',
  carrito: [
    lineaEstructurada,
    {
      tipoCalzado: 'bota',
      servicio: 'puntera',
      material: null,
      cantidad: 1,
      precioUnitario: 15,
      precioSubtotal: 15,
    },
  ],
  transporte: 5,
  precioTotal: 90,
  nombre: 'Ana Pérez',
  direccion,
  telefono: '+34612345678',
  email: 'ana@example.com',
  metodoPago: 'bizum',
};

function filasDe(summary) {
  return summary.secciones.flatMap((seccion) => seccion.filas);
}

function valorDe(summary, etiqueta) {
  const fila = filasDe(summary).find((candidata) => candidata.etiqueta === etiqueta);
  return fila ? fila.valor : undefined;
}

test('buildOrderSummary agrupa el recibo en pedido, entrega y pago', () => {
  const summary = buildOrderSummary(orderPayload, 'es');
  assert.equal(summary.orderId, 'GLS-TEST-0001');
  assert.deepEqual(
    summary.secciones.map((seccion) => seccion.titulo),
    ['Tu pedido', 'Entrega', 'Pago'],
  );
});

test('buildOrderSummary detalla el carrito, el envío y el total en la sección del pedido', () => {
  const [pedido] = buildOrderSummary(orderPayload, 'es').secciones;
  assert.deepEqual(pedido.filas, [
    { etiqueta: 'Referencia', valor: 'GLS-TEST-0001', tipo: 'dato' },
    {
      etiqueta: 'Resolado completo · Pie de gato · Vibram XS Grip2 ×2',
      valor: '70.00€',
      tipo: 'articulo',
    },
    { etiqueta: 'Puntera · Bota ×1', valor: '15.00€', tipo: 'articulo' },
    { etiqueta: 'Envío GLS', valor: '5.00€', tipo: 'dato' },
    { etiqueta: 'Precio total', valor: '90.00€', tipo: 'total' },
  ]);
});

test('buildOrderSummary desglosa la dirección y traduce el país', () => {
  const summary = buildOrderSummary(orderPayload, 'es');
  assert.equal(valorDe(summary, 'Nombre'), 'Ana Pérez');
  assert.equal(valorDe(summary, 'Dirección'), 'Carrer Major 12');
  assert.equal(valorDe(summary, 'Código postal'), '25700');
  assert.equal(valorDe(summary, 'Ciudad'), "La Seu d'Urgell");
  assert.equal(valorDe(summary, 'País'), 'España');
  assert.equal(valorDe(summary, 'Teléfono'), '+34612345678');
  assert.equal(valorDe(summary, 'Email'), 'ana@example.com');
});

test('buildOrderSummary traduce el método de pago en lugar del identificador', () => {
  assert.equal(valorDe(buildOrderSummary(orderPayload, 'es'), 'Método de pago'), 'Bizum');
  assert.equal(
    valorDe(buildOrderSummary({ ...orderPayload, metodoPago: 'tarjeta' }, 'en'), 'Payment method'),
    'Card',
  );
});

test('buildOrderSummary traduce las etiquetas al idioma activo', () => {
  const summary = buildOrderSummary(orderPayload, 'ca');
  assert.deepEqual(
    summary.secciones.map((seccion) => seccion.titulo),
    ['La teva comanda', 'Entrega', 'Pagament'],
  );
  assert.equal(valorDe(summary, 'Referència'), 'GLS-TEST-0001');
  assert.equal(valorDe(summary, 'Ciutat'), "La Seu d'Urgell");
  assert.equal(valorDe(summary, 'País'), 'Espanya');
});

test('buildOrderSummary omite la línea de envío cuando el transporte es 0', () => {
  const summary = buildOrderSummary({ ...orderPayload, transporte: 0, precioTotal: 85 }, 'es');
  assert.equal(valorDe(summary, 'Envío GLS'), undefined);
  assert.equal(valorDe(summary, 'Precio total'), '85.00€');
});

test('buildOrderSummary no repite la referencia de la devolución GLS', () => {
  // La pinta el bloque de GLS, justo al lado del aviso de la etiqueta y del punto de entrega:
  // repetirla aquí era la segunda de las dos referencias duplicadas del recibo.
  const summary = buildOrderSummary(
    { ...orderPayload, gls: { ok: true, returnOrderId: 'RET-99', trackId: 'Z79MB8U2' } },
    'es',
  );
  assert.doesNotMatch(JSON.stringify(summary), /Z79MB8U2/);
});

test('buildOrderSummary no deja ningún identificador interno en el recibo', () => {
  for (const lang of ['ca', 'es', 'en', 'pt']) {
    const summary = buildOrderSummary({ ...orderPayload, metodoPago: 'tarjeta' }, lang);
    for (const fila of filasDe(summary)) {
      // El orderId lleva guiones, no guiones bajos; nada más debería llevarlos.
      assert.doesNotMatch(fila.etiqueta, /_/, `etiqueta cruda: ${fila.etiqueta}`);
      assert.doesNotMatch(fila.valor, /_/, `valor crudo: ${fila.valor}`);
    }
  }
});

// --- Datos para el portal de GLS (modo B) --------------------------------------------------

function motivoDe(datos) {
  return datos.find((dato) => dato.etiqueta === 'Motivo de devolución')?.valor;
}

// Las etiquetas nombran los campos del formulario del portal de GLS, que está en castellano,
// y por eso no llevan idioma: buildDatosPortal no recibe lang.
test('buildDatosPortal devuelve los campos del formulario del portal, en su orden', () => {
  assert.deepEqual(buildDatosPortal(orderPayload, 'Sin motivo específico'), [
    { etiqueta: 'Número de pedido', valor: 'GLS-TEST-0001' },
    { etiqueta: 'Motivo de devolución', valor: 'Sin motivo específico' },
    { etiqueta: 'Nombre', valor: 'Ana Pérez' },
    { etiqueta: 'Correo electrónico', valor: 'ana@example.com' },
    { etiqueta: 'Calle', valor: 'Carrer Major' },
    { etiqueta: 'Número', valor: '12' },
    { etiqueta: 'Código postal', valor: '25700' },
    { etiqueta: 'Ciudad', valor: "La Seu d'Urgell" },
    { etiqueta: 'País', valor: 'ES' },
  ]);
});

test('buildDatosPortal usa el motivo que manda el Worker, no una copia suya', () => {
  assert.equal(motivoDe(buildDatosPortal(orderPayload, 'Producto defectuoso')), 'Producto defectuoso');
});

test('buildDatosPortal cae al motivo por defecto si el Worker no manda ninguno', () => {
  // Página cacheada o pedido guardado en KV antes de que el Worker empezara a mandarlo.
  assert.equal(motivoDe(buildDatosPortal(orderPayload)), 'Sin motivo específico');
  assert.equal(motivoDe(buildDatosPortal(orderPayload, '')), 'Sin motivo específico');
});

test('buildDatosPortal omite los campos vacíos y recorta los espacios sobrantes', () => {
  // Un botón "Copiar" que copia una cadena vacía y luego dice "Copiado" miente; y la fila
  // tampoco le da al cliente ningún dato que pegar en el portal.
  const datos = buildDatosPortal(
    {
      ...orderPayload,
      nombre: '  Ana Pérez  ',
      email: '',
      direccion: { ...direccion, numero: '   ' },
    },
    'Sin motivo específico',
  );
  assert.deepEqual(
    datos.map((dato) => dato.etiqueta),
    [
      'Número de pedido',
      'Motivo de devolución',
      'Nombre',
      'Calle',
      'Código postal',
      'Ciudad',
      'País',
    ],
  );
  assert.equal(datos.find((dato) => dato.etiqueta === 'Nombre').valor, 'Ana Pérez');
});

test('buildDatosPortal sobrevive a un pedido sin dirección', () => {
  assert.deepEqual(buildDatosPortal({ orderId: 'GLS-TEST-0002' }, 'Sin motivo específico'), [
    { etiqueta: 'Número de pedido', valor: 'GLS-TEST-0002' },
    { etiqueta: 'Motivo de devolución', valor: 'Sin motivo específico' },
  ]);
});
