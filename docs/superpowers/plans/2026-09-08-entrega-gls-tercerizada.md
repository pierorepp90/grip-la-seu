# Entrega tercerizada con GLS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir la elección manual de punto de entrega por una devolución GLS creada automáticamente desde el Worker, con fallback a instrucciones manuales si la API falla.

**Architecture:** El frontend recoge la dirección desglosada (calle, número, CP, ciudad, país ES/PT) en lugar de un campo libre y una elección de punto. Al confirmar el pedido, el Worker llama a la API del portal de devoluciones de GLS; GLS envía al cliente su email con la etiqueta. Si la llamada falla, el email de confirmación incluye el enlace al portal y los datos a pegar. Workers KV evita duplicar devoluciones si el cliente recarga.

**Tech Stack:** JS vanilla con Alpine.js (sin build), Cloudflare Workers, Workers KV, Stripe, Resend. Tests con `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-08-entrega-gls-tercerizada-design.md`

---

## Estructura de ficheros

**Se crean:**
- `worker/src/gls.js` — todo lo relativo a la API de devoluciones de GLS: construcción del payload, parseo de respuesta y la llamada HTTP. Única responsabilidad, sin conocimiento de emails ni de Stripe.
- `worker/tests/gls.test.js`

**Se modifican:**
- `js/precios.js` — constantes de transporte
- `js/pricing.js` — `calcularTransporte`
- `js/validation.js` — `isValidPhone`, `isValidPostalCode`
- `js/order.js` — dirección desglosada en el resumen
- `js/i18n.js` — interpolación en `t()`, claves nuevas, claves muertas fuera
- `js/app.js` — estado y getters de `orderForm`
- `js/gracias.js` — modos A/B
- `index.html` — pasos 2 y 3, carrito
- `gracias.html` — contenedor del resultado GLS
- `css/styles.css` — estilos del bloque de datos a copiar, fuera los de la tarjeta de entrega
- `worker/src/resend.js` — dirección desglosada y modos A/B
- `worker/src/stripe.js` — metadatos nuevos
- `worker/src/index.js` — orquestación y deduplicación KV
- `worker/wrangler.toml` — vars y binding KV
- `tests/data.test.js`, `tests/pricing.test.js`, `tests/validation.test.js`, `tests/order.test.js`, `tests/i18n.test.js`
- `worker/tests/resend.test.js`, `worker/tests/stripe.test.js`

**Se borran:**
- `js/puntos-gls.js`, `js/tiendas.js`, `js/geo.js`, `js/geocode.js`
- `tests/geo.test.js`, `tests/geocode.test.js`

## Desviación respecto a la spec

La spec decía que el email y la pantalla de éxito mostrarían el punto de entrega asignado por GLS.
**No se implementa.** No conocemos los nombres de campo de `dropOffLocations.data[0]` sin ver una
respuesta real, y adivinarlos produciría celdas vacías en producción. Además GLS ya envía al cliente
su propio email con la etiqueta y el punto. `parseReturnOrderResponse` sí extrae y devuelve el objeto
crudo —llega al frontend en la respuesta JSON— para poder pintarlo más adelante sin tocar el Worker,
una vez la Tarea 16 revele su forma real. Lo que sí se muestra es el `returnOrderId`, que es seguro.

---

## Fase 1 — Módulos puros del frontend

### Task 1: Transporte por umbral

**Files:**
- Modify: `js/precios.js:22-23`
- Modify: `js/pricing.js`
- Test: `tests/pricing.test.js`

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `tests/pricing.test.js`, y añadir `calcularTransporte` al import de la línea 3:

```js
test('calcularTransporte cobra el envío por debajo del umbral', () => {
  assert.equal(calcularTransporte(44, 5, 150), 5);
});

test('calcularTransporte no cobra envío justo en el umbral', () => {
  assert.equal(calcularTransporte(150, 5, 150), 0);
});

test('calcularTransporte no cobra envío por encima del umbral', () => {
  assert.equal(calcularTransporte(200, 5, 150), 0);
});

test('calcularTransporte lanza error si el total no es un número', () => {
  assert.throws(() => calcularTransporte('44', 5, 150));
  assert.throws(() => calcularTransporte(Number.NaN, 5, 150));
});
```

El import queda así:

```js
import { calculateLinePrice, minPrecioServicio, calcularTransporte } from '../js/pricing.js';
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test`
Expected: FAIL — `calcularTransporte is not a function`

- [ ] **Step 3: Implementar**

Añadir al final de `js/pricing.js`:

```js
export function calcularTransporte(totalCarrito, precioTransporte, umbralGratis) {
  if (typeof totalCarrito !== 'number' || Number.isNaN(totalCarrito)) {
    throw new Error('totalCarrito debe ser un número');
  }
  return totalCarrito >= umbralGratis ? 0 : precioTransporte;
}
```

Sustituir las dos últimas líneas de `js/precios.js` (el comentario `// PENDIENTE: confirmar tarifa
real de envío GLS.` y la constante) por:

```js
// Envío GLS: 5€, gratis a partir de 150€ de servicios (sin contar el propio envío).
export const PRECIO_TRANSPORTE_GLS = 5;
export const ENVIO_GRATIS_DESDE = 150;
```

- [ ] **Step 4: Ejecutar los tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/pricing.js js/precios.js tests/pricing.test.js
git commit -m "feat(precios): envio GLS de 5 EUR, gratis desde 150 EUR"
```

---

### Task 2: Validación de teléfono y código postal por país

**Files:**
- Modify: `js/validation.js`
- Test: `tests/validation.test.js`

- [ ] **Step 1: Escribir el test que falla**

Reemplazar el contenido completo de `tests/validation.test.js` por:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNonEmpty, isValidPhone, isValidPostalCode, isValidEmail } from '../js/validation.js';

test('isNonEmpty rechaza vacíos y solo-espacios', () => {
  assert.equal(isNonEmpty('Ana'), true);
  assert.equal(isNonEmpty('   '), false);
  assert.equal(isNonEmpty(''), false);
  assert.equal(isNonEmpty(undefined), false);
});

test('isValidPhone acepta móviles y fijos españoles', () => {
  assert.equal(isValidPhone('612345678', 'ES'), true);
  assert.equal(isValidPhone('+34612345678', 'ES'), true);
  assert.equal(isValidPhone('+34 612 345 678', 'ES'), true);
  assert.equal(isValidPhone('612-345-678', 'ES'), true);
});

test('isValidPhone acepta móviles portugueses', () => {
  assert.equal(isValidPhone('912345678', 'PT'), true);
  assert.equal(isValidPhone('+351912345678', 'PT'), true);
  assert.equal(isValidPhone('+351 912 345 678', 'PT'), true);
});

test('isValidPhone no mezcla países', () => {
  assert.equal(isValidPhone('612345678', 'PT'), false);
  assert.equal(isValidPhone('+351912345678', 'ES'), false);
});

test('isValidPhone rechaza formatos inválidos y países desconocidos', () => {
  assert.equal(isValidPhone('12345', 'ES'), false);
  assert.equal(isValidPhone('512345678', 'ES'), false);
  assert.equal(isValidPhone('abcdefghi', 'ES'), false);
  assert.equal(isValidPhone('', 'ES'), false);
  assert.equal(isValidPhone('612345678', 'FR'), false);
});

test('isValidPostalCode acepta 5 dígitos en España', () => {
  assert.equal(isValidPostalCode('25700', 'ES'), true);
  assert.equal(isValidPostalCode(' 25700 ', 'ES'), true);
});

test('isValidPostalCode acepta los dos formatos portugueses', () => {
  assert.equal(isValidPostalCode('1000', 'PT'), true);
  assert.equal(isValidPostalCode('1000-260', 'PT'), true);
});

test('isValidPostalCode rechaza formatos inválidos y países desconocidos', () => {
  assert.equal(isValidPostalCode('2570', 'ES'), false);
  assert.equal(isValidPostalCode('257000', 'ES'), false);
  assert.equal(isValidPostalCode('ABCDE', 'ES'), false);
  assert.equal(isValidPostalCode('1000-26', 'PT'), false);
  assert.equal(isValidPostalCode('25700', 'FR'), false);
  assert.equal(isValidPostalCode(undefined, 'ES'), false);
});

test('isValidEmail acepta emails con formato válido', () => {
  assert.equal(isValidEmail('ana@example.com'), true);
});

test('isValidEmail rechaza emails sin @ o sin dominio', () => {
  assert.equal(isValidEmail('ana.example.com'), false);
  assert.equal(isValidEmail('ana@'), false);
  assert.equal(isValidEmail(''), false);
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test`
Expected: FAIL — `isValidPhone is not a function`

