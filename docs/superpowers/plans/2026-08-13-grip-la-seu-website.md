# Grip La Seu Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a coste-0 website for Grip La Seu (resolado de calzado de escalada) with a hero/services landing page, a 3-step order form with live price calculation, GLS/tienda pickup selection, and Bizum/Transferencia/Stripe/Efectivo payment, notifying the owner and the customer by email via Resend.

**Architecture:** Static frontend (vanilla HTML/CSS/JS, Alpine.js via CDN, no build step) deployed to GitHub Pages. A minimal Cloudflare Workers backend exposes three endpoints (`create-checkout-session`, `notify-order`, `confirm-payment`) that hold the Stripe and Resend secret keys, called via `fetch` from the frontend. No database; the order data travels in the request payload and, for card payments, in Stripe Checkout Session metadata.

**Tech Stack:** HTML/CSS, vanilla JS (ES modules), Alpine.js (CDN), Node.js built-in test runner (`node --test`) for unit tests, Cloudflare Workers + `wrangler` for the backend, Stripe REST API, Resend REST API, OpenStreetMap Nominatim for geocoding.

**Reference spec:** `docs/superpowers/specs/2026-08-13-grip-la-seu-website-design.md`

---

## Shared data shape: `orderPayload`

Used consistently across frontend and worker modules:

```js
{
  orderId: 'GLS-20260813120000-A1B2',
  tipoCalzado: 'bota' | 'pie_de_gato',
  servicio: 'resolado_completo' | 'media_suela' | 'puntera',
  cantidad: 2,
  precioTotal: 90,
  nombre: 'Ana Pérez',
  direccion: 'Carrer Major 1, La Seu d\'Urgell',
  telefono: '+34612345678',
  email: 'ana@example.com',
  entrega: { tipo: 'gls' | 'tienda', nombre: 'Punt GLS Centre' },
  metodoPago: 'bizum' | 'transferencia' | 'tarjeta' | 'efectivo',
}
```

---

## Task 1: Scaffold repository structure

**Files:**
- Create: `.gitignore`
- Create: `package.json`

- [ ] **Step 1: Create directories**

Run:
```bash
mkdir -p js tests css assets worker/src worker/tests
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.wrangler/
worker/.dev.vars
.DS_Store
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "grip-la-seu",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

Note: the test script is `node --test` with **no path argument** (not `node --test tests/`).
On at least some Node 22 builds, passing a directory as an explicit positional
argument to `--test` fails with `MODULE_NOT_FOUND` — Node tries to `require()`
the directory itself instead of recursively discovering test files inside it.
Running `node --test` with no arguments triggers Node's default recursive
discovery from the current directory, which works correctly both when
`tests/` is empty and once it contains real `*.test.js` files. Verified
directly in this environment before writing this task.

- [ ] **Step 4: Verify Node is available and test runner works with zero tests**

Run: `node --test`
Expected: Node reports 0 tests found (no failures) — the `tests/` directory exists but is empty. This just confirms Node's test runner is usable before we add real tests in Task 2.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json js tests css assets worker
git commit -m "chore: scaffold project structure"
```

Note: empty directories aren't tracked by git; only `.gitignore` and `package.json` will actually be staged here. That's fine — later tasks populate the directories and commit their own files.

---

## Task 2: `js/pricing.js` — price calculation

**Files:**
- Create: `js/pricing.js`
- Test: `tests/pricing.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/pricing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice } from '../js/pricing.js';

const PRECIOS = {
  bota: { resolado_completo: 45, media_suela: 28, puntera: 15 },
  pie_de_gato: { resolado_completo: 35, media_suela: 20, puntera: 12 },
};

test('calcula el precio como precio unitario por cantidad', () => {
  assert.equal(calculatePrice(PRECIOS, 'pie_de_gato', 'resolado_completo', 2), 70);
});

test('lanza error si la cantidad no es un entero positivo', () => {
  assert.throws(() => calculatePrice(PRECIOS, 'bota', 'puntera', 0));
  assert.throws(() => calculatePrice(PRECIOS, 'bota', 'puntera', 1.5));
});

test('lanza error si el tipo de calzado es desconocido', () => {
  assert.throws(() => calculatePrice(PRECIOS, 'sandalia', 'puntera', 1));
});

test('lanza error si el servicio es desconocido', () => {
  assert.throws(() => calculatePrice(PRECIOS, 'bota', 'plantilla', 1));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pricing.test.js`
Expected: FAIL — `Cannot find module '../js/pricing.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/pricing.js
export function calculatePrice(precios, tipoCalzado, servicio, cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error('cantidad debe ser un entero >= 1');
  }
  const porTipo = precios[tipoCalzado];
  if (!porTipo) {
    throw new Error(`tipo de calzado desconocido: ${tipoCalzado}`);
  }
  const precioUnitario = porTipo[servicio];
  if (typeof precioUnitario !== 'number') {
    throw new Error(`servicio desconocido: ${servicio}`);
  }
  return precioUnitario * cantidad;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pricing.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/pricing.js tests/pricing.test.js
git commit -m "feat: add price calculation logic"
```

---

## Task 3: `js/geo.js` — distance and nearest-point selection

**Files:**
- Create: `js/geo.js`
- Test: `tests/geo.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/geo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineDistanceKm, findNearestPoints } from '../js/geo.js';

test('la distancia de un punto a sí mismo es 0', () => {
  assert.equal(haversineDistanceKm(42.358, 1.463, 42.358, 1.463), 0);
});

test('calcula una distancia aproximada correcta entre dos ciudades conocidas', () => {
  // La Seu d'Urgell (42.358, 1.463) a Barcelona (41.3874, 2.1686)
  const km = haversineDistanceKm(42.358, 1.463, 41.3874, 2.1686);
  assert.ok(km > 110 && km < 130, `esperaba ~120km, obtuvo ${km}`);
});

test('findNearestPoints ordena por distancia ascendente y respeta el límite', () => {
  const points = [
    { nombre: 'Lejano', lat: 41.3874, lon: 2.1686 },
    { nombre: 'Cercano', lat: 42.358, lon: 1.463 },
    { nombre: 'Medio', lat: 42.0, lon: 1.8 },
  ];
  const result = findNearestPoints(42.358, 1.463, points, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].nombre, 'Cercano');
  assert.equal(result[1].nombre, 'Medio');
  assert.ok(typeof result[0].distanceKm === 'number');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geo.test.js`
Expected: FAIL — `Cannot find module '../js/geo.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/geo.js
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function findNearestPoints(userLat, userLon, points, limit = 3) {
  return [...points]
    .map((point) => ({
      ...point,
      distanceKm: haversineDistanceKm(userLat, userLon, point.lat, point.lon),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/geo.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add js/geo.js tests/geo.test.js
git commit -m "feat: add haversine distance and nearest-point helpers"
```

---

## Task 4: `js/validation.js` — form field validation

**Files:**
- Create: `js/validation.js`
- Test: `tests/validation.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/validation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNonEmpty, isValidSpanishPhone, isValidEmail } from '../js/validation.js';

test('isNonEmpty rechaza vacíos y solo-espacios', () => {
  assert.equal(isNonEmpty('Ana'), true);
  assert.equal(isNonEmpty('   '), false);
  assert.equal(isNonEmpty(''), false);
  assert.equal(isNonEmpty(undefined), false);
});

test('isValidSpanishPhone acepta formatos comunes', () => {
  assert.equal(isValidSpanishPhone('612345678'), true);
  assert.equal(isValidSpanishPhone('+34612345678'), true);
  assert.equal(isValidSpanishPhone('+34 612 345 678'), true);
  assert.equal(isValidSpanishPhone('612-345-678'), true);
});

test('isValidSpanishPhone rechaza formatos inválidos', () => {
  assert.equal(isValidSpanishPhone('12345'), false);
  assert.equal(isValidSpanishPhone('512345678'), false);
  assert.equal(isValidSpanishPhone('abcdefghi'), false);
  assert.equal(isValidSpanishPhone(''), false);
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

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/validation.test.js`
Expected: FAIL — `Cannot find module '../js/validation.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/validation.js
export function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidSpanishPhone(phone) {
  if (typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s-]/g, '');
  return /^(?:\+34|0034)?[6789]\d{8}$/.test(cleaned);
}

export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/validation.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add js/validation.js tests/validation.test.js
git commit -m "feat: add form field validation helpers"
```

---

## Task 5: `js/order.js` — order id and summary

**Files:**
- Create: `js/order.js`
- Test: `tests/order.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/order.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderId, buildOrderSummary } from '../js/order.js';

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

test('buildOrderSummary incluye todos los datos del pedido en las líneas', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0001',
    tipoCalzado: 'pie_de_gato',
    servicio: 'resolado_completo',
    cantidad: 2,
    precioTotal: 70,
    nombre: 'Ana Pérez',
    direccion: 'Carrer Major 1',
    telefono: '+34612345678',
    email: 'ana@example.com',
    entrega: { tipo: 'gls', nombre: 'Punt GLS Centre' },
    metodoPago: 'bizum',
  };
  const summary = buildOrderSummary(orderPayload);
  assert.equal(summary.orderId, 'GLS-TEST-0001');
  const joined = summary.lineas.join(' | ');
  assert.match(joined, /pie_de_gato/);
  assert.match(joined, /resolado_completo/);
  assert.match(joined, /70\.00€/);
  assert.match(joined, /Ana Pérez/);
  assert.match(joined, /Punt GLS Centre/);
  assert.match(joined, /bizum/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/order.test.js`
Expected: FAIL — `Cannot find module '../js/order.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/order.js
export function generateOrderId(now = new Date(), randomFn = Math.random) {
  const datePart = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const randomPart = Math.floor(randomFn() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `GLS-${datePart}-${randomPart}`;
}

export function buildOrderSummary(orderPayload) {
  const {
    orderId,
    tipoCalzado,
    servicio,
    cantidad,
    precioTotal,
    nombre,
    direccion,
    telefono,
    email,
    entrega,
    metodoPago,
  } = orderPayload;

  const entregaTexto =
    entrega.tipo === 'gls'
      ? `Punto GLS: ${entrega.nombre}`
      : `Tienda asociada: ${entrega.nombre}`;

  return {
    orderId,
    lineas: [
      `Referencia: ${orderId}`,
      `Tipo de calzado: ${tipoCalzado}`,
      `Servicio: ${servicio}`,
      `Cantidad: ${cantidad}`,
      `Precio total: ${precioTotal.toFixed(2)}€`,
      `Nombre: ${nombre}`,
      `Dirección: ${direccion}`,
      `Teléfono: ${telefono}`,
      `Email: ${email}`,
      `Entrega: ${entregaTexto}`,
      `Pago: ${metodoPago}`,
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/order.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add js/order.js tests/order.test.js
git commit -m "feat: add order id generation and summary builder"
```