- [ ] **Step 3: Implementar**

Reemplazar el contenido completo de `js/validation.js` por:

```js
export function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// GLS solo tiene activados España y Portugal como países de origen.
const TELEFONO_POR_PAIS = {
  ES: /^(?:\+34|0034)?[6789]\d{8}$/,
  PT: /^(?:\+351|00351)?9\d{8}$/,
};

export function isValidPhone(phone, pais) {
  if (typeof phone !== 'string') return false;
  const patron = TELEFONO_POR_PAIS[pais];
  if (!patron) return false;
  return patron.test(phone.replace(/[\s-]/g, ''));
}

const CP_POR_PAIS = {
  ES: /^\d{5}$/,
  PT: /^\d{4}(?:-\d{3})?$/,
};

export function isValidPostalCode(cp, pais) {
  if (typeof cp !== 'string') return false;
  const patron = CP_POR_PAIS[pais];
  if (!patron) return false;
  return patron.test(cp.trim());
}

export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
```

`isValidSpanishPhone` desaparece. `js/app.js` todavía la importa y quedará roto hasta la Tarea 12;
los tests no lo detectan porque no cargan `app.js`.

- [ ] **Step 4: Ejecutar los tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/validation.js tests/validation.test.js
git commit -m "feat(validation): validar telefono y codigo postal por pais (ES/PT)"
```

---

### Task 3: Resumen del pedido con dirección desglosada

**Files:**
- Modify: `js/order.js:20-58`
- Test: `tests/order.test.js`

- [ ] **Step 1: Escribir el test que falla**

Reemplazar los tres tests de `buildOrderSummary` en `tests/order.test.js` (desde
`test('buildOrderSummary detalla cada línea...` hasta el final del fichero) por:

```js
const direccion = {
  calle: 'Carrer Major',
  numero: '12',
  codigoPostal: '25700',
  ciudad: "La Seu d'Urgell",
  pais: 'ES',
};

test('buildOrderSummary detalla el carrito, el envío y la dirección desglosada', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0001',
    carrito: [
      {
        tipoCalzado: 'pie_de_gato',
        servicio: 'resolado_completo',
        material: 'vibram_xs_grip2',
        cantidad: 2,
        precioUnitario: 35,
        precioSubtotal: 70,
      },
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
  const summary = buildOrderSummary(orderPayload);
  assert.equal(summary.orderId, 'GLS-TEST-0001');
  const joined = summary.lineas.join(' | ');
  assert.match(joined, /pie_de_gato · resolado_completo \(vibram_xs_grip2\) ×2 — 70\.00€/);
  assert.match(joined, /bota · puntera ×1 — 15\.00€/);
  assert.match(joined, /Envío GLS: 5\.00€/);
  assert.match(joined, /Total: 90\.00€/);
  assert.match(joined, /Ana Pérez/);
  assert.match(joined, /Dirección: Carrer Major 12/);
  assert.match(joined, /Código postal: 25700/);
  assert.match(joined, /Ciudad: La Seu d'Urgell/);
  assert.match(joined, /País: ES/);
  assert.match(joined, /bizum/);
});

test('buildOrderSummary omite la línea de envío cuando el transporte es 0', () => {
  const summary = buildOrderSummary({
    orderId: 'GLS-TEST-0002',
    carrito: [
      {
        tipoCalzado: 'bota',
        servicio: 'puntera',
        material: null,
        cantidad: 1,
        precioUnitario: 15,
        precioSubtotal: 15,
      },
    ],
    transporte: 0,
    precioTotal: 15,
    nombre: 'Ana Pérez',
    direccion,
    telefono: '+34612345678',
    email: 'ana@example.com',
    metodoPago: 'tarjeta',
  });
  const joined = summary.lineas.join(' | ');
  assert.doesNotMatch(joined, /Envío GLS/);
  assert.match(joined, /Total: 15\.00€/);
});

test('buildOrderSummary añade la referencia de la devolución GLS cuando existe', () => {
  const base = {
    orderId: 'GLS-TEST-0003',
    carrito: [],
    transporte: 0,
    precioTotal: 0,
    nombre: 'Ana Pérez',
    direccion,
    telefono: '+34612345678',
    email: 'ana@example.com',
    metodoPago: 'bizum',
  };
  const conGls = buildOrderSummary({ ...base, gls: { ok: true, returnOrderId: 'RET-99' } });
  assert.match(conGls.lineas.join(' | '), /Devolución GLS: RET-99/);

  const sinGls = buildOrderSummary({ ...base, gls: { ok: false, error: 'timeout' } });
  assert.doesNotMatch(sinGls.lineas.join(' | '), /Devolución GLS/);

  const ausente = buildOrderSummary(base);
  assert.doesNotMatch(ausente.lineas.join(' | '), /Devolución GLS/);
});

test('buildOrderSummary usa la descripción reconstruida desde Stripe cuando no hay campos estructurados', () => {
  const summary = buildOrderSummary({
    orderId: 'GLS-TEST-0004',
    carrito: [
      {
        descripcion: 'resolado_completo (pie_de_gato) (vibram_xs_grip2)',
        cantidad: 2,
        precioUnitario: 35,
        precioSubtotal: 70,
      },
    ],
    transporte: 0,
    precioTotal: 70,
    nombre: 'Ana Pérez',
    direccion,
    telefono: '+34612345678',
    email: 'ana@example.com',
    metodoPago: 'tarjeta',
  });
  assert.match(
    summary.lineas.join(' | '),
    /resolado_completo \(pie_de_gato\) \(vibram_xs_grip2\) ×2 — 70\.00€/,
  );
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test`
Expected: FAIL — el resumen no contiene `Dirección: Carrer Major 12`

- [ ] **Step 3: Implementar**

Reemplazar en `js/order.js` la función `buildOrderSummary` completa por:

```js
export function direccionLineas(direccion) {
  return [
    `Dirección: ${direccion.calle} ${direccion.numero}`,
    `Código postal: ${direccion.codigoPostal}`,
    `Ciudad: ${direccion.ciudad}`,
    `País: ${direccion.pais}`,
  ];
}

export function buildOrderSummary(orderPayload) {
  const {
    orderId,
    carrito,
    transporte,
    precioTotal,
    nombre,
    direccion,
    telefono,
    email,
    metodoPago,
    gls,
  } = orderPayload;

  const lineas = [`Referencia: ${orderId}`, ...carrito.map(formatearLineaCarrito)];
  if (transporte > 0) {
    lineas.push(`Envío GLS: ${transporte.toFixed(2)}€`);
  }
  lineas.push(
    `Total: ${precioTotal.toFixed(2)}€`,
    `Nombre: ${nombre}`,
    ...direccionLineas(direccion),
    `Teléfono: ${telefono}`,
    `Email: ${email}`,
    `Pago: ${metodoPago}`,
  );
  if (gls && gls.ok && gls.returnOrderId) {
    lineas.push(`Devolución GLS: ${gls.returnOrderId}`);
  }

  return { orderId, lineas };
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/order.js tests/order.test.js
git commit -m "feat(order): resumen con direccion desglosada y referencia GLS"
```

---

### Task 4: Borrar los módulos de puntos y tiendas

**Files:**
- Delete: `js/puntos-gls.js`, `js/tiendas.js`, `js/geo.js`, `js/geocode.js`
- Delete: `tests/geo.test.js`, `tests/geocode.test.js`
- Modify: `tests/data.test.js`

- [ ] **Step 1: Actualizar `tests/data.test.js`**

Reemplazar su contenido completo por:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRECIOS, PRECIO_TRANSPORTE_GLS, ENVIO_GRATIS_DESDE } from '../js/precios.js';
import { calculateLinePrice } from '../js/pricing.js';

test('PRECIOS tiene tarifa plana numérica para cada tipo de calzado y servicio', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    for (const servicio of ['resolado_completo', 'media_suela', 'puntera']) {
      assert.equal(typeof PRECIOS[tipo][servicio], 'number');
      assert.doesNotThrow(() => calculateLinePrice(PRECIOS, tipo, servicio, 1));
    }
  }
});