---

## Task 6: `js/geocode.js` — address geocoding via Nominatim

**Files:**
- Create: `js/geocode.js`
- Test: `tests/geocode.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/geocode.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNominatimResponse, geocodeAddress } from '../js/geocode.js';

test('parseNominatimResponse toma el primer resultado como {lat, lon}', () => {
  const result = parseNominatimResponse([{ lat: '42.358', lon: '1.463' }]);
  assert.deepEqual(result, { lat: 42.358, lon: 1.463 });
});

test('parseNominatimResponse devuelve null si no hay resultados', () => {
  assert.equal(parseNominatimResponse([]), null);
  assert.equal(parseNominatimResponse(null), null);
});

test('geocodeAddress llama a Nominatim y devuelve coordenadas', async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/search/);
    assert.match(url, /q=Carrer%20Major/);
    return {
      ok: true,
      json: async () => [{ lat: '42.358', lon: '1.463' }],
    };
  };
  const result = await geocodeAddress('Carrer Major', fakeFetch);
  assert.deepEqual(result, { lat: 42.358, lon: 1.463 });
});

test('geocodeAddress devuelve null si la respuesta no es ok', async () => {
  const fakeFetch = async () => ({ ok: false });
  const result = await geocodeAddress('dirección inválida', fakeFetch);
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geocode.test.js`
Expected: FAIL — `Cannot find module '../js/geocode.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/geocode.js
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export function parseNominatimResponse(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const [first] = results;
  const lat = Number.parseFloat(first.lat);
  const lon = Number.parseFloat(first.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon };
}

export async function geocodeAddress(direccion, fetchFn = fetch) {
  const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(direccion)}&limit=1`;
  const response = await fetchFn(url, {
    headers: { 'Accept-Language': 'ca,es,en' },
  });
  if (!response.ok) return null;
  const results = await response.json();
  return parseNominatimResponse(results);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/geocode.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/geocode.js tests/geocode.test.js
git commit -m "feat: add Nominatim geocoding helper"
```

---

## Task 7: `js/api.js` — Worker API client

**Files:**
- Create: `js/api.js`
- Test: `tests/api.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutSession, notifyOrder, confirmPayment } from '../js/api.js';

test('createCheckoutSession hace POST y devuelve el JSON', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.example.com/api/create-checkout-session');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).orderId, 'GLS-1');
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/xyz' }) };
  };
  const result = await createCheckoutSession('https://api.example.com', { orderId: 'GLS-1' }, fakeFetch);
  assert.equal(result.url, 'https://checkout.stripe.com/xyz');
});

test('createCheckoutSession lanza error si la respuesta no es ok', async () => {
  const fakeFetch = async () => ({ ok: false });
  await assert.rejects(() => createCheckoutSession('https://api.example.com', {}, fakeFetch));
});

test('notifyOrder hace POST al endpoint correcto', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.example.com/api/notify-order');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const result = await notifyOrder('https://api.example.com', { orderId: 'GLS-1' }, fakeFetch);
  assert.equal(result.ok, true);
});

test('confirmPayment hace GET con session_id en la query', async () => {
  const fakeFetch = async (url) => {
    assert.equal(url, 'https://api.example.com/api/confirm-payment?session_id=sess_123');
    return { ok: true, json: async () => ({ ok: true, paid: true, orderId: 'GLS-1' }) };
  };
  const result = await confirmPayment('https://api.example.com', 'sess_123', fakeFetch);
  assert.equal(result.paid, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/api.test.js`
Expected: FAIL — `Cannot find module '../js/api.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// js/api.js
export async function createCheckoutSession(apiBaseUrl, orderPayload, fetchFn = fetch) {
  const response = await fetchFn(`${apiBaseUrl}/api/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });
  if (!response.ok) {
    throw new Error('No se pudo iniciar el pago con tarjeta');
  }
  return response.json();
}

export async function notifyOrder(apiBaseUrl, orderPayload, fetchFn = fetch) {
  const response = await fetchFn(`${apiBaseUrl}/api/notify-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });
  if (!response.ok) {
    throw new Error('No se pudo confirmar el pedido');
  }
  return response.json();
}

export async function confirmPayment(apiBaseUrl, sessionId, fetchFn = fetch) {
  const response = await fetchFn(
    `${apiBaseUrl}/api/confirm-payment?session_id=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) {
    throw new Error('No se pudo confirmar el pago');
  }
  return response.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/api.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/api.js tests/api.test.js
git commit -m "feat: add Worker API client for checkout, notify and confirm"
```

- [ ] **Step 6: Run the full frontend test suite**

Run: `node --test` (or `npm test`) — no path argument, see the note in Task 1.
Expected: PASS — all tests from Tasks 2-7 (pricing, geo, validation, order, geocode, api) pass together.

---

## Task 8: `worker/src/cors.js` — CORS headers

**Files:**
- Create: `worker/package.json`
- Create: `worker/src/cors.js`
- Test: `worker/tests/cors.test.js`

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "name": "grip-la-seu-api",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  }
}
```
(Same reasoning as the root `package.json` in Task 1: `node --test` with no
path argument, not `node --test tests/`.)

- [ ] **Step 2: Write the failing test**

```js
// worker/tests/cors.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorsHeaders } from '../src/cors.js';

test('incluye Access-Control-Allow-Origin cuando el origen coincide', () => {
  const headers = buildCorsHeaders('https://pierorepp90.github.io', 'https://pierorepp90.github.io');
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://pierorepp90.github.io');
});

test('omite Access-Control-Allow-Origin cuando el origen no coincide', () => {
  const headers = buildCorsHeaders('https://evil.example', 'https://pierorepp90.github.io');
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
});

test('siempre incluye métodos y headers permitidos', () => {
  const headers = buildCorsHeaders('https://evil.example', 'https://pierorepp90.github.io');
  assert.equal(headers['Access-Control-Allow-Methods'], 'POST, GET, OPTIONS');
  assert.equal(headers['Access-Control-Allow-Headers'], 'Content-Type');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test worker/tests/cors.test.js`
Expected: FAIL — `Cannot find module '../src/cors.js'`

- [ ] **Step 4: Write minimal implementation**

```js
// worker/src/cors.js
export function buildCorsHeaders(requestOrigin, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (requestOrigin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test worker/tests/cors.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/src/cors.js worker/tests/cors.test.js
git commit -m "feat(worker): add CORS header builder"
```

---

## Task 9: `worker/src/stripe.js` — Stripe Checkout integration

**Files:**
- Create: `worker/src/stripe.js`
- Test: `worker/tests/stripe.test.js`

- [ ] **Step 1: Write the failing test**

```js
// worker/tests/stripe.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutSessionParams,
  orderPayloadFromSessionMetadata,
  parseSessionPaymentStatus,
  createStripeSession,
  retrieveStripeSession,
} from '../src/stripe.js';

const orderPayload = {
  orderId: 'GLS-1',
  tipoCalzado: 'pie_de_gato',
  servicio: 'resolado_completo',
  cantidad: 2,
  precioTotal: 70,
  nombre: 'Ana Pérez',
  direccion: 'Carrer Major 1',
  telefono: '+34612345678',
  email: 'ana@example.com',
  entrega: { tipo: 'gls', nombre: 'Punt GLS Centre' },
  metodoPago: 'tarjeta',
};

test('buildCheckoutSessionParams incluye importe en céntimos y metadata del pedido', () => {
  const params = buildCheckoutSessionParams(orderPayload, 'https://pierorepp90.github.io/grip-la-seu');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('customer_email'), 'ana@example.com');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '7000');
  assert.equal(params.get('metadata[order_id]'), 'GLS-1');
  assert.equal(params.get('metadata[nombre]'), 'Ana Pérez');
  assert.equal(params.get('metadata[entrega_tipo]'), 'gls');
  assert.match(params.get('success_url'), /gracias\.html\?session_id=\{CHECKOUT_SESSION_ID\}/);
});

test('orderPayloadFromSessionMetadata reconstruye el pedido desde la metadata de Stripe', () => {
  const session = {
    customer_email: 'ana@example.com',
    metadata: {
      order_id: 'GLS-1',
      tipo_calzado: 'pie_de_gato',
      servicio: 'resolado_completo',
      cantidad: '2',
      precio_total: '70',
      nombre: 'Ana Pérez',
      direccion: 'Carrer Major 1',
      telefono: '+34612345678',
      entrega_tipo: 'gls',
      entrega_nombre: 'Punt GLS Centre',
    },
  };
  const result = orderPayloadFromSessionMetadata(session);
  assert.equal(result.orderId, 'GLS-1');
  assert.equal(result.cantidad, 2);
  assert.equal(result.precioTotal, 70);
  assert.equal(result.entrega.nombre, 'Punt GLS Centre');
  assert.equal(result.metodoPago, 'tarjeta');
});

test('parseSessionPaymentStatus detecta pago completado', () => {
  assert.equal(parseSessionPaymentStatus({ payment_status: 'paid' }), true);
  assert.equal(parseSessionPaymentStatus({ payment_status: 'unpaid' }), false);
  assert.equal(parseSessionPaymentStatus(null), false);
});

test('createStripeSession hace POST autenticado y devuelve el JSON', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_123');
    return { ok: true, json: async () => ({ id: 'sess_123', url: 'https://checkout.stripe.com/xyz' }) };
  };
  const params = new URLSearchParams({ mode: 'payment' });
  const result = await createStripeSession(params, 'sk_test_123', fakeFetch);
  assert.equal(result.id, 'sess_123');
});

test('createStripeSession lanza error si Stripe responde con error', async () => {
  const fakeFetch = async () => ({ ok: false });
  await assert.rejects(() => createStripeSession(new URLSearchParams(), 'sk_test_123', fakeFetch));
});

test('retrieveStripeSession hace GET autenticado a la sesión correcta', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions/sess_123');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_123');
    return { ok: true, json: async () => ({ id: 'sess_123', payment_status: 'paid' }) };
  };
  const result = await retrieveStripeSession('sess_123', 'sk_test_123', fakeFetch);
  assert.equal(result.payment_status, 'paid');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/tests/stripe.test.js`
Expected: FAIL — `Cannot find module '../src/stripe.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// worker/src/stripe.js
export function buildCheckoutSessionParams(orderPayload, siteUrl) {
  const {
    orderId,
    precioTotal,
    tipoCalzado,
    servicio,
    cantidad,
    nombre,
    direccion,
    telefono,
    email,
    entrega,
  } = orderPayload;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('customer_email', email);
  params.set('success_url', `${siteUrl}/gracias.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${siteUrl}/?pago=cancelado`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'eur');
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(precioTotal * 100)));
  params.set(
    'line_items[0][price_data][product_data][name]',
    `${servicio} x${cantidad} (${tipoCalzado})`,
  );
  params.set('metadata[order_id]', orderId);
  params.set('metadata[tipo_calzado]', tipoCalzado);
  params.set('metadata[servicio]', servicio);
  params.set('metadata[cantidad]', String(cantidad));
  params.set('metadata[precio_total]', String(precioTotal));
  params.set('metadata[nombre]', nombre);
  params.set('metadata[direccion]', direccion);
  params.set('metadata[telefono]', telefono);
  params.set('metadata[entrega_tipo]', entrega.tipo);
  params.set('metadata[entrega_nombre]', entrega.nombre);
  return params;
}