test('PRECIO_TRANSPORTE_GLS y ENVIO_GRATIS_DESDE son números', () => {
  assert.equal(typeof PRECIO_TRANSPORTE_GLS, 'number');
  assert.equal(typeof ENVIO_GRATIS_DESDE, 'number');
});
```

- [ ] **Step 2: Borrar los ficheros**

```bash
git rm js/puntos-gls.js js/tiendas.js js/geo.js js/geocode.js tests/geo.test.js tests/geocode.test.js
```

- [ ] **Step 3: Ejecutar los tests**

Run: `npm test`
Expected: PASS. `js/app.js` sigue importando los módulos borrados y quedará roto hasta la Tarea 12,
pero los tests no cargan `app.js`.

- [ ] **Step 4: Commit**

```bash
git add tests/data.test.js
git commit -m "refactor: eliminar puntos GLS, tiendas y geocodificacion"
```

---

## Fase 2 — Worker

### Task 5: `buildReturnOrderRequest`

**Files:**
- Create: `worker/src/gls.js`
- Test: `worker/tests/gls.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `worker/tests/gls.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReturnOrderRequest } from '../src/gls.js';

const env = {
  GLS_API_BASE: 'https://api.gls-group.net/order-management/shop-returns/portal/v3',
  GLS_PORTAL_NAME: 'climberup',
  GLS_PORTAL_TOKEN: 'token-123',
  GLS_CLIENT_KEY: 'clave-abc',
  GLS_RETURN_REASON: 'Sin motivo específico',
  GLS_PORTAL_URL: 'https://returns.gls-group.com/climberup/create-return',
};

const orderPayload = {
  orderId: 'GLS-20260908120000-A1B2',
  nombre: 'Ana Pérez',
  email: 'ana@example.com',
  lang: 'ca',
  direccion: {
    calle: 'Carrer Major',
    numero: '12',
    codigoPostal: '25700',
    ciudad: "La Seu d'Urgell",
    pais: 'ES',
  },
};

test('buildReturnOrderRequest construye el payload que espera GLS', () => {
  const request = buildReturnOrderRequest(orderPayload, env);
  assert.equal(request.originalOrderReference, 'GLS-20260908120000-A1B2');
  assert.equal(request.returnReason, 'Sin motivo específico');
  assert.deepEqual(request.options.confirmationMail, { sendTo: ['ana@example.com'] });
  assert.equal(request.sender.personName, 'Ana Pérez');
  assert.equal(request.sender.email, 'ana@example.com');
  assert.equal(request.sender.address.street, 'Carrer Major 12');
  assert.equal(request.sender.address.city, "La Seu d'Urgell");
  assert.equal(request.sender.address.zipCode, '25700');
  assert.equal(request.sender.address.countryCode, 'ES');
});

test('buildReturnOrderRequest mapea el catalán a español, que GLS no soporta', () => {
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'ca' }, env).options.languageCode, 'es');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'es' }, env).options.languageCode, 'es');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'en' }, env).options.languageCode, 'en');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'pt' }, env).options.languageCode, 'pt');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: undefined }, env).options.languageCode, 'es');
});

test('buildReturnOrderRequest trunca cada campo al límite de GLS', () => {
  const request = buildReturnOrderRequest(
    {
      ...orderPayload,
      orderId: 'X'.repeat(60),
      nombre: 'N'.repeat(50),
      direccion: {
        calle: 'C'.repeat(50),
        numero: '1234567890',
        codigoPostal: '9'.repeat(15),
        ciudad: 'D'.repeat(50),
        pais: 'ES',
      },
    },
    env,
  );
  assert.equal(request.originalOrderReference.length, 50);
  assert.equal(request.sender.personName.length, 40);
  assert.equal(request.sender.address.street, `${'C'.repeat(40)} ${'123456'}`);
  assert.equal(request.sender.address.zipCode.length, 10);
  assert.equal(request.sender.address.city.length, 40);
});

test('buildReturnOrderRequest recorta espacios sobrantes', () => {
  const request = buildReturnOrderRequest(
    { ...orderPayload, nombre: '  Ana Pérez  ', direccion: { ...orderPayload.direccion, numero: '' } },
    env,
  );
  assert.equal(request.sender.personName, 'Ana Pérez');
  assert.equal(request.sender.address.street, 'Carrer Major');
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module '../src/gls.js'`

- [ ] **Step 3: Implementar**

Crear `worker/src/gls.js`:

```js
// Cliente de la API del portal de devoluciones de GLS.
//
// OJO: es la API interna que usa el propio portal (returns.gls-group.com), no una API
// publicada para integradores. Las credenciales salen de su frontend público. Puede cambiar
// sin aviso; por eso index.js nunca deja que un fallo aquí tumbe el pedido. La vía sostenible
// es el ShopReturnService API oficial, solicitado a GLS y pendiente de respuesta.

// Límites extraídos de los validadores del portal. El formulario ya los aplica; los repetimos
// aquí para que relajar el frontend no haga que GLS empiece a rechazar pedidos.
const LIMITES = {
  originalOrderReference: 50,
  personName: 40,
  email: 255,
  calle: 40,
  numero: 6,
  codigoPostal: 10,
  ciudad: 40,
};

// GLS no soporta catalán.
const IDIOMA_GLS = { ca: 'es', es: 'es', en: 'en', pt: 'pt' };

function truncar(valor, maximo) {
  return String(valor ?? '').trim().slice(0, maximo);
}

export function buildReturnOrderRequest(orderPayload, env) {
  const { orderId, nombre, email, direccion, lang } = orderPayload;
  const calle = truncar(direccion.calle, LIMITES.calle);
  const numero = truncar(direccion.numero, LIMITES.numero);
  const emailLimpio = truncar(email, LIMITES.email);

  return {
    originalOrderReference: truncar(orderId, LIMITES.originalOrderReference),
    returnReason: env.GLS_RETURN_REASON,
    options: {
      confirmationMail: { sendTo: [emailLimpio] },
      languageCode: IDIOMA_GLS[lang] ?? 'es',
    },
    sender: {
      personName: truncar(nombre, LIMITES.personName),
      email: emailLimpio,
      address: {
        street: `${calle} ${numero}`.trim(),
        city: truncar(direccion.ciudad, LIMITES.ciudad),
        zipCode: truncar(direccion.codigoPostal, LIMITES.codigoPostal),
        countryCode: direccion.pais,
      },
    },
  };
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/gls.js worker/tests/gls.test.js
git commit -m "feat(gls): construir el payload de devolucion con limites de GLS"
```

---

### Task 6: `parseReturnOrderResponse`

**Files:**
- Modify: `worker/src/gls.js`
- Test: `worker/tests/gls.test.js`

- [ ] **Step 1: Escribir el test que falla**

Añadir `parseReturnOrderResponse` al import de `worker/tests/gls.test.js` y estos tests al final:

```js
test('parseReturnOrderResponse extrae el id y el primer punto de entrega', () => {
  const result = parseReturnOrderResponse({
    returnOrderId: 'RET-99',
    dropOffLocations: { data: [{ id: 'PS-1' }, { id: 'PS-2' }] },
  });
  assert.equal(result.returnOrderId, 'RET-99');
  assert.deepEqual(result.dropOffLocation, { id: 'PS-1' });
});

test('parseReturnOrderResponse devuelve null si no hay puntos de entrega', () => {
  assert.equal(parseReturnOrderResponse({ returnOrderId: 'RET-99' }).dropOffLocation, null);
  assert.equal(
    parseReturnOrderResponse({ returnOrderId: 'RET-99', dropOffLocations: { data: [] } }).dropOffLocation,
    null,
  );
});

test('parseReturnOrderResponse lanza error si falta el returnOrderId', () => {
  assert.throws(() => parseReturnOrderResponse({}));
  assert.throws(() => parseReturnOrderResponse(null));
});
```

El import queda:

```js
import { buildReturnOrderRequest, parseReturnOrderResponse } from '../src/gls.js';
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd worker && npm test`
Expected: FAIL — `parseReturnOrderResponse is not a function`

- [ ] **Step 3: Implementar**

Añadir a `worker/src/gls.js`:

```js
// `dropOffLocation` se devuelve crudo: todavía no hemos visto una respuesta real de producción,
// así que no asumimos nombres de campo. Llega al frontend en la respuesta JSON para poder
// pintarlo el día que conozcamos su forma, sin tocar el Worker.
export function parseReturnOrderResponse(json) {
  if (!json || !json.returnOrderId) {
    throw new Error('GLS respondió sin returnOrderId');
  }
  return {
    returnOrderId: json.returnOrderId,
    dropOffLocation: json.dropOffLocations?.data?.[0] ?? null,
  };
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/gls.js worker/tests/gls.test.js
git commit -m "feat(gls): parsear la respuesta de creacion de devolucion"
```

---

### Task 7: `createReturnOrder`

**Files:**
- Modify: `worker/src/gls.js`
- Test: `worker/tests/gls.test.js`

- [ ] **Step 1: Escribir el test que falla**

Añadir `createReturnOrder` al import y estos tests al final de `worker/tests/gls.test.js`:

```js
test('createReturnOrder hace POST autenticado al portal correcto', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(
      url,
      'https://api.gls-group.net/order-management/shop-returns/portal/v3/climberup/return-orders',
    );
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'clave-abc');
    assert.equal(options.headers['X-Portal-Token'], 'token-123');
    assert.equal(options.headers['X-Portal-Name'], 'climberup');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(JSON.parse(options.body).originalOrderReference, 'GLS-1');
    return { ok: true, json: async () => ({ returnOrderId: 'RET-99' }) };
  };
  const json = await createReturnOrder({ originalOrderReference: 'GLS-1' }, env, fakeFetch);
  assert.equal(json.returnOrderId, 'RET-99');
});

test('createReturnOrder lanza error si GLS responde con error HTTP', async () => {
  const fakeFetch = async () => ({ ok: false, status: 422 });
  await assert.rejects(
    () => createReturnOrder({}, env, fakeFetch),
    /422/,
  );
});

test('createReturnOrder aborta la petición si GLS no responde a tiempo', async () => {
  const fakeFetch = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('AbortError')));
    });
  await assert.rejects(() => createReturnOrder({}, env, fakeFetch, 10), /AbortError/);
});
```

El import queda:

```js
import { buildReturnOrderRequest, parseReturnOrderResponse, createReturnOrder } from '../src/gls.js';
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd worker && npm test`
Expected: FAIL — `createReturnOrder is not a function`

- [ ] **Step 3: Implementar**

Añadir a `worker/src/gls.js`:

```js
const TIMEOUT_MS = 10000;

export async function createReturnOrder(request, env, fetchFn = fetch, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const temporizador = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${env.GLS_API_BASE}/${env.GLS_PORTAL_NAME}/return-orders`, {
      method: 'POST',
      headers: {
        Authorization: env.GLS_CLIENT_KEY,
        'X-Portal-Token': env.GLS_PORTAL_TOKEN,
        'X-Portal-Name': env.GLS_PORTAL_NAME,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GLS rechazó la creación de la devolución (HTTP ${response.status})`);
    }
    return await response.json();
  } finally {
    clearTimeout(temporizador);
  }
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/gls.js worker/tests/gls.test.js
git commit -m "feat(gls): llamada HTTP con timeout de 10s"
```

---

### Task 8: Emails con dirección desglosada y modos A/B

**Files:**
- Modify: `worker/src/resend.js`
- Test: `worker/tests/resend.test.js`

- [ ] **Step 1: Escribir el test que falla**

En `worker/tests/resend.test.js`, sustituir el `orderPayload` de cabecera (líneas 5-24) por:

```js
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

const glsOk = { ok: true, returnOrderId: 'RET-99', dropOffLocation: null };
const glsFallo = {
  ok: false,
  error: 'HTTP 500',
  portalUrl: 'https://returns.gls-group.com/climberup/create-return',
};
```

Sustituir los tests `buildOwnerEmail va dirigido...`, `buildCustomerEmail va dirigido...` y
`buildOwnerEmail omite la línea de envío...` por:

```js
test('buildOwnerEmail incluye el carrito, el envío y la dirección desglosada', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsOk);
  assert.deepEqual(email.to, ['owner@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Ana Pérez/);
  assert.match(email.html, /pie_de_gato · resolado_completo \(vibram_xs_grip2\) ×2 — 70\.00€/);
  assert.match(email.html, /Envío GLS: 5\.00€/);
  assert.match(email.html, /75\.00€/);
  assert.match(email.html, /Carrer Major 12/);
  assert.match(email.html, /25700/);
  assert.match(email.html, /La Seu d'Urgell/);
});

test('buildOwnerEmail muestra la referencia de la devolución cuando GLS respondió', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', glsOk);
  assert.match(email.html, /Devolución GLS: RET-99/);
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
  assert.match(email.html, /pie_de_gato · resolado_completo/);
  assert.match(email.html, /RET-99/);
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
```

En los tres tests de escapado HTML que quedan, añadir el tercer argumento `glsOk` a cada llamada a
`buildOwnerEmail` y `buildCustomerEmail`. Y sustituir el último test completo por:

```js
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

test('buildOwnerEmail escapa el returnOrderId y el error que vienen de GLS', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com', {
    ok: false,
    error: '<script>alert(1)</script>',
    portalUrl: 'https://returns.gls-group.com/climberup/create-return',
  });
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd worker && npm test`
Expected: FAIL — el HTML no contiene `Carrer Major 12`

- [ ] **Step 3: Implementar**

En `worker/src/resend.js`, sustituir `entregaTexto` por estas tres funciones:

```js
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
    return `<li>Devolución GLS: ${escapeHtml(gls.returnOrderId)}</li>`;
  }
  return `<li><strong>⚠️ No se pudo crear la devolución GLS automáticamente — el cliente ha recibido instrucciones manuales.</strong> Motivo: ${escapeHtml(gls?.error ?? 'desconocido')}</li>`;
}

function glsHtmlCliente(orderPayload, gls) {
  if (gls && gls.ok) {
    return `
      <p><strong>GLS te ha enviado</strong> un email aparte con tu etiqueta de envío y el código QR
      para dejar el paquete en tu punto GLS más cercano.</p>
      <p>Referencia de la devolución: <strong>${escapeHtml(gls.returnOrderId)}</strong></p>
    `;
  }
  const { orderId, nombre, email, direccion } = orderPayload;
  return `
    <h3>Crea tu etiqueta de envío</h3>
    <p>No hemos podido generar tu etiqueta automáticamente. Créala tú en el portal de GLS —tarda
    menos de un minuto— con estos datos:</p>
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
```

Sustituir `buildOwnerEmail` y `buildCustomerEmail` por:

```js
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
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/resend.js worker/tests/resend.test.js
git commit -m "feat(resend): direccion desglosada y emails en modo automatico o manual"
```

---

### Task 9: Metadatos de Stripe con la dirección desglosada

**Files:**
- Modify: `worker/src/stripe.js:3-49,60-73`
- Test: `worker/tests/stripe.test.js`

- [ ] **Step 1: Escribir el test que falla**

En `worker/tests/stripe.test.js`, sustituir el `orderPayload` de cabecera (líneas 12-31) por:

```js
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
  lang: 'ca',
  metodoPago: 'tarjeta',
};
```

Sustituir el primer test y el de `orderPayloadFromSession` por:

```js
test('buildCheckoutSessionParams genera un line_item por línea del carrito más el envío', () => {
  const params = buildCheckoutSessionParams(orderPayload, 'https://griplaseu.es');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('customer_email'), 'ana@example.com');
  assert.equal(params.get('line_items[0][quantity]'), '2');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '3500');
  assert.match(params.get('line_items[0][price_data][product_data][name]'), /resolado_completo/);
  assert.equal(params.get('line_items[1][quantity]'), '1');
  assert.equal(params.get('line_items[1][price_data][unit_amount]'), '500');
  assert.equal(params.get('line_items[1][price_data][product_data][name]'), 'Envío GLS');
  assert.equal(params.get('metadata[order_id]'), 'GLS-1');
  assert.equal(params.get('metadata[nombre]'), 'Ana Pérez');
  assert.equal(params.get('metadata[transporte]'), '5');
  assert.equal(params.get('metadata[calle]'), 'Carrer Major');
  assert.equal(params.get('metadata[numero]'), '12');
  assert.equal(params.get('metadata[cp]'), '25700');
  assert.equal(params.get('metadata[ciudad]'), "La Seu d'Urgell");
  assert.equal(params.get('metadata[pais]'), 'ES');
  assert.equal(params.get('metadata[lang]'), 'ca');
  assert.equal(params.get('metadata[direccion]'), null);
  assert.equal(params.get('metadata[entrega_tipo]'), null);
  assert.match(params.get('success_url'), /gracias\.html\?session_id=\{CHECKOUT_SESSION_ID\}/);
});