export function orderPayloadFromSessionMetadata(session) {
  const m = session.metadata || {};
  return {
    orderId: m.order_id,
    tipoCalzado: m.tipo_calzado,
    servicio: m.servicio,
    cantidad: Number(m.cantidad),
    precioTotal: Number(m.precio_total),
    nombre: m.nombre,
    direccion: m.direccion,
    telefono: m.telefono,
    email: session.customer_email,
    entrega: { tipo: m.entrega_tipo, nombre: m.entrega_nombre },
    metodoPago: 'tarjeta',
  };
}

export function parseSessionPaymentStatus(session) {
  return session != null && session.payment_status === 'paid';
}

export async function createStripeSession(params, secretKey, fetchFn = fetch) {
  const response = await fetchFn('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!response.ok) {
    throw new Error('Stripe rechazó la creación de la sesión');
  }
  return response.json();
}

export async function retrieveStripeSession(sessionId, secretKey, fetchFn = fetch) {
  const response = await fetchFn(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) {
    throw new Error('No se pudo recuperar la sesión de Stripe');
  }
  return response.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/tests/stripe.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/stripe.js worker/tests/stripe.test.js
git commit -m "feat(worker): add Stripe Checkout session helpers"
```

---

## Task 10: `worker/src/resend.js` — email building and sending

**Files:**
- Create: `worker/src/resend.js`
- Test: `worker/tests/resend.test.js`

- [ ] **Step 1: Write the failing test**

```js
// worker/tests/resend.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerEmail, buildCustomerEmail, sendEmail } from '../src/resend.js';

const orderPayload = {
  orderId: 'GLS-1',
  tipoCalzado: 'pie_de_gato',
  servicio: 'resolado_completo',
  cantidad: 2,
  precioTotal: 70,
  nombre: 'Ana Pérez',
  direccion: 'Carrer Major 1',
  telefono: '+34612345678',
  email: 'ana@example.com',
  entrega: { tipo: 'gls', nombre: 'Punt GLS Centre' },
  metodoPago: 'bizum',
};

test('buildOwnerEmail va dirigido al propietario e incluye todos los datos', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com');
  assert.deepEqual(email.to, ['owner@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Ana Pérez/);
  assert.match(email.html, /70\.00€/);
  assert.match(email.html, /Punt GLS Centre/);
});

test('buildCustomerEmail va dirigido al comprador y confirma la recepción', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com');
  assert.deepEqual(email.to, ['ana@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Punt GLS Centre/);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test worker/tests/resend.test.js`
Expected: FAIL — `Cannot find module '../src/resend.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// worker/src/resend.js
const FROM_ADDRESS = 'Grip La Seu <onboarding@resend.dev>';

function entregaTexto(entrega) {
  return entrega.tipo === 'gls'
    ? `Punto GLS: ${entrega.nombre}`
    : `Tienda asociada: ${entrega.nombre}`;
}

export function buildOwnerEmail(orderPayload, ownerEmail) {
  const {
    orderId,
    tipoCalzado,
    servicio,
    cantidad,
    precioTotal,
    nombre,
    direccion,
    telefono,
    email,
    entrega,
    metodoPago,
  } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [ownerEmail],
    subject: `Nuevo pedido ${orderId}`,
    html: `
      <h2>Nuevo pedido ${orderId}</h2>
      <ul>
        <li>Tipo de calzado: ${tipoCalzado}</li>
        <li>Servicio: ${servicio}</li>
        <li>Cantidad: ${cantidad}</li>
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Nombre: ${nombre}</li>
        <li>Dirección: ${direccion}</li>
        <li>Teléfono: ${telefono}</li>
        <li>Email: ${email}</li>
        <li>Entrega: ${entregaTexto(entrega)}</li>
        <li>Pago: ${metodoPago}</li>
      </ul>
    `,
  };
}

export function buildCustomerEmail(orderPayload, customerEmailAddress) {
  const { orderId, servicio, cantidad, precioTotal, entrega, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [customerEmailAddress],
    subject: `Hemos recibido tu pedido ${orderId} — Grip La Seu`,
    html: `
      <h2>¡Gracias por tu pedido!</h2>
      <p>Referencia: <strong>${orderId}</strong></p>
      <ul>
        <li>Servicio: ${servicio}</li>
        <li>Cantidad: ${cantidad}</li>
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Entrega: ${entregaTexto(entrega)}</li>
        <li>Pago: ${metodoPago}</li>
      </ul>
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test worker/tests/resend.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add worker/src/resend.js worker/tests/resend.test.js
git commit -m "feat(worker): add Resend email builders and sender"
```

- [ ] **Step 6: Run the full worker test suite**

Run: `(cd worker && node --test)` — no path argument, run with `worker/` as the
current directory so it discovers `worker/tests/*.test.js` (see the note in
Task 8; a bare directory argument like `node --test worker/tests/` fails with
`MODULE_NOT_FOUND` on this environment's Node).
Expected: PASS — all tests from Tasks 8-10 (cors, stripe, resend) pass together.

---

## Task 11: `worker/src/index.js` — routing and wrangler config

This task wires the pure modules from Tasks 8-10 into the Workers `fetch` handler.
It's routing glue, not business logic, so it's verified manually with `wrangler dev`
+ `curl` instead of unit tests (consistent with the spec's testing approach).

**Files:**
- Create: `worker/src/index.js`
- Create: `worker/wrangler.toml`
- Create: `worker/.dev.vars` (local secrets, gitignored — not committed)

- [ ] **Step 1: Install wrangler as a dev dependency**

Run (from `worker/`):
```bash
cd worker
npm install -D wrangler
cd ..
```
Expected: `worker/package.json` gains a `devDependencies.wrangler` entry and
`worker/package-lock.json` is created.

- [ ] **Step 2: Write `worker/wrangler.toml`**

```toml
name = "grip-la-seu-api"
main = "src/index.js"
compatibility_date = "2026-08-13"

[vars]
SITE_URL = "https://pierorepp90.github.io/grip-la-seu"
ALLOWED_ORIGIN = "https://pierorepp90.github.io"
OWNER_EMAIL = "placeholder@example.com"
```

- [ ] **Step 3: Write `worker/src/index.js`**

```js
// worker/src/index.js
import { buildCorsHeaders } from './cors.js';
import {
  buildCheckoutSessionParams,
  createStripeSession,
  retrieveStripeSession,
  parseSessionPaymentStatus,
  orderPayloadFromSessionMetadata,
} from './stripe.js';
import { buildOwnerEmail, buildCustomerEmail, sendEmail } from './resend.js';

async function handleCreateCheckoutSession(request, env, cors) {
  const orderPayload = await request.json();
  const params = buildCheckoutSessionParams(orderPayload, env.SITE_URL);
  const session = await createStripeSession(params, env.STRIPE_SECRET_KEY);
  return Response.json({ url: session.url }, { headers: cors });
}

async function handleNotifyOrder(request, env, cors) {
  const orderPayload = await request.json();
  const ownerEmail = buildOwnerEmail(orderPayload, env.OWNER_EMAIL);
  const customerEmail = buildCustomerEmail(orderPayload, orderPayload.email);
  await Promise.all([
    sendEmail(ownerEmail, env.RESEND_API_KEY),
    sendEmail(customerEmail, env.RESEND_API_KEY),
  ]);
  return Response.json({ ok: true }, { headers: cors });
}

async function handleConfirmPayment(url, env, cors) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) {
    return Response.json({ error: 'Falta session_id' }, { status: 400, headers: cors });
  }
  const session = await retrieveStripeSession(sessionId, env.STRIPE_SECRET_KEY);
  if (!parseSessionPaymentStatus(session)) {
    return Response.json({ ok: true, paid: false }, { headers: cors });
  }
  const orderPayload = orderPayloadFromSessionMetadata(session);
  const ownerEmail = buildOwnerEmail(orderPayload, env.OWNER_EMAIL);
  const customerEmail = buildCustomerEmail(orderPayload, orderPayload.email);
  await Promise.all([
    sendEmail(ownerEmail, env.RESEND_API_KEY),
    sendEmail(customerEmail, env.RESEND_API_KEY),
  ]);
  return Response.json(
    { ok: true, paid: true, orderId: orderPayload.orderId, order: orderPayload },
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

- [ ] **Step 4: Create local secrets file for `wrangler dev` (not committed)**

Create `worker/.dev.vars` (already covered by `.gitignore` from Task 1):
```
STRIPE_SECRET_KEY=sk_test_replace_me
RESEND_API_KEY=re_replace_me
```
These are throwaway/test values for local testing only — real keys are set as
Cloudflare secrets in Task 23, never committed to git.

- [ ] **Step 5: Verify routing locally**

Run (from `worker/`): `npx wrangler dev`
Then in another terminal:
```bash
curl -i -X OPTIONS http://localhost:8787/api/notify-order \
  -H "Origin: https://pierorepp90.github.io"
```
Expected: `204 No Content` with `Access-Control-Allow-Origin: https://pierorepp90.github.io`.

```bash
curl -i -X POST http://localhost:8787/api/notify-order \
  -H "Content-Type: application/json" \
  -H "Origin: https://pierorepp90.github.io" \
  -d '{"orderId":"GLS-1","tipoCalzado":"bota","servicio":"puntera","cantidad":1,"precioTotal":15,"nombre":"Test","direccion":"Test 1","telefono":"+34612345678","email":"test@example.com","entrega":{"tipo":"tienda","nombre":"Tienda Test"},"metodoPago":"efectivo"}'
```
Expected: `500` with an error mentioning Resend, because `sk_test_replace_me` /
`re_replace_me` aren't real keys — this confirms the routing and CORS work
correctly and the request reaches the Resend call. Stop `wrangler dev` after
verifying (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/wrangler.toml worker/src/index.js
git commit -m "feat(worker): wire routing, CORS and Stripe/Resend endpoints"
```

---

## Task 12: Placeholder data files — `precios.js`, `puntos-gls.js`, `tiendas.js`

These hold real business data the owner (Piero) still needs to fill in
(confirmed during brainstorming as "pendiente"). Each ships with clearly
editable placeholder values and a schema test so a future edit that breaks
the shape `pricing.js`/`geo.js` expect fails loudly.

**Files:**
- Create: `js/precios.js`
- Create: `js/puntos-gls.js`
- Create: `js/tiendas.js`
- Test: `tests/data.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/data.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRECIOS } from '../js/precios.js';
import { PUNTOS_GLS } from '../js/puntos-gls.js';
import { TIENDAS } from '../js/tiendas.js';
import { calculatePrice } from '../js/pricing.js';

test('PRECIOS tiene tarifa numérica para cada tipo de calzado y servicio', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    for (const servicio of ['resolado_completo', 'media_suela', 'puntera']) {
      assert.equal(typeof PRECIOS[tipo][servicio], 'number');
      assert.ok(calculatePrice(PRECIOS, tipo, servicio, 1) > 0);
    }
  }
});

test('PUNTOS_GLS tiene al menos un punto con nombre y coordenadas numéricas', () => {
  assert.ok(PUNTOS_GLS.length >= 1);
  for (const punto of PUNTOS_GLS) {
    assert.equal(typeof punto.nombre, 'string');
    assert.equal(typeof punto.lat, 'number');
    assert.equal(typeof punto.lon, 'number');
  }
});

test('TIENDAS tiene al menos una tienda con nombre y dirección', () => {
  assert.ok(TIENDAS.length >= 1);
  for (const tienda of TIENDAS) {
    assert.equal(typeof tienda.nombre, 'string');
    assert.equal(typeof tienda.direccion, 'string');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data.test.js`
Expected: FAIL — `Cannot find module '../js/precios.js'`

- [ ] **Step 3: Write the placeholder data files**

```js
// js/precios.js
// PENDIENTE: confirmar tarifas reales con el propietario antes de publicar.
export const PRECIOS = {
  bota: { resolado_completo: 45, media_suela: 28, puntera: 15 },
  pie_de_gato: { resolado_completo: 35, media_suela: 20, puntera: 12 },
};
```

```js
// js/puntos-gls.js
// PENDIENTE: sustituir por la lista real de puntos GLS recomendados.
export const PUNTOS_GLS = [
  { nombre: 'Punt GLS La Seu Centre (placeholder)', lat: 42.3588, lon: 1.4634 },
  { nombre: 'Punt GLS Andorra la Vella (placeholder)', lat: 42.5063, lon: 1.5218 },
  { nombre: 'Punt GLS Puigcerdà (placeholder)', lat: 42.4319, lon: 1.9286 },
];
```

```js
// js/tiendas.js
// PENDIENTE: sustituir por la lista real de tiendas asociadas.
export const TIENDAS = [
  {
    nombre: 'Tienda asociada La Seu (placeholder)',
    direccion: 'Carrer Major 1, La Seu d\'Urgell',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/data.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add js/precios.js js/puntos-gls.js js/tiendas.js tests/data.test.js
git commit -m "feat: add placeholder pricing, GLS points and store data"
```

---

## Task 13: `js/i18n.js` — CA/ES/EN dictionary

All keys used by the markup and Alpine wiring in Tasks 14-20 are defined here
first, so later tasks reference an already-tested, complete dictionary.

**Files:**
- Create: `js/i18n.js`
- Test: `tests/i18n.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/i18n.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, DICT, t } from '../js/i18n.js';

test('las 3 lenguas tienen exactamente las mismas claves', () => {
  const [first, ...rest] = LANGS.map((lang) => Object.keys(DICT[lang]).sort());
  for (const keys of rest) {
    assert.deepEqual(keys, first);
  }
});

test('ninguna traducción está vacía', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(DICT[lang])) {
      assert.ok(value.trim().length > 0, `${lang}.${key} está vacío`);
    }
  }
});

test('t() devuelve la traducción del idioma pedido', () => {
  assert.equal(t('en', 'btn_siguiente'), DICT.en.btn_siguiente);
});

test('t() cae a catalán si el idioma no existe, y a la clave si falta la traducción', () => {
  assert.equal(t('fr', 'btn_siguiente'), DICT.ca.btn_siguiente);
  assert.equal(t('ca', 'clave_inexistente'), 'clave_inexistente');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/i18n.test.js`
Expected: FAIL — `Cannot find module '../js/i18n.js'`

- [ ] **Step 3: Write the dictionary**

```js
// js/i18n.js
export const LANGS = ['ca', 'es', 'en'];

export const DICT = {
  ca: {
    brand_tagline: 'Ressolats de peus de gat · La Seu d\'Urgell',
    nav_cta: 'Coordinar recollida',
    hero_title: 'Dona una segona vida als teus peus de gat',
    hero_subtitle:
      'Ressolats professionals de calçat d\'escalada al cor del Pirineu: recollida fàcil, entrega ràpida.',
    hero_cta_primary: 'Coordinar recollida',
    hero_cta_secondary: 'Veure serveis',
    services_title: 'Els nostres serveis',
    service_resolado_completo_title: 'Ressolat complet',
    service_resolado_completo_desc: 'Canvi total de la sola per recuperar tota l\'adherència.',
    service_media_suela_title: 'Mitja sola',
    service_media_suela_desc: 'Reforç de la zona davantera quan el desgast és parcial.',
    service_puntera_title: 'Puntera',
    service_puntera_desc: 'Reparació ràpida del desgast a la punta del peu de gat.',
    service_from: 'Des de',
    step1_title: 'Calculadora',
    tipo_calzado_label: 'Tipus de calçat',
    tipo_bota: 'Bota',
    tipo_pie_de_gato: 'Peu de gat',
    cantidad_label: 'Quantitat',
    servicio_label: 'Servei',
    precio_total_label: 'Preu total',
    btn_siguiente: 'Següent',
    btn_atras: 'Enrere',
    step2_title: 'Dades i entrega',
    nombre_label: 'Nom',
    direccion_label: 'Adreça',
    telefono_label: 'Telèfon',
    email_label: 'Email',
    entrega_label: 'Com ens fas arribar el calçat?',
    entrega_gls: 'Punt GLS',
    entrega_tienda: 'Botiga associada',
    puntos_cercanos_title: 'Punts GLS més propers',
    puntos_geocode_error:
      'No hem pogut localitzar l\'adreça. Tria un punt manualment de la llista.',
    tiendas_title: 'Botigues associades',
    step3_title: 'Pagament',
    pago_label: 'Mètode de pagament',
    pago_bizum: 'Bizum',
    pago_bizum_instrucciones: 'Envia l\'import per Bizum al número que trobaràs aquí (pendent de confirmar).',
    pago_transferencia: 'Transferència',
    pago_transferencia_instrucciones: 'Fes la transferència a l\'IBAN indicat aquí (pendent de confirmar).',
    pago_tarjeta: 'Targeta',
    pago_efectivo: 'Efectiu',
    pago_efectivo_solo_tienda: 'Només disponible si deixes el calçat a una botiga associada.',
    btn_confirmar_pedido: 'Confirmar comanda',
    btn_pagar_tarjeta: 'Pagar amb targeta',
    btn_ya_envie: 'Ja ho he enviat, confirmar comanda',
    form_error_generic: 'Alguna cosa ha fallat. Torna-ho a provar.',
    gracias_title: 'Gràcies per la teva comanda',
    gracias_paid: 'Hem rebut el teu pagament correctament.',
    gracias_not_paid: 'El pagament no s\'ha completat. Torna-ho a intentar.',
    gracias_pending: 'Comprovant el pagament...',
    footer_rights: 'Tots els drets reservats.',
  },
  es: {
    brand_tagline: 'Resolados de pies de gato · La Seu d\'Urgell',
    nav_cta: 'Coordinar recogida',
    hero_title: 'Dale una segunda vida a tus pies de gato',
    hero_subtitle:
      'Resolados profesionales de calzado de escalada en el corazón del Pirineo: recogida fácil, entrega rápida.',
    hero_cta_primary: 'Coordinar recogida',
    hero_cta_secondary: 'Ver servicios',
    services_title: 'Nuestros servicios',
    service_resolado_completo_title: 'Resolado completo',
    service_resolado_completo_desc: 'Cambio total de la suela para recuperar toda la adherencia.',
    service_media_suela_title: 'Media suela',
    service_media_suela_desc: 'Refuerzo de la zona delantera cuando el desgaste es parcial.',
    service_puntera_title: 'Puntera',
    service_puntera_desc: 'Reparación rápida del desgaste en la punta del pie de gato.',
    service_from: 'Desde',
    step1_title: 'Calculadora',
    tipo_calzado_label: 'Tipo de calzado',
    tipo_bota: 'Bota',
    tipo_pie_de_gato: 'Pie de gato',
    cantidad_label: 'Cantidad',
    servicio_label: 'Servicio',
    precio_total_label: 'Precio total',
    btn_siguiente: 'Siguiente',
    btn_atras: 'Atrás',
    step2_title: 'Datos y entrega',
    nombre_label: 'Nombre',
    direccion_label: 'Dirección',
    telefono_label: 'Teléfono',
    email_label: 'Email',
    entrega_label: '¿Cómo nos haces llegar el calzado?',
    entrega_gls: 'Punto GLS',
    entrega_tienda: 'Tienda asociada',
    puntos_cercanos_title: 'Puntos GLS más cercanos',
    puntos_geocode_error:
      'No hemos podido localizar la dirección. Elige un punto manualmente de la lista.',
    tiendas_title: 'Tiendas asociadas',
    step3_title: 'Pago',
    pago_label: 'Método de pago',
    pago_bizum: 'Bizum',
    pago_bizum_instrucciones: 'Envía el importe por Bizum al número que encontrarás aquí (pendiente de confirmar).',
    pago_transferencia: 'Transferencia',
    pago_transferencia_instrucciones: 'Haz la transferencia al IBAN indicado aquí (pendiente de confirmar).',
    pago_tarjeta: 'Tarjeta',
    pago_efectivo: 'Efectivo',
    pago_efectivo_solo_tienda: 'Solo disponible si dejas el calzado en una tienda asociada.',
    btn_confirmar_pedido: 'Confirmar pedido',
    btn_pagar_tarjeta: 'Pagar con tarjeta',
    btn_ya_envie: 'Ya lo he enviado, confirmar pedido',
    form_error_generic: 'Algo ha fallado. Vuelve a intentarlo.',
    gracias_title: 'Gracias por tu pedido',
    gracias_paid: 'Hemos recibido tu pago correctamente.',
    gracias_not_paid: 'El pago no se ha completado. Vuelve a intentarlo.',
    gracias_pending: 'Comprobando el pago...',
    footer_rights: 'Todos los derechos reservados.',
  },
  en: {
    brand_tagline: 'Climbing shoe resoling · La Seu d\'Urgell',
    nav_cta: 'Arrange pickup',
    hero_title: 'Give your climbing shoes a second life',
    hero_subtitle:
      'Professional climbing shoe resoling in the heart of the Pyrenees: easy pickup, fast turnaround.',
    hero_cta_primary: 'Arrange pickup',
    hero_cta_secondary: 'See services',
    services_title: 'Our services',
    service_resolado_completo_title: 'Full resole',
    service_resolado_completo_desc: 'Complete sole replacement to restore full grip.',
    service_media_suela_title: 'Half sole',
    service_media_suela_desc: 'Front-half reinforcement for partial wear.',
    service_puntera_title: 'Toe cap',
    service_puntera_desc: 'Quick repair for toe-area wear.',
    service_from: 'From',
    step1_title: 'Calculator',
    tipo_calzado_label: 'Shoe type',
    tipo_bota: 'Boot',
    tipo_pie_de_gato: 'Climbing shoe',
    cantidad_label: 'Quantity',
    servicio_label: 'Service',
    precio_total_label: 'Total price',
    btn_siguiente: 'Next',
    btn_atras: 'Back',
    step2_title: 'Details and delivery',
    nombre_label: 'Name',
    direccion_label: 'Address',
    telefono_label: 'Phone',
    email_label: 'Email',
    entrega_label: 'How will you get us the shoes?',
    entrega_gls: 'GLS point',
    entrega_tienda: 'Partner store',
    puntos_cercanos_title: 'Nearest GLS points',
    puntos_geocode_error: 'We could not locate that address. Pick a point manually from the list.',
    tiendas_title: 'Partner stores',
    step3_title: 'Payment',
    pago_label: 'Payment method',
    pago_bizum: 'Bizum',
    pago_bizum_instrucciones: 'Send the amount via Bizum to the number shown here (to be confirmed).',
    pago_transferencia: 'Bank transfer',
    pago_transferencia_instrucciones: 'Transfer to the IBAN shown here (to be confirmed).',
    pago_tarjeta: 'Card',
    pago_efectivo: 'Cash',
    pago_efectivo_solo_tienda: 'Only available if you drop off the shoes at a partner store.',
    btn_confirmar_pedido: 'Confirm order',
    btn_pagar_tarjeta: 'Pay by card',
    btn_ya_envie: 'I already sent it, confirm order',
    form_error_generic: 'Something went wrong. Please try again.',
    gracias_title: 'Thanks for your order',
    gracias_paid: 'We received your payment successfully.',
    gracias_not_paid: 'Payment was not completed. Please try again.',
    gracias_pending: 'Checking payment...',
    footer_rights: 'All rights reserved.',
  },
};

export function t(lang, key) {
  const dict = DICT[lang] || DICT.ca;
  return dict[key] ?? key;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/i18n.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/i18n.js tests/i18n.test.js
git commit -m "feat: add CA/ES/EN i18n dictionary"
```

- [ ] **Step 6: Run the full frontend test suite again**

Run: `node --test` (or `npm test`) — no path argument, see the note in Task 1.
Expected: PASS — all 8 test files from Tasks 2-7, 12 and 13 pass together
(pricing, geo, validation, order, geocode, api, data, i18n).

---

## Task 14: `css/styles.css` — design tokens, layout, responsive

No automated tests for CSS — verified visually once `index.html` exists
(Task 16). This task just creates the stylesheet with the full palette and
component styles so later markup tasks can apply classes directly.

**Files:**
- Create: `css/styles.css`

- [ ] **Step 1: Write the stylesheet**

```css
/* css/styles.css */
:root {
  --color-navy: #0b1b33;
  --color-navy-light: #14294a;
  --color-amber: #f0a83c;
  --color-amber-dark: #d48a22;
  --color-cream: #f5f1e8;
  --color-slate: #8b99b3;
  --color-white: #ffffff;
  --radius: 10px;
  --shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  --max-width: 1100px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: var(--color-cream);
  color: var(--color-navy);
}

img {
  max-width: 100%;
}

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 1.25rem;
}

/* Header */
header.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--color-navy);
  color: var(--color-cream);
  box-shadow: var(--shadow);
}

.site-header .container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-block: 0.75rem;
  gap: 1rem;
}

.site-header .logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
}

.site-header .logo img {
  height: 40px;
  width: auto;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.lang-switch button,
.social-links a {
  background: none;
  border: 1px solid transparent;
  color: var(--color-cream);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius);
}

.lang-switch button[aria-current='true'] {
  color: var(--color-amber);
  border-color: var(--color-amber);
}

.social-links {
  display: flex;
  gap: 0.75rem;
}

.social-links a {
  font-size: 1.1rem;
  padding: 0.35rem;
  line-height: 1;
}

.menu-toggle {
  display: none;
}

@media (max-width: 720px) {
  .header-controls {
    display: none;
    flex-direction: column;
    align-items: flex-start;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--color-navy);
    padding: 1rem 1.25rem;
  }

  .header-controls.open {
    display: flex;
  }

  .menu-toggle {
    display: inline-flex;
    background: none;
    border: none;
    color: var(--color-cream);
    font-size: 1.5rem;
    cursor: pointer;
  }
}

/* Hero */
.hero {
  background: radial-gradient(circle at top, var(--color-navy-light), var(--color-navy) 70%);
  color: var(--color-cream);
  padding: 4rem 0;
  text-align: center;
}

.hero h1 {
  font-size: clamp(1.75rem, 4vw, 3rem);
  margin-bottom: 0.75rem;
}