test('orderPayloadFromSession reconstruye el pedido con la dirección desglosada', () => {
  const session = {
    customer_email: 'ana@example.com',
    line_items: {
      data: [
        {
          description: 'resolado_completo (pie_de_gato) (vibram_xs_grip2)',
          quantity: 2,
          amount_total: 7000,
          price: { unit_amount: 3500 },
        },
      ],
    },
    metadata: {
      order_id: 'GLS-1',
      nombre: 'Ana Pérez',
      telefono: '+34612345678',
      precio_total: '70',
      transporte: '0',
      calle: 'Carrer Major',
      numero: '12',
      cp: '25700',
      ciudad: "La Seu d'Urgell",
      pais: 'ES',
      lang: 'ca',
    },
  };
  const result = orderPayloadFromSession(session);
  assert.equal(result.orderId, 'GLS-1');
  assert.equal(result.carrito.length, 1);
  assert.equal(result.transporte, 0);
  assert.equal(result.precioTotal, 70);
  assert.equal(result.email, 'ana@example.com');
  assert.equal(result.lang, 'ca');
  assert.deepEqual(result.direccion, {
    calle: 'Carrer Major',
    numero: '12',
    codigoPostal: '25700',
    ciudad: "La Seu d'Urgell",
    pais: 'ES',
  });
  assert.equal(result.metodoPago, 'tarjeta');
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `cd worker && npm test`
Expected: FAIL — `metadata[calle]` es `null`

- [ ] **Step 3: Implementar**

En `worker/src/stripe.js`, cambiar la desestructuración de `buildCheckoutSessionParams`:

```js
export function buildCheckoutSessionParams(orderPayload, siteUrl) {
  const { orderId, carrito, transporte, nombre, direccion, telefono, email, lang, precioTotal } =
    orderPayload;
```

y sustituir el bloque de `params.set('metadata[...]')` final por:

```js
  params.set('metadata[order_id]', orderId);
  params.set('metadata[nombre]', nombre);
  params.set('metadata[telefono]', telefono);
  params.set('metadata[precio_total]', String(precioTotal));
  params.set('metadata[transporte]', String(transporte));
  params.set('metadata[calle]', direccion.calle);
  params.set('metadata[numero]', direccion.numero);
  params.set('metadata[cp]', direccion.codigoPostal);
  params.set('metadata[ciudad]', direccion.ciudad);
  params.set('metadata[pais]', direccion.pais);
  params.set('metadata[lang]', lang);
  return params;
}
```

Sustituir `orderPayloadFromSession` por:

```js
export function orderPayloadFromSession(session) {
  const m = session.metadata || {};
  return {
    orderId: m.order_id,
    carrito: buildCarritoFromLineItems(session),
    transporte: Number(m.transporte || 0),
    precioTotal: Number(m.precio_total),
    nombre: m.nombre,
    telefono: m.telefono,
    email: session.customer_email,
    direccion: {
      calle: m.calle,
      numero: m.numero,
      codigoPostal: m.cp,
      ciudad: m.ciudad,
      pais: m.pais,
    },
    lang: m.lang,
    metodoPago: 'tarjeta',
  };
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/stripe.js worker/tests/stripe.test.js
git commit -m "feat(stripe): metadatos con la direccion desglosada y el idioma"
```

---

### Task 10: Configuración del Worker

**Files:**
- Modify: `worker/wrangler.toml`

- [ ] **Step 1: Crear el namespace KV**

```bash
cd worker && npx wrangler kv namespace create PEDIDOS
```

Expected: imprime un bloque con el `id` del namespace. Copiarlo para el paso siguiente.

- [ ] **Step 2: Añadir vars y binding a `worker/wrangler.toml`**

Añadir dentro del bloque `[vars]` existente:

```toml
GLS_API_BASE = "https://api.gls-group.net/order-management/shop-returns/portal/v3"
GLS_PORTAL_NAME = "climberup"
GLS_RETURN_REASON = "Sin motivo específico"
GLS_PORTAL_URL = "https://returns.gls-group.com/climberup/create-return"
```

Y al final del fichero, con el `id` del paso anterior:

```toml
[[kv_namespaces]]
binding = "PEDIDOS"
id = "<id devuelto por wrangler>"
```

- [ ] **Step 3: Guardar los secretos**

```bash
cd worker && npx wrangler secret put GLS_PORTAL_TOKEN
```

Valor: `2f0d7071-c24f-40aa-8a73-69308932c872`

```bash
cd worker && npx wrangler secret put GLS_CLIENT_KEY
```

Valor: `x4DAdY3YJ9Ggq28xDMJPKJqGYnUHn48U`

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): vars de GLS y namespace KV para deduplicar pedidos"
```

---

### Task 11: Orquestación y deduplicación en el Worker

**Files:**
- Modify: `worker/src/index.js`

- [ ] **Step 1: Reescribir `worker/src/index.js`**

No hay test automático para este fichero (el repo no tiene tests de `index.js`; se valida en la
Tarea 16). Reemplazar su contenido completo por:

```js
// worker/src/index.js
import { buildCorsHeaders } from './cors.js';
import {
  buildCheckoutSessionParams,
  createStripeSession,
  retrieveStripeSession,
  parseSessionPaymentStatus,
  orderPayloadFromSession,
} from './stripe.js';
import { buildOwnerEmail, buildCustomerEmail, sendEmail } from './resend.js';
import { buildReturnOrderRequest, createReturnOrder, parseReturnOrderResponse } from './gls.js';

const KV_TTL_SEGUNDOS = 60 * 60 * 24 * 90;

// El binding es opcional a propósito: sin él (dev local, tests) el Worker sigue funcionando,
// simplemente sin deduplicar.
async function leerProcesado(env, clave) {
  if (!env.PEDIDOS) return null;
  const raw = await env.PEDIDOS.get(clave);
  return raw ? JSON.parse(raw) : null;
}

async function guardarProcesado(env, clave, valor) {
  if (!env.PEDIDOS) return;
  await env.PEDIDOS.put(clave, JSON.stringify(valor), { expirationTtl: KV_TTL_SEGUNDOS });
}

// Nunca lanza: un fallo de GLS no puede tumbar un pedido ya confirmado o ya cobrado.
// El propietario se entera por el aviso que buildOwnerEmail añade cuando ok es false.
async function resolveGlsReturn(orderPayload, env) {
  try {
    const request = buildReturnOrderRequest(orderPayload, env);
    const json = await createReturnOrder(request, env);
    return { ok: true, ...parseReturnOrderResponse(json) };
  } catch (error) {
    console.error('No se pudo crear la devolución GLS', error);
    return { ok: false, error: error.message, portalUrl: env.GLS_PORTAL_URL };
  }
}

async function enviarEmails(orderPayload, gls, env) {
  await Promise.all([
    sendEmail(buildOwnerEmail(orderPayload, env.OWNER_EMAIL, gls), env.RESEND_API_KEY),
    sendEmail(buildCustomerEmail(orderPayload, orderPayload.email, gls), env.RESEND_API_KEY),
  ]);
}

async function handleCreateCheckoutSession(request, env, cors) {
  const orderPayload = await request.json();
  const params = buildCheckoutSessionParams(orderPayload, env.SITE_URL);
  const session = await createStripeSession(params, env.STRIPE_SECRET_KEY);
  return Response.json({ url: session.url }, { headers: cors });
}

async function handleNotifyOrder(request, env, cors) {
  const orderPayload = await request.json();
  const clave = `order:${orderPayload.orderId}`;

  const yaProcesado = await leerProcesado(env, clave);
  if (yaProcesado) {
    return Response.json({ ok: true, gls: yaProcesado.gls }, { headers: cors });
  }

  const gls = await resolveGlsReturn(orderPayload, env);
  await enviarEmails(orderPayload, gls, env);
  await guardarProcesado(env, clave, { gls, processedAt: new Date().toISOString() });

  return Response.json({ ok: true, gls }, { headers: cors });
}

async function handleConfirmPayment(url, env, cors) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return Response.json({ error: 'session_id inválido' }, { status: 400, headers: cors });
  }

  const clave = `session:${sessionId}`;
  const yaProcesado = await leerProcesado(env, clave);
  if (yaProcesado) {
    return Response.json(
      {
        ok: true,
        paid: true,
        orderId: yaProcesado.order.orderId,
        order: yaProcesado.order,
        gls: yaProcesado.gls,
      },
      { headers: cors },
    );
  }

  const session = await retrieveStripeSession(sessionId, env.STRIPE_SECRET_KEY);
  if (!parseSessionPaymentStatus(session)) {
    return Response.json({ ok: true, paid: false }, { headers: cors });
  }

  const orderPayload = orderPayloadFromSession(session);
  const gls = await resolveGlsReturn(orderPayload, env);
  await enviarEmails(orderPayload, gls, env);
  await guardarProcesado(env, clave, {
    gls,
    order: orderPayload,
    processedAt: new Date().toISOString(),
  });

  return Response.json(
    { ok: true, paid: true, orderId: orderPayload.orderId, order: orderPayload, gls },
    { headers: cors },
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = buildCorsHeaders(origin, env.ALLOWED_ORIGIN);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (request.method === 'POST' && url.pathname === '/api/create-checkout-session') {
        return await handleCreateCheckoutSession(request, env, cors);
      }
      if (request.method === 'POST' && url.pathname === '/api/notify-order') {
        return await handleNotifyOrder(request, env, cors);
      }
      if (request.method === 'GET' && url.pathname === '/api/confirm-payment') {
        return await handleConfirmPayment(url, env, cors);
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500, headers: cors });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
```

- [ ] **Step 2: Ejecutar los tests del worker**

Run: `cd worker && npm test`
Expected: PASS

- [ ] **Step 3: Verificar que el Worker arranca**

Run: `cd worker && npx wrangler dev --port 8787`
Expected: arranca sin errores de importación. Parar con Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.js
git commit -m "feat(worker): crear devolucion GLS al confirmar y deduplicar con KV"
```

---

## Fase 3 — UI del frontend

### Task 12: Interpolación en `t()`

**Files:**
- Modify: `js/i18n.js:246-249`
- Test: `tests/i18n.test.js`

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `tests/i18n.test.js`:

```js
test('t() sustituye los parámetros entre llaves', () => {
  assert.equal(t('es', 'envio_falta_para_gratis', { importe: '12.00' }), 'Te faltan 12.00€ para el envío gratis');
});

test('t() deja el placeholder intacto si no se le pasa el parámetro', () => {
  assert.match(t('es', 'envio_falta_para_gratis'), /\{importe\}/);
});
```

Este test depende de la clave `envio_falta_para_gratis`, que se añade en la Tarea 13. Ejecutar las
Tareas 12 y 13 seguidas; el test queda en rojo entre medias.

- [ ] **Step 2: Ejecutar el test para verificar que falla**

Run: `npm test`
Expected: FAIL — devuelve la clave `envio_falta_para_gratis` en vez del texto

- [ ] **Step 3: Implementar**

Sustituir la función `t` al final de `js/i18n.js` por:

```js
export function t(lang, key, params = {}) {
  const dict = DICT[lang] || DICT.ca;
  const plantilla = dict[key] ?? key;
  return plantilla.replace(/\{(\w+)\}/g, (coincidencia, nombre) =>
    Object.prototype.hasOwnProperty.call(params, nombre) ? String(params[nombre]) : coincidencia,
  );
}
```

- [ ] **Step 4: Continuar con la Tarea 13 antes de ejecutar los tests**

El test sigue en rojo hasta que exista la clave. No hacer commit todavía.

---

### Task 13: Claves de traducción

**Files:**
- Modify: `js/i18n.js`

- [ ] **Step 1: Quitar las claves muertas**

En los **cuatro** idiomas (`ca`, `es`, `en`, `pt`), borrar estas líneas:

- `entrega_label`
- `entrega_gls`
- `entrega_tienda`
- `puntos_cercanos_title`
- `puntos_geocode_error`
- `tiendas_title`
- `pago_efectivo`
- `pago_efectivo_solo_tienda`

- [ ] **Step 2: Añadir las claves nuevas**

En `ca`, junto a `direccion_label`:

```js
    calle_label: 'Carrer',
    numero_label: 'Número',
    cp_label: 'Codi postal',
    ciudad_label: 'Ciutat',
    pais_label: 'País',
    pais_es: 'Espanya',
    pais_pt: 'Portugal',
    envio_gratis: 'Enviament gratuït',
    envio_falta_para_gratis: 'Et falten {importe}€ per a l\'enviament gratuït',
    gls_etiqueta_enviada: 'GLS t\'ha enviat un email amb la teva etiqueta d\'enviament i el codi QR.',
    gls_referencia: 'Referència de la devolució',
    gls_manual_title: 'Crea la teva etiqueta d\'enviament',
    gls_manual_desc: 'No hem pogut generar la teva etiqueta automàticament. Crea-la al portal de GLS amb aquestes dades:',
    gls_manual_link: 'Obrir el portal de GLS',
    btn_copiar: 'Copiar',
    btn_copiado: 'Copiat',
```

En `es`:

```js
    calle_label: 'Calle',
    numero_label: 'Número',
    cp_label: 'Código postal',
    ciudad_label: 'Ciudad',
    pais_label: 'País',
    pais_es: 'España',
    pais_pt: 'Portugal',
    envio_gratis: 'Envío gratis',
    envio_falta_para_gratis: 'Te faltan {importe}€ para el envío gratis',
    gls_etiqueta_enviada: 'GLS te ha enviado un email con tu etiqueta de envío y el código QR.',
    gls_referencia: 'Referencia de la devolución',
    gls_manual_title: 'Crea tu etiqueta de envío',
    gls_manual_desc: 'No hemos podido generar tu etiqueta automáticamente. Créala en el portal de GLS con estos datos:',
    gls_manual_link: 'Abrir el portal de GLS',
    btn_copiar: 'Copiar',
    btn_copiado: 'Copiado',
```

En `en`:

```js
    calle_label: 'Street',
    numero_label: 'Number',
    cp_label: 'Postcode',
    ciudad_label: 'City',
    pais_label: 'Country',
    pais_es: 'Spain',
    pais_pt: 'Portugal',
    envio_gratis: 'Free shipping',
    envio_falta_para_gratis: 'You are {importe}€ away from free shipping',
    gls_etiqueta_enviada: 'GLS has emailed you your shipping label and QR code.',
    gls_referencia: 'Return reference',
    gls_manual_title: 'Create your shipping label',
    gls_manual_desc: 'We could not generate your label automatically. Create it on the GLS portal with these details:',
    gls_manual_link: 'Open the GLS portal',
    btn_copiar: 'Copy',
    btn_copiado: 'Copied',
```

En `pt`:

```js
    calle_label: 'Rua',
    numero_label: 'Número',
    cp_label: 'Código postal',
    ciudad_label: 'Cidade',
    pais_label: 'País',
    pais_es: 'Espanha',
    pais_pt: 'Portugal',
    envio_gratis: 'Envio grátis',
    envio_falta_para_gratis: 'Faltam-te {importe}€ para o envio grátis',
    gls_etiqueta_enviada: 'A GLS enviou-te um email com a tua etiqueta de envio e o código QR.',
    gls_referencia: 'Referência da devolução',
    gls_manual_title: 'Cria a tua etiqueta de envio',
    gls_manual_desc: 'Não conseguimos gerar a tua etiqueta automaticamente. Cria-a no portal da GLS com estes dados:',
    gls_manual_link: 'Abrir o portal da GLS',
    btn_copiar: 'Copiar',
    btn_copiado: 'Copiado',
```

- [ ] **Step 3: Ejecutar los tests**

Run: `npm test`
Expected: PASS. El test `todas las lenguas tienen exactamente las mismas claves` verifica que no
se ha olvidado ninguna clave en ningún idioma.

- [ ] **Step 4: Commit**

```bash
git add js/i18n.js tests/i18n.test.js
git commit -m "feat(i18n): interpolacion en t() y textos de direccion y etiqueta GLS"
```

---

### Task 14: Estado del formulario

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Actualizar los imports**

Sustituir las líneas 1-12 de `js/app.js` por:

```js
// js/app.js
import { LANGS, t } from './i18n.js';
import { PRECIOS, PRECIO_TRANSPORTE_GLS, ENVIO_GRATIS_DESDE } from './precios.js';
import { calculateLinePrice, minPrecioServicio, calcularTransporte } from './pricing.js';
import { isNonEmpty, isValidPhone, isValidPostalCode, isValidEmail } from './validation.js';
import { generateOrderId, buildOrderSummary } from './order.js';
import { createCheckoutSession, notifyOrder } from './api.js';
import { API_BASE_URL } from './config.js';
```

- [ ] **Step 2: Pasar los parámetros al magic `$t`**

Sustituir la línea `Alpine.magic('t', () => (key) => t(Alpine.store('i18n').lang, key));` por:

```js
  Alpine.magic('t', () => (key, params) => t(Alpine.store('i18n').lang, key, params));
```

- [ ] **Step 3: Sustituir el estado del paso 2**

Sustituir el bloque que va desde `// Paso 2` hasta `geocodeError: false,` (ambos incluidos) por:

```js
    // Paso 2
    nombre: '',
    telefono: '',
    email: '',
    calle: '',
    numero: '',
    codigoPostal: '',
    ciudad: '',
    pais: 'ES',

    // Resultado de la devolución GLS, lo devuelve el Worker
    gls: null,
    copiado: '',
```

Y borrar la línea `transporteGLS: PRECIO_TRANSPORTE_GLS,` del bloque del paso 1.

- [ ] **Step 4: Sustituir los getters de transporte y validación**