.hero p {
  color: var(--color-slate);
  max-width: 640px;
  margin: 0 auto 2rem;
  font-size: 1.05rem;
}

.hero-ctas {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

.btn {
  display: inline-block;
  border: none;
  border-radius: var(--radius);
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  transition: transform 0.15s ease, background 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--color-amber);
  color: var(--color-navy);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-amber-dark);
  transform: translateY(-1px);
}

.btn-secondary {
  background: transparent;
  color: var(--color-cream);
  border: 1px solid var(--color-slate);
}

.btn-secondary:hover {
  border-color: var(--color-cream);
}

/* Services */
.services {
  padding: 3.5rem 0;
}

.services h2 {
  text-align: center;
  margin-bottom: 2rem;
}

.service-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
}

.service-card {
  background: var(--color-navy);
  color: var(--color-cream);
  border-radius: var(--radius);
  padding: 1.5rem;
  box-shadow: var(--shadow);
}

.service-card h3 {
  color: var(--color-amber);
  margin-top: 0;
}

.service-card .price {
  margin-top: 1rem;
  font-weight: 700;
  color: var(--color-amber);
}

/* Footer */
footer.site-footer {
  background: var(--color-navy);
  color: var(--color-slate);
  text-align: center;
  padding: 1.5rem 0;
  font-size: 0.85rem;
}