Sustituir los getters `incluyeTransporte` y `precioTotal` por:

```js
    get transporte() {
      return calcularTransporte(this.totalCarrito, PRECIO_TRANSPORTE_GLS, ENVIO_GRATIS_DESDE);
    },

    get faltaParaEnvioGratis() {
      return Math.max(0, ENVIO_GRATIS_DESDE - this.totalCarrito);
    },

    get precioTotal() {
      return this.totalCarrito + this.transporte;
    },
```

Sustituir el getter `canProceedStep2` por:

```js
    get canProceedStep2() {
      return Boolean(
        isNonEmpty(this.nombre) &&
          isValidEmail(this.email) &&
          isValidPhone(this.telefono, this.pais) &&
          isNonEmpty(this.calle) &&
          isNonEmpty(this.numero) &&
          isValidPostalCode(this.codigoPostal, this.pais) &&
          isNonEmpty(this.ciudad),
      );
    },
```

- [ ] **Step 5: Borrar `buscarPuntosGLS` y actualizar el payload**

Borrar el método `async buscarPuntosGLS() { ... }` completo.

Sustituir `buildOrderPayload` por:

```js
    buildOrderPayload() {
      if (!this.orderId) {
        this.orderId = generateOrderId();
      }
      return {
        orderId: this.orderId,
        carrito: this.carrito.map((linea) => ({ ...linea })),
        transporte: this.transporte,
        precioTotal: this.precioTotal,
        nombre: this.nombre,
        telefono: this.telefono,
        email: this.email,
        direccion: {
          calle: this.calle,
          numero: this.numero,
          codigoPostal: this.codigoPostal,
          ciudad: this.ciudad,
          pais: this.pais,
        },
        lang: Alpine.store('i18n').lang,
        metodoPago: this.metodoPago,
      };
    },

    get datosParaPortal() {
      return [
        { etiqueta: 'Número de pedido', valor: this.orderId },
        { etiqueta: 'Motivo de devolución', valor: 'Sin motivo específico' },
        { etiqueta: 'Nombre', valor: this.nombre },
        { etiqueta: 'Correo electrónico', valor: this.email },
        { etiqueta: 'Calle', valor: this.calle },
        { etiqueta: 'Número', valor: this.numero },
        { etiqueta: 'Código postal', valor: this.codigoPostal },
        { etiqueta: 'Ciudad', valor: this.ciudad },
        { etiqueta: 'País', valor: this.pais },
      ];
    },

    async copiar(valor) {
      await navigator.clipboard.writeText(valor);
      this.copiado = valor;
      setTimeout(() => {
        if (this.copiado === valor) this.copiado = '';
      }, 2000);
    },
```

- [ ] **Step 6: Guardar el resultado de GLS al confirmar**

Sustituir el cuerpo del `try` de `confirmarPedido` por:

```js
        const payload = this.buildOrderPayload();
        const respuesta = await notifyOrder(API_BASE_URL, payload);
        this.gls = respuesta.gls ?? { ok: false };
        this.summaryLines = buildOrderSummary({ ...payload, gls: this.gls }).lineas;
        this.success = true;
```

- [ ] **Step 7: Verificar que no quedan referencias muertas**

Run: `grep -n "entregaTipo\|entregaNombre\|puntosCercanos\|geocodeError\|transporteGLS\|incluyeTransporte\|isValidSpanishPhone\|puntos-gls\|tiendas\|geo\.js\|geocode" js/app.js`
Expected: sin resultados

- [ ] **Step 8: Commit**

```bash
git add js/app.js
git commit -m "feat(app): direccion desglosada y transporte por umbral en el formulario"
```

---

### Task 15: Formulario y pantalla de éxito

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Actualizar el total del paso 1**

Sustituir la línea del `<p class="price-total" x-show="carrito.length > 0" ...>` del paso 1 por:

```html
            <p class="price-total" x-show="carrito.length > 0" x-text="$t('precio_total_label') + ': ' + totalCarrito.toFixed(2) + '€'"></p>
            <p class="shipping-note" x-show="carrito.length > 0" x-text="transporte === 0 ? $t('envio_gratis') : $t('envio_falta_para_gratis', { importe: faltaParaEnvioGratis.toFixed(2) })"></p>
```

- [ ] **Step 2: Sustituir el paso 2 completo**

Sustituir el bloque `<template x-if="!success && step === 2">…</template>` entero por:

```html
        <template x-if="!success && step === 2">
          <div>
            <h2 x-text="$t('step2_title')"></h2>

            <div class="form-field">
              <label for="of-nombre" x-text="$t('nombre_label')"></label>
              <input id="of-nombre" type="text" maxlength="40" x-model="nombre" />
            </div>
            <div class="form-field">
              <label for="of-email" x-text="$t('email_label')"></label>
              <input id="of-email" type="email" maxlength="255" x-model="email" />
            </div>
            <div class="form-field">
              <label for="of-telefono" x-text="$t('telefono_label')"></label>
              <input id="of-telefono" type="tel" x-model="telefono" />
            </div>

            <h3 x-text="$t('direccion_label')"></h3>

            <div class="form-field">
              <label for="of-pais" x-text="$t('pais_label')"></label>
              <select id="of-pais" x-model="pais">
                <option value="ES" x-text="$t('pais_es')"></option>
                <option value="PT" x-text="$t('pais_pt')"></option>
              </select>
            </div>
            <div class="form-field">
              <label for="of-calle" x-text="$t('calle_label')"></label>
              <input id="of-calle" type="text" maxlength="40" x-model="calle" />
            </div>
            <div class="form-field">
              <label for="of-numero" x-text="$t('numero_label')"></label>
              <input id="of-numero" type="text" maxlength="6" x-model="numero" />
            </div>
            <div class="form-field">
              <label for="of-cp" x-text="$t('cp_label')"></label>
              <input id="of-cp" type="text" maxlength="10" x-model="codigoPostal" />
            </div>
            <div class="form-field">
              <label for="of-ciudad" x-text="$t('ciudad_label')"></label>
              <input id="of-ciudad" type="text" maxlength="40" x-model="ciudad" />
            </div>

            <p class="price-total" x-text="$t('precio_total_label') + ': ' + precioTotal.toFixed(2) + '€'"></p>
            <p class="shipping-note" x-text="transporte === 0 ? $t('envio_gratis') : ($t('envio_gls_label') + ': ' + transporte.toFixed(2) + '€')"></p>

            <div class="modal-nav">
              <button type="button" class="btn btn-secondary" @click="step = 1" x-text="$t('btn_atras')"></button>
              <button type="button" class="btn btn-primary" :disabled="!canProceedStep2" @click="step = 3" x-text="$t('btn_siguiente')"></button>
            </div>
          </div>
        </template>
```

- [ ] **Step 3: Quitar el pago en efectivo del paso 3**

Borrar del paso 3 el botón de efectivo y el aviso asociado:

```html
              <button type="button" class="toggle-option" :class="{ selected: metodoPago === 'efectivo' }" :disabled="entregaTipo !== 'tienda'" @click="metodoPago = 'efectivo'" x-text="$t('pago_efectivo')"></button>
```

```html
            <p class="error-message" x-show="entregaTipo !== 'tienda'" x-text="$t('pago_efectivo_solo_tienda')"></p>
```

Y el botón de confirmación exclusivo de efectivo:

```html
              <button type="button" class="btn btn-primary" x-show="metodoPago === 'efectivo'" :disabled="submitting" @click="confirmarPedido()" x-text="$t('btn_confirmar_pedido')"></button>
```

- [ ] **Step 4: Sustituir el bloque de éxito**

Sustituir el bloque `<template x-if="success">…</template>` por:

```html
        <template x-if="success">
          <div>
            <h2 x-text="$t('gracias_title')"></h2>
            <p x-text="$t('gracias_paid')"></p>
            <p><strong x-text="orderId"></strong></p>
            <ul class="point-list">
              <template x-for="linea in summaryLines" :key="linea">
                <li x-text="linea"></li>
              </template>
            </ul>

            <template x-if="gls && gls.ok">
              <div class="gls-result">
                <p x-text="$t('gls_etiqueta_enviada')"></p>
                <p x-text="$t('gls_referencia') + ': ' + gls.returnOrderId"></p>
              </div>
            </template>

            <template x-if="gls && !gls.ok">
              <div class="gls-result gls-manual">
                <h3 x-text="$t('gls_manual_title')"></h3>
                <p x-text="$t('gls_manual_desc')"></p>
                <ul class="copy-list">
                  <template x-for="dato in datosParaPortal" :key="dato.etiqueta">
                    <li>
                      <span class="copy-label" x-text="dato.etiqueta"></span>
                      <span class="copy-value" x-text="dato.valor"></span>
                      <button type="button" class="btn btn-secondary" @click="copiar(dato.valor)" x-text="copiado === dato.valor ? $t('btn_copiado') : $t('btn_copiar')"></button>
                    </li>
                  </template>
                </ul>
                <a class="btn btn-primary" :href="gls.portalUrl" target="_blank" rel="noopener" x-text="$t('gls_manual_link')"></a>
              </div>
            </template>
          </div>
        </template>
```

- [ ] **Step 5: Verificar que no quedan referencias muertas en el HTML**

Run: `grep -n "entregaTipo\|entregaNombre\|puntosCercanos\|geocodeError\|transporteGLS\|incluyeTransporte\|buscarPuntosGLS\|tiendas\|puntos_cercanos\|entrega_\|pago_efectivo" index.html`
Expected: sin resultados

- [ ] **Step 6: Estilar las clases nuevas**

En `css/styles.css`, quitar el selector `.delivery-option-card` de las tres reglas donde aparece
(líneas 516, 525-527 y 532), dejando solo `.payment-option-card`. Las tres reglas quedan así:

```css
.payment-option-card {
  border: 1px solid var(--color-slate);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
}

.payment-option-card:hover,
.payment-option-card:focus-visible {
  border-color: var(--color-amber);
}

.payment-option-card.selected {
  border-color: var(--color-amber);
  background: #fff7ea;
}
```

Y añadir al final del fichero:

```css
.shipping-note {
  font-size: 0.9rem;
  color: var(--color-slate);
  margin: -1rem 0 1.5rem;
}

.gls-result {
  border-top: 1px solid var(--color-border-light);
  margin-top: 1.5rem;
  padding-top: 1rem;
}

.gls-manual {
  border: 1px solid var(--color-amber);
  border-radius: var(--radius);
  padding: 1rem;
}

.copy-list {
  list-style: none;
  padding: 0;
  margin: 0.75rem 0;
}

.copy-list li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border-light);
}

.copy-label {
  flex: 0 0 40%;
  font-size: 0.8rem;
  text-transform: uppercase;
  color: var(--color-slate);
}

.copy-value {
  flex: 1;
  font-weight: 600;
  word-break: break-word;
}
```

- [ ] **Step 7: Probar el formulario en el navegador**

Run: `npx serve . -l 3000` (o cualquier servidor estático) y abrir `http://localhost:3000`

Comprobar:
- El carrito muestra "Te faltan X€ para el envío gratis" con menos de 150€ y "Envío gratis" a partir de 150€.
- El paso 2 no deja avanzar con un CP de 4 dígitos si el país es ES, y sí con uno de 5.
- Cambiar el país a PT hace que `912345678` sea un teléfono válido y `612345678` no.

- [ ] **Step 8: Commit**

```bash
git add index.html css/styles.css
git commit -m "feat(form): direccion desglosada, envio por umbral y resultado GLS"
```

---

### Task 16: Pantalla de gracias tras el pago con tarjeta

**Files:**
- Modify: `js/gracias.js`

- [ ] **Step 1: Actualizar `js/gracias.js`**

Sustituir la función `render` y la llamada del caso pagado por:

```js
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

function renderGls(gls) {
  const contenedor = document.getElementById('gracias-gls');
  if (!contenedor) return;
  contenedor.replaceChildren();
  if (!gls) return;

  if (gls.ok) {
    const aviso = document.createElement('p');
    aviso.textContent = t(lang, 'gls_etiqueta_enviada');
    const referencia = document.createElement('p');
    referencia.textContent = `${t(lang, 'gls_referencia')}: ${gls.returnOrderId}`;
    contenedor.append(aviso, referencia);
    return;
  }

  const titulo = document.createElement('h3');
  titulo.textContent = t(lang, 'gls_manual_title');
  const descripcion = document.createElement('p');
  descripcion.textContent = t(lang, 'gls_manual_desc');
  const enlace = document.createElement('a');
  enlace.href = gls.portalUrl;
  enlace.target = '_blank';
  enlace.rel = 'noopener';
  enlace.textContent = t(lang, 'gls_manual_link');
  contenedor.append(titulo, descripcion, enlace);
}
```

Y en `run()`, sustituir la rama de pago confirmado por:

```js
    if (result.paid) {
      const summaryLines = buildOrderSummary({ ...result.order, gls: result.gls }).lineas;
      render('gracias_title', 'gracias_paid', result.orderId, summaryLines, result.gls);
    } else {
```

- [ ] **Step 2: Añadir el contenedor a `gracias.html`**

Añadir después del `<ul id="gracias-summary">`:

```html
    <div id="gracias-gls"></div>
```

- [ ] **Step 3: Ejecutar los tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/gracias.js gracias.html
git commit -m "feat(gracias): mostrar el resultado de la devolucion GLS tras pagar"
```

---

## Fase 4 — Validación

### Task 17: Validación contra la API real de GLS

> **PARAR AQUÍ Y PEDIR PERMISO AL PROPIETARIO.** Los pasos siguientes crean una devolución **real**
> en la cuenta de GLS de Grip La Seu, con su etiqueta y su coste. No ejecutarlos sin luz verde
> explícita, y anular la devolución de prueba desde el panel de GLS al terminar.

**Files:**
- Ninguno, salvo que la respuesta real obligue a ajustar `worker/src/gls.js`

- [ ] **Step 1: Confirmar con el propietario**

Preguntar explícitamente si se puede crear una devolución de prueba. Sin un sí, saltar a la Tarea 18.

- [ ] **Step 2: Lanzar el Worker en local**

```bash
cd worker && npx wrangler dev --port 8787
```

- [ ] **Step 3: Enviar un pedido de prueba**

```bash
curl -X POST http://localhost:8787/api/notify-order \
  -H 'Content-Type: application/json' \
  -d '{
    "orderId": "PRUEBA-GLS-001",
    "carrito": [{"tipoCalzado":"pie_de_gato","servicio":"resolado_completo","material":"vibram_xs_grip2","cantidad":1,"precioUnitario":44,"precioSubtotal":44}],
    "transporte": 5,
    "precioTotal": 49,
    "nombre": "Prueba Integracion",
    "telefono": "+34669918744",
    "email": "<email del propietario>",
    "direccion": {"calle":"Carrer Major","numero":"1","codigoPostal":"25700","ciudad":"La Seu d Urgell","pais":"ES"},
    "lang": "es",
    "metodoPago": "bizum"
  }'
```

Expected: `{"ok":true,"gls":{"ok":true,"returnOrderId":"...","dropOffLocation":{...}}}`

- [ ] **Step 4: Anotar la forma real de `dropOffLocation`**

Copiar el objeto `dropOffLocation` de la respuesta y pegarlo como comentario en
`worker/src/gls.js`, encima de `parseReturnOrderResponse`, para que la próxima iteración pueda
pintarlo sin volver a llamar a la API.

- [ ] **Step 5: Comprobar los emails**

Verificar que llegan tres: el del propietario con `Devolución GLS: <id>`, el del cliente con el
texto de modo A, y el propio de GLS con la etiqueta y el QR.

- [ ] **Step 6: Comprobar la deduplicación**

Repetir exactamente el mismo `curl` del paso 3.
Expected: la misma respuesta, **sin** que lleguen emails nuevos ni se cree una segunda devolución.

- [ ] **Step 7: Anular la devolución de prueba**

Entrar al panel de GLS y anular la devolución `PRUEBA-GLS-001`.

- [ ] **Step 8: Commit**

```bash
git add worker/src/gls.js
git commit -m "docs(gls): anotar la forma real de dropOffLocation"
```

---

### Task 18: Despliegue

**Files:**
- Ninguno

- [ ] **Step 1: Ejecutar la batería completa**

```bash
npm test && cd worker && npm test
```

Expected: PASS en ambos

- [ ] **Step 2: Desplegar el Worker**

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 3: Verificar que los secretos están puestos**

```bash
cd worker && npx wrangler secret list
```

Expected: aparecen `GLS_PORTAL_TOKEN`, `GLS_CLIENT_KEY`, `STRIPE_SECRET_KEY` y `RESEND_API_KEY`

- [ ] **Step 4: Publicar el frontend**

```bash
git push origin master
```

- [ ] **Step 5: Comprobar en producción**

Abrir `https://griplaseu.es`, hacer un pedido con pago por transferencia y confirmar que la
pantalla de éxito muestra el modo A o el modo B, y que llegan los emails.