/* Order modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(11, 27, 51, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 100;
}

.modal {
  background: var(--color-white);
  border-radius: var(--radius);
  max-width: 560px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  padding: 2rem;
  position: relative;
}

.modal-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
}

.step-indicator {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.step-indicator span {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: #e4e0d4;
}

.step-indicator span.active {
  background: var(--color-amber);
}

.toggle-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.toggle-option {
  border: 1px solid var(--color-slate);
  border-radius: var(--radius);
  padding: 0.5rem 1rem;
  background: var(--color-white);
  cursor: pointer;
}

.toggle-option.selected {
  border-color: var(--color-amber);
  background: var(--color-amber);
  color: var(--color-navy);
  font-weight: 600;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.stepper button {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  border: 1px solid var(--color-slate);
  background: var(--color-white);
  font-size: 1.25rem;
  cursor: pointer;
}

.price-total {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-navy);
  margin: 1.5rem 0;
}

.form-field {
  margin-bottom: 1rem;
}

.form-field label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 600;
}

.form-field input {
  width: 100%;
  padding: 0.6rem;
  border: 1px solid var(--color-slate);
  border-radius: var(--radius);
  font-size: 1rem;
}

.delivery-option-card,
.payment-option-card {
  border: 1px solid var(--color-slate);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
}

.delivery-option-card.selected,
.payment-option-card.selected {
  border-color: var(--color-amber);
  background: #fff7ea;
}

.point-list {
  list-style: none;
  padding: 0;
  margin: 0.75rem 0 0;
}

.point-list li {
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
}

.modal-nav {
  display: flex;
  justify-content: space-between;
  margin-top: 1.5rem;
}

.error-message {
  color: #b3261e;
  font-size: 0.9rem;
  margin-top: 0.5rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add css/styles.css
git commit -m "feat: add design tokens and component styles"
```

---

## Task 15: `assets/logo.svg` — placeholder logo

A simple, clean SVG placeholder using the brand palette (mountains + shoe
silhouette + wordmark), to be swapped for the owner's real logo file later
(explicitly deferred in the spec).

**Files:**
- Create: `assets/logo.svg`

- [ ] **Step 1: Write the placeholder logo**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60" width="240" height="60" role="img" aria-label="Grip La Seu">
  <rect width="240" height="60" rx="8" fill="#0b1b33"/>
  <polygon points="20,45 32,20 40,35 48,15 60,45" fill="#f5f1e8"/>
  <circle cx="40" cy="14" r="4" fill="#f0a83c"/>
  <text x="70" y="28" font-family="Segoe UI, sans-serif" font-size="18" font-weight="700" fill="#f0a83c">GRIP</text>
  <text x="70" y="28" font-family="Segoe UI, sans-serif" font-size="18" font-weight="700" fill="#f5f1e8" dx="46">LA SEU</text>
  <text x="70" y="44" font-family="Segoe UI, sans-serif" font-size="9" fill="#8b99b3">RESSOLATS DE PEUS DE GAT</text>
</svg>
```

- [ ] **Step 2: Open the file in a browser to verify it renders**

Run: open `assets/logo.svg` directly in a browser tab (drag the file in, or
`start assets/logo.svg` on Windows). Expected: dark navy rounded rectangle
with a light mountain shape, an amber dot, and "GRIP LA SEU" wordmark in
amber/cream, matching the palette from Task 14.

- [ ] **Step 3: Commit**

```bash
git add assets/logo.svg
git commit -m "feat: add placeholder logo asset"
```

---

## Task 16: `index.html` — page shell (head, header, hero, services, footer)

**Files:**
- Create: `index.html`

- [ ] **Step 1: Write the page shell**

```html
<!doctype html>
<html lang="ca">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Grip La Seu — Ressolats de peus de gat</title>
  <link rel="icon" href="assets/logo.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="css/styles.css" />
  <script defer src="https://unpkg.com/alpinejs@3/dist/cdn.min.js"></script>
  <script type="module" src="js/app.js"></script>
</head>
<body x-data="site()">
  <header class="site-header">
    <div class="container">
      <div class="logo">
        <img src="assets/logo.svg" alt="Grip La Seu" />
      </div>
      <button class="menu-toggle" @click="menuOpen = !menuOpen" aria-label="Menú">&#9776;</button>
      <div class="header-controls" :class="{ open: menuOpen }">
        <div class="lang-switch" role="group" aria-label="Idioma">
          <template x-for="lang in langs" :key="lang">
            <button @click="setLang(lang)" :aria-current="lang === $store.i18n.lang" x-text="lang.toUpperCase()"></button>
          </template>
        </div>
        <div class="social-links">
          <a href="https://wa.me/34669918744" target="_blank" rel="noopener" aria-label="WhatsApp">WhatsApp</a>
          <a href="https://instagram.com/griplaseu" target="_blank" rel="noopener" aria-label="Instagram">Instagram</a>
          <a href="mailto:hola@griplaseu.com" aria-label="Email">Email</a>
        </div>
        <button class="btn btn-primary" @click="modalOpen = true" x-text="$t('nav_cta')"></button>
      </div>
    </div>
  </header>

  <!-- Order form modal (Task 17) -->
  <div class="modal-overlay" x-show="modalOpen" x-cloak @keydown.escape.window="modalOpen = false" style="display: none;">
    <div class="modal" x-data="orderForm()" @click.outside="modalOpen = false" role="dialog" aria-modal="true">
      <button class="modal-close" @click="modalOpen = false" aria-label="Tancar">&times;</button>
      <!-- form steps go here, added in Task 17 -->
    </div>
  </div>

  <section class="hero">
    <div class="container">
      <h1 x-text="$t('hero_title')"></h1>
      <p x-text="$t('hero_subtitle')"></p>
      <div class="hero-ctas">
        <button class="btn btn-primary" @click="modalOpen = true" x-text="$t('hero_cta_primary')"></button>
        <a class="btn btn-secondary" href="#services" x-text="$t('hero_cta_secondary')"></a>
      </div>
    </div>
  </section>

  <section class="services" id="services">
    <div class="container">
      <h2 x-text="$t('services_title')"></h2>
      <div class="service-cards">
        <article class="service-card">
          <h3 x-text="$t('service_resolado_completo_title')"></h3>
          <p x-text="$t('service_resolado_completo_desc')"></p>
          <p class="price" x-text="$t('service_from') + ' ' + Math.min(precios.bota.resolado_completo, precios.pie_de_gato.resolado_completo) + '€'"></p>
        </article>
        <article class="service-card">
          <h3 x-text="$t('service_media_suela_title')"></h3>
          <p x-text="$t('service_media_suela_desc')"></p>
          <p class="price" x-text="$t('service_from') + ' ' + Math.min(precios.bota.media_suela, precios.pie_de_gato.media_suela) + '€'"></p>
        </article>
        <article class="service-card">
          <h3 x-text="$t('service_puntera_title')"></h3>
          <p x-text="$t('service_puntera_desc')"></p>
          <p class="price" x-text="$t('service_from') + ' ' + Math.min(precios.bota.puntera, precios.pie_de_gato.puntera) + '€'"></p>
        </article>
      </div>
    </div>
  </section>

  <footer class="site-footer">
    <div class="container">
      <p x-text="'Grip La Seu · ' + new Date().getFullYear() + ' · ' + $t('footer_rights')"></p>
    </div>
  </footer>
</body>
</html>
```

Notes for the engineer:
- `x-data="site()"` lives on `<body>` so header, modal trigger, hero and
  services all share one scope (`menuOpen`, `modalOpen`, `langs`, `precios`).
  Two separate `x-data="site()"` instances would each get their own
  `modalOpen`, so a button in one instance couldn't open the modal rendered in
  another — keeping a single root scope avoids that bug entirely.
- The order form modal is a sibling of `<header>`, not nested inside it, so
  `modalOpen` (on `site()`) still controls it while `orderForm()` (Task 18)
  gets its own nested, isolated scope for the step-by-step state.
- `x-cloak` needs a one-line CSS rule (`[x-cloak]{display:none!important;}`) —
  add it to `css/styles.css` in this same step.
- `precios` on `site()` is the imported `PRECIOS` object (Task 18 wires this
  import), so the services section can show live "desde X€" prices without a
  duplicate data source.

- [ ] **Step 2: Add the `x-cloak` rule to `css/styles.css`**

```css
[x-cloak] {
  display: none !important;
}
```

- [ ] **Step 3: Serve the page locally and check it loads without console errors**

Run: `npx serve .` (or `python -m http.server 8080`) from the repo root, then
open `http://localhost:8080` (or the port shown) in a browser.
Expected: header, hero and 3 service cards render with the navy/amber palette.
Browser console shows Alpine errors for `$t` and `orderForm`/`site` being
undefined — that's expected until Task 18 defines them; note it and continue,
it will be resolved by Task 18's own verification step.

- [ ] **Step 4: Commit**

```bash
git add index.html css/styles.css
git commit -m "feat: add page shell with header, hero and services"
```

---

## Task 17: `index.html` — order form modal markup (3 steps)

**Files:**
- Modify: `index.html` (replace the `<!-- form steps go here, added in Task 17 -->` comment)

- [ ] **Step 1: Replace the placeholder comment with the 3-step form markup**

```html
        <!-- form steps go here, added in Task 17 -->
```

Replace with:

```html
        <div class="step-indicator">
          <span :class="{ active: step >= 1 }"></span>
          <span :class="{ active: step >= 2 }"></span>
          <span :class="{ active: step >= 3 }"></span>
        </div>

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
          </div>
        </template>

        <template x-if="!success && step === 1">
          <div>
            <h2 x-text="$t('step1_title')"></h2>

            <label x-text="$t('tipo_calzado_label')"></label>
            <div class="toggle-group">
              <button type="button" class="toggle-option" :class="{ selected: tipoCalzado === 'bota' }" @click="tipoCalzado = 'bota'" x-text="$t('tipo_bota')"></button>
              <button type="button" class="toggle-option" :class="{ selected: tipoCalzado === 'pie_de_gato' }" @click="tipoCalzado = 'pie_de_gato'" x-text="$t('tipo_pie_de_gato')"></button>
            </div>

            <label x-text="$t('cantidad_label')"></label>
            <div class="stepper">
              <button type="button" @click="cantidad = Math.max(1, cantidad - 1)">−</button>
              <span x-text="cantidad"></span>
              <button type="button" @click="cantidad = cantidad + 1">+</button>
            </div>

            <label x-text="$t('servicio_label')"></label>
            <div class="toggle-group">
              <button type="button" class="toggle-option" :class="{ selected: servicio === 'resolado_completo' }" @click="servicio = 'resolado_completo'" x-text="$t('service_resolado_completo_title')"></button>
              <button type="button" class="toggle-option" :class="{ selected: servicio === 'media_suela' }" @click="servicio = 'media_suela'" x-text="$t('service_media_suela_title')"></button>
              <button type="button" class="toggle-option" :class="{ selected: servicio === 'puntera' }" @click="servicio = 'puntera'" x-text="$t('service_puntera_title')"></button>
            </div>

            <p class="price-total" x-show="precioTotal > 0" x-text="$t('precio_total_label') + ': ' + precioTotal.toFixed(2) + '€'"></p>

            <div class="modal-nav">
              <span></span>
              <button type="button" class="btn btn-primary" :disabled="!canProceedStep1" @click="step = 2" x-text="$t('btn_siguiente')"></button>
            </div>
          </div>
        </template>

        <template x-if="!success && step === 2">
          <div>
            <h2 x-text="$t('step2_title')"></h2>

            <div class="form-field">
              <label x-text="$t('nombre_label')"></label>
              <input type="text" x-model="nombre" />
            </div>
            <div class="form-field">
              <label x-text="$t('direccion_label')"></label>
              <input type="text" x-model="direccion" @blur="buscarPuntosGLS()" />
            </div>
            <div class="form-field">
              <label x-text="$t('telefono_label')"></label>
              <input type="tel" x-model="telefono" />
            </div>
            <div class="form-field">
              <label x-text="$t('email_label')"></label>
              <input type="email" x-model="email" />
            </div>

            <label x-text="$t('entrega_label')"></label>

            <div class="delivery-option-card" :class="{ selected: entregaTipo === 'gls' }" @click="entregaTipo = 'gls'; entregaNombre = ''; metodoPago = ''">
              <strong x-text="$t('entrega_gls')"></strong>
              <template x-if="entregaTipo === 'gls'">
                <div>
                  <p x-show="geocodeError" class="error-message" x-text="$t('puntos_geocode_error')"></p>
                  <p x-text="$t('puntos_cercanos_title')"></p>
                  <ul class="point-list">
                    <template x-for="punto in puntosCercanos" :key="punto.nombre">
                      <li>
                        <label @click.stop>
                          <input type="radio" name="punto-gls" :value="punto.nombre" x-model="entregaNombre" />
                          <span x-text="punto.nombre + (punto.distanceKm ? ' (' + punto.distanceKm.toFixed(1) + ' km)' : '')"></span>
                        </label>
                      </li>
                    </template>
                  </ul>
                </div>
              </template>
            </div>

            <div class="delivery-option-card" :class="{ selected: entregaTipo === 'tienda' }" @click="entregaTipo = 'tienda'; entregaNombre = ''; metodoPago = ''">
              <strong x-text="$t('entrega_tienda')"></strong>
              <template x-if="entregaTipo === 'tienda'">
                <ul class="point-list">
                  <template x-for="tienda in tiendas" :key="tienda.nombre">
                    <li>
                      <label @click.stop>
                        <input type="radio" name="tienda" :value="tienda.nombre" x-model="entregaNombre" />
                        <span x-text="tienda.nombre + ' — ' + tienda.direccion"></span>
                      </label>
                    </li>
                  </template>
                </ul>
              </template>
            </div>

            <div class="modal-nav">
              <button type="button" class="btn btn-secondary" @click="step = 1" x-text="$t('btn_atras')"></button>
              <button type="button" class="btn btn-primary" :disabled="!canProceedStep2" @click="step = 3" x-text="$t('btn_siguiente')"></button>
            </div>
          </div>
        </template>

        <template x-if="!success && step === 3">
          <div>
            <h2 x-text="$t('step3_title')"></h2>

            <label x-text="$t('pago_label')"></label>
            <div class="toggle-group">
              <button type="button" class="toggle-option" :class="{ selected: metodoPago === 'bizum' }" @click="metodoPago = 'bizum'" x-text="$t('pago_bizum')"></button>
              <button type="button" class="toggle-option" :class="{ selected: metodoPago === 'transferencia' }" @click="metodoPago = 'transferencia'" x-text="$t('pago_transferencia')"></button>
              <button type="button" class="toggle-option" :class="{ selected: metodoPago === 'tarjeta' }" @click="metodoPago = 'tarjeta'" x-text="$t('pago_tarjeta')"></button>
              <button type="button" class="toggle-option" :class="{ selected: metodoPago === 'efectivo' }" :disabled="entregaTipo !== 'tienda'" @click="metodoPago = 'efectivo'" x-text="$t('pago_efectivo')"></button>
            </div>
            <p class="error-message" x-show="entregaTipo !== 'tienda'" x-text="$t('pago_efectivo_solo_tienda')"></p>

            <template x-if="metodoPago === 'bizum'">
              <p x-text="$t('pago_bizum_instrucciones')"></p>
            </template>
            <template x-if="metodoPago === 'transferencia'">
              <p x-text="$t('pago_transferencia_instrucciones')"></p>
            </template>

            <p class="error-message" x-show="errorMsg" x-text="errorMsg"></p>

            <div class="modal-nav">
              <button type="button" class="btn btn-secondary" @click="step = 2" x-text="$t('btn_atras')"></button>
              <button type="button" class="btn btn-primary" x-show="metodoPago === 'tarjeta'" :disabled="submitting" @click="pagarConTarjeta()" x-text="$t('btn_pagar_tarjeta')"></button>
              <button type="button" class="btn btn-primary" x-show="metodoPago === 'bizum' || metodoPago === 'transferencia'" :disabled="submitting" @click="confirmarPedido()" x-text="$t('btn_ya_envie')"></button>
              <button type="button" class="btn btn-primary" x-show="metodoPago === 'efectivo'" :disabled="submitting" @click="confirmarPedido()" x-text="$t('btn_confirmar_pedido')"></button>
            </div>
          </div>
        </template>
```

Note for the engineer: clicking a delivery-option card resets both `entregaNombre`
and `metodoPago`. Without this, a customer could pick "Tienda asociada" + a
store, select "Efectivo" in step 3, go back to step 2, switch to "Punto GLS",
and still have "Efectivo" selected in step 3 even though it's only valid for
store drop-off — the reset prevents that stale, invalid combination.

- [ ] **Step 2: Serve the page locally and click through the markup (without full logic yet)**

Run: `npx serve .` from the repo root, open the site, click "Coordinar recollida".
Expected: the modal opens and shows step 1's fields, but interactions like the
price total and "Siguiente" button won't work correctly yet — `orderForm()`
and `site()` aren't defined until Task 18. Note this and continue.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add 3-step order form markup"
```

---

## Task 18: `js/app.js` — Alpine components (`site`, `orderForm`)

Wires the pure modules from Tasks 2-13 into the two Alpine components the
markup (Tasks 16-17) references. This is view-glue code: no automated tests
(consistent with the spec's manual-testing approach for UI), verified by
clicking through the page in a browser.

**Files:**
- Create: `js/config.js`
- Create: `js/app.js`

- [ ] **Step 1: Write `js/config.js`**

A tiny shared config module so both `app.js` (Task 18) and `gracias.js`
(Task 19) point at the same Worker URL without `gracias.js` having to import
Alpine-specific code from `app.js`.

```js
// js/config.js
// PENDIENTE: sustituir por la URL real del Worker desplegado (Tarea 22).
export const API_BASE_URL = 'https://grip-la-seu-api.example.workers.dev';
```

- [ ] **Step 2: Write `js/app.js`**

```js
// js/app.js
import { LANGS, t } from './i18n.js';
import { PRECIOS } from './precios.js';
import { PUNTOS_GLS } from './puntos-gls.js';
import { TIENDAS } from './tiendas.js';
import { calculatePrice } from './pricing.js';
import { findNearestPoints } from './geo.js';
import { isNonEmpty, isValidSpanishPhone, isValidEmail } from './validation.js';
import { generateOrderId, buildOrderSummary } from './order.js';
import { geocodeAddress } from './geocode.js';
import { createCheckoutSession, notifyOrder } from './api.js';
import { API_BASE_URL } from './config.js';

document.addEventListener('alpine:init', () => {
  Alpine.store('i18n', {
    lang: localStorage.getItem('lang') || 'ca',
  });

  Alpine.magic('t', () => (key) => t(Alpine.store('i18n').lang, key));

  Alpine.data('site', () => ({
    menuOpen: false,
    modalOpen: false,
    langs: LANGS,
    precios: PRECIOS,
    setLang(lang) {
      Alpine.store('i18n').lang = lang;
      localStorage.setItem('lang', lang);
      this.menuOpen = false;
    },
  }));

  Alpine.data('orderForm', () => ({
    step: 1,
    success: false,
    submitting: false,
    errorMsg: '',
    orderId: '',
    summaryLines: [],

    // Paso 1
    tipoCalzado: '',
    cantidad: 1,
    servicio: '',

    // Paso 2
    nombre: '',
    direccion: '',
    telefono: '',
    email: '',
    entregaTipo: '',
    entregaNombre: '',
    puntosCercanos: PUNTOS_GLS.slice(0, 3),
    tiendas: TIENDAS,
    geocodeError: false,

    // Paso 3
    metodoPago: '',

    get precioTotal() {
      if (!this.tipoCalzado || !this.servicio) return 0;
      try {
        return calculatePrice(PRECIOS, this.tipoCalzado, this.servicio, this.cantidad);
      } catch {
        return 0;
      }
    },

    get canProceedStep1() {
      return Boolean(this.tipoCalzado && this.servicio && this.cantidad >= 1);
    },

    get canProceedStep2() {
      return Boolean(
        isNonEmpty(this.nombre) &&
          isNonEmpty(this.direccion) &&
          isValidSpanishPhone(this.telefono) &&
          isValidEmail(this.email) &&
          this.entregaTipo &&
          this.entregaNombre,
      );
    },

    async buscarPuntosGLS() {
      if (!isNonEmpty(this.direccion)) return;
      const coords = await geocodeAddress(this.direccion);
      if (!coords) {
        this.geocodeError = true;
        this.puntosCercanos = PUNTOS_GLS;
        return;
      }
      this.geocodeError = false;
      this.puntosCercanos = findNearestPoints(coords.lat, coords.lon, PUNTOS_GLS, 3);
    },

    buildOrderPayload() {
      if (!this.orderId) {
        this.orderId = generateOrderId();
      }
      return {
        orderId: this.orderId,
        tipoCalzado: this.tipoCalzado,
        servicio: this.servicio,
        cantidad: this.cantidad,
        precioTotal: this.precioTotal,
        nombre: this.nombre,
        direccion: this.direccion,
        telefono: this.telefono,
        email: this.email,
        entrega: { tipo: this.entregaTipo, nombre: this.entregaNombre },
        metodoPago: this.metodoPago,
      };
    },

    async confirmarPedido() {
      this.errorMsg = '';
      this.submitting = true;
      try {
        const payload = this.buildOrderPayload();
        await notifyOrder(API_BASE_URL, payload);
        this.summaryLines = buildOrderSummary(payload).lineas;
        this.success = true;
      } catch (error) {
        this.errorMsg = t(Alpine.store('i18n').lang, 'form_error_generic');
      } finally {
        this.submitting = false;
      }
    },

    async pagarConTarjeta() {
      this.errorMsg = '';
      this.submitting = true;
      try {
        const payload = this.buildOrderPayload();
        const { url } = await createCheckoutSession(API_BASE_URL, payload);
        window.location.href = url;
      } catch (error) {
        this.errorMsg = t(Alpine.store('i18n').lang, 'form_error_generic');
        this.submitting = false;
      }
    },
  }));
});
```

- [ ] **Step 3: Serve the page locally and verify the full happy path in the browser**

Run: `npx serve .` from the repo root, open the site.

Manual checklist:
1. Header shows the logo, CA/ES/EN buttons, WhatsApp/Instagram/Email links, and the "Coordinar recollida" button.
2. Clicking a language button changes all visible text instantly (hero, services, form) and persists after a page reload (stored in `localStorage`).
3. Clicking "Coordinar recollida" (header or hero) opens the modal at step 1.
4. Selecting a shoe type, quantity and service updates the total price live; "Siguiente" stays disabled until all three are chosen.
5. Step 2: typing an address and blurring the field shows nearest GLS points (requires network access to `nominatim.openstreetmap.org`); choosing "Tienda asociada" instead shows the placeholder store and enables "Efectivo" in step 3; "Siguiente" stays disabled until name/address/valid phone/valid email/delivery choice are all filled.
6. Step 3: "Efectivo" is disabled unless "Tienda asociada" was chosen; Bizum/Transferencia show instructions; clicking "Ya lo he enviado" or "Confirmar pedido" calls the (not yet deployed) Worker and shows the generic error message from `form_error_generic` — expected until Task 22 deploys the Worker. Once the Worker exists (Task 20+), this same click should instead show the success screen with the order reference and a bullet list summarizing the order (`summaryLines`).
7. Closing the modal (✕, Escape, or clicking outside) works and resets nothing unexpectedly (state persists if reopened, which is acceptable for this MVP).

- [ ] **Step 4: Commit**

```bash
git add js/config.js js/app.js
git commit -m "feat: wire Alpine components for header, i18n and order form"
```

---

## Task 19: `gracias.html` — Stripe return / payment confirmation page

Stripe redirects here after a card payment. The page reads `session_id` from
the URL, asks the Worker to verify and (if paid) trigger the emails, then
shows the result. No Alpine needed — a single linear state machine is simpler
in plain JS.

**Files:**
- Create: `gracias.html`
- Create: `js/gracias.js`

- [ ] **Step 1: Write `gracias.html`**

```html
<!doctype html>
<html lang="ca">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Grip La Seu — Gràcies</title>
  <link rel="icon" href="assets/logo.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <header class="site-header">
    <div class="container">
      <div class="logo">
        <img src="assets/logo.svg" alt="Grip La Seu" />
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="container">
      <h1 id="gracias-title"></h1>
      <p id="gracias-message"></p>
      <p id="gracias-order-id" style="font-weight: 700;"></p>
      <ul id="gracias-summary" class="point-list"></ul>
      <a class="btn btn-primary" href="index.html">Grip La Seu</a>
    </div>
  </section>

  <script type="module" src="js/gracias.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `js/gracias.js`**

```js
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
```

- [ ] **Step 3: Verify manually with a fake session id**

Run: `npx serve .`, open
`http://localhost:8080/gracias.html?session_id=fake`.
Expected: title shows "Comprobando el pago..." briefly, then falls back to
the "not paid" message once the (undeployed) Worker call fails — confirms the
page's state machine and i18n wiring work before the Worker exists.

- [ ] **Step 4: Commit**

```bash
git add gracias.html js/gracias.js
git commit -m "feat: add Stripe return confirmation page"
```

---

## Task 20: Manual end-to-end QA checklist (local, before deployment)

Consolidates the spec's "Testing" section into one pre-deployment pass, now
that every piece (Tasks 2-19) exists locally. This uses `worker/.dev.vars`
with real *test-mode* Stripe/Resend keys temporarily so the full flow can be
exercised end to end.

**Files:** none created — this is a verification task.

- [ ] **Step 1: Get test-mode credentials**

- Stripe: create a free Stripe account if needed, copy the **test mode**
  secret key (`sk_test_...`) from the Stripe Dashboard.
- Resend: create a free Resend account, copy an API key (`re_...`). The
  test/onboarding sender `onboarding@resend.dev` can only send to the email
  address the Resend account is registered with — use that address as the
  "customer" email while testing.

- [ ] **Step 2: Fill in real test keys locally**

Edit `worker/.dev.vars` (gitignored, never committed):
```
STRIPE_SECRET_KEY=sk_test_...
RESEND_API_KEY=re_...
```

- [ ] **Step 3: Run the Worker and the frontend together**

Terminal 1: `cd worker && npx wrangler dev`
Terminal 2 (repo root): `npx serve .`

Temporarily point the frontend at the local Worker by editing
`js/config.js`:
```js
export const API_BASE_URL = 'http://localhost:8787';
```
(Revert this edit after the QA pass — Task 22/23 will point it at the real
deployed Worker instead.)

- [ ] **Step 4: Walk the full flow for each combination**

For each of the 4 payment methods × 2 delivery types (8 runs isn't required —
cover at least these 4, which exercise every code path):
1. Pie de gato / resolado completo / cantidad 1 / punto GLS / Bizum → confirm
   → verify both emails arrive (owner inbox + the Resend-registered test
   address) with matching order data.
2. Bota / media suela / cantidad 2 / tienda asociada / Efectivo → confirm →
   verify both emails arrive and "Efectivo" was selectable.
3. Pie de gato / puntera / cantidad 1 / punto GLS / Transferencia → confirm →
   verify both emails arrive.
4. Bota / resolado completo / cantidad 1 / tienda asociada / Tarjeta → click
   "Pagar con tarjeta" → complete payment on Stripe's test checkout page
   (card `4242 4242 4242 4242`, any future date/CVC) → confirm redirect to
   `gracias.html` shows "Hemos recibido tu pago correctamente" with an order
   reference → verify both emails arrive.

- [ ] **Step 5: Test the address-not-found fallback**

In step 2 of the form, type an unrecognizable address (e.g. `asdkfjhasdkjfh`)
and blur the field. Expected: the "no se pudo geolocalizar" message appears
and the full `PUNTOS_GLS` list shows instead of a filtered/sorted one.

- [ ] **Step 6: Test language switching persists**

Switch to EN, reload the page. Expected: still EN (reads `localStorage`).

- [ ] **Step 7: Revert the temporary local API URL**

```bash
git diff js/config.js
git checkout -- js/config.js
```
Expected: `js/config.js` is back to the placeholder Worker URL, ready for
Task 22/23 to set the real one.

---

## Task 21: Create the GitHub repo and enable GitHub Pages

**This task pushes code to a public GitHub repository and changes account
settings — confirm with Piero before running Steps 2-4, per the standing rule
of not taking shared-state actions without explicit go-ahead, even though
GitHub Pages was the explicit goal of this project.**

**Files:** none created — this is a deployment task.

- [ ] **Step 1: Confirm the repo name with Piero**

Default: `grip-la-seu` under the `pierorepp90` account, giving a site URL of
`https://pierorepp90.github.io/grip-la-seu/`. Confirm before proceeding, since
this affects `SITE_URL`/`ALLOWED_ORIGIN` in `worker/wrangler.toml` (Task 11)
and the URLs hardcoded in `index.html`'s social links.

- [ ] **Step 2: Create the repo**

Run:
```bash
gh repo create pierorepp90/grip-la-seu --public --source=. --remote=origin
```
Expected: repo created on GitHub and `origin` remote added locally.

- [ ] **Step 3: Push the code**

```bash
git push -u origin master
```
Expected: all commits from Tasks 1-20 appear on GitHub.

- [ ] **Step 4: Enable GitHub Pages**

Run:
```bash
gh api -X POST repos/pierorepp90/grip-la-seu/pages -f "source[branch]=master" -f "source[path]=/"
```
Expected: `201 Created`. If it instead returns `409` (Pages already
configured) that's fine too — verify with:
```bash
gh api repos/pierorepp90/grip-la-seu/pages
```
Expected: `"status"` eventually becomes `"built"` and `"html_url"` is
`https://pierorepp90.github.io/grip-la-seu/` (can take a minute after the
first push).

- [ ] **Step 5: Verify the live site loads**

Open `https://pierorepp90.github.io/grip-la-seu/` in a browser.
Expected: same page verified locally in Task 20, minus working order
submission (the Worker isn't deployed yet — that's Task 22).

---

## Task 22: Deploy the Cloudflare Worker and set production secrets

**This deploys a public API endpoint and should be confirmed with Piero
before Steps 2-4, especially before switching from Stripe test keys to any
live key.**

**Files:**
- Modify: `worker/wrangler.toml` (update `SITE_URL`/`ALLOWED_ORIGIN` if the
  repo name from Task 21 differs from the `grip-la-seu` default)

- [ ] **Step 1: Log in to Cloudflare**

Run (from `worker/`): `npx wrangler login`
Expected: opens a browser to authorize `wrangler` against a (free) Cloudflare
account.

- [ ] **Step 2: Set production secrets**

Run (from `worker/`):
```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put RESEND_API_KEY
```
Each prompts for a value — paste the Stripe **test-mode** secret key and the
Resend API key used in Task 20 (switch to Stripe live keys only once Piero
has verified a real payout account and wants to go live — that's a separate,
explicit decision, not part of this plan).

- [ ] **Step 3: Update `worker/wrangler.toml` if needed and deploy**

If the repo/site URL from Task 21 matches the `grip-la-seu` default, no edit
is needed. Otherwise update `SITE_URL` and `ALLOWED_ORIGIN` to match first.

Run (from `worker/`): `npx wrangler deploy`
Expected: output includes a URL like
`https://grip-la-seu-api.<your-subdomain>.workers.dev`. Copy this exact URL
for Task 23.

- [ ] **Step 4: Smoke-test the deployed Worker**

```bash
curl -i -X OPTIONS https://grip-la-seu-api.<your-subdomain>.workers.dev/api/notify-order \
  -H "Origin: https://pierorepp90.github.io"
```
Expected: `204` with `Access-Control-Allow-Origin: https://pierorepp90.github.io`.

- [ ] **Step 5: Commit any `wrangler.toml` changes**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): update site/origin URLs for deployment"
```
(Skip this step if Step 3 required no edits — nothing to commit.)

---

## Task 23: Point the frontend at the deployed Worker and final smoke test

**Files:**
- Modify: `js/config.js`

- [ ] **Step 1: Update the production API URL**

```js
// js/config.js
export const API_BASE_URL = 'https://grip-la-seu-api.<your-subdomain>.workers.dev';
```
Replace `<your-subdomain>` with the exact value from Task 22 Step 3.

- [ ] **Step 2: Commit and push**

```bash
git add js/config.js
git commit -m "chore: point frontend at deployed Worker"
git push
```
Expected: GitHub Pages rebuilds automatically within ~1 minute (no CI needed
— it just serves the updated static files).

- [ ] **Step 3: Repeat the Task 20 manual QA checklist against the live site**

Open `https://pierorepp90.github.io/grip-la-seu/` and re-run at least the
Bizum flow (fastest) and the Tarjeta flow (exercises the full Stripe +
`gracias.html` round trip) end to end, confirming both owner and customer
emails arrive. This is the final acceptance check for the whole plan.

- [ ] **Step 4: Note remaining placeholders for Piero**

Remind Piero (outside of code — a message, not a commit) that these still
need real values before taking the site fully live, matching the spec's
"Datos pendientes" list: `js/precios.js`, `js/puntos-gls.js`, `js/tiendas.js`,
Instagram/email in `index.html`, the real logo file (`assets/logo.svg`),
Bizum number/IBAN text in `js/i18n.js`, and switching Stripe from test to
live keys when ready to accept real card payments.
