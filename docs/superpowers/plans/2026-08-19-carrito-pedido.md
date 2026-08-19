# Carrito de pedido con variantes de suela y transporte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single exclusive tipo/servicio/cantidad selector in the order form with a cart that accumulates multiple lines (each with its own tipo de calzado, servicio, and — for suela services — material and grosor), plus an optional flat GLS shipping surcharge, end to end through pricing, the frontend cart UI, Stripe checkout, and the confirmation emails.

**Architecture:** `js/precios.js` moves from a flat price table to one nested by material/grosor for the two suela services; `js/pricing.js` gets a single `calculateLinePrice` that resolves both the flat (puntera) and nested (suela) shapes, plus `minPrecioServicio` for the homepage "from" prices. `js/app.js`'s `orderForm()` keeps a `carrito` array instead of single fields, with helper methods to add/merge/adjust/remove lines. The Worker's Stripe integration sends one `line_item` per cart line (+ one for shipping) instead of cramming the cart into metadata, and reconstructs it on payment confirmation via Stripe's own `expand[]=line_items`, keeping only order-level fields (name, address, totals) in `metadata`.

**Tech Stack:** Vanilla JS (ES modules, no build step), Alpine.js (CDN), Node's built-in test runner (`node --test`), Cloudflare Workers, Stripe Checkout, Resend.

**Spec:** `docs/superpowers/specs/2026-08-19-carrito-pedido-design.md`

---

### Task 1: `js/precios.js` — nested pricing for suela services + shipping price

**Files:**
- Modify: `js/precios.js`
- Modify: `tests/data.test.js`

- [ ] **Step 1: Rewrite `tests/data.test.js` to expect the new shape**

Replace the entire file with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRECIOS, PRECIO_TRANSPORTE_GLS } from '../js/precios.js';
import { PUNTOS_GLS } from '../js/puntos-gls.js';
import { TIENDAS } from '../js/tiendas.js';
import { calculateLinePrice } from '../js/pricing.js';

const MATERIALES = ['vibram_xs_grip2', 'cocida'];
const GROSORES = ['3.5', '4', '4.5', '5'];

test('PRECIOS tiene todas las combinaciones de material y grosor para resolado_completo y media_suela', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    for (const servicio of ['resolado_completo', 'media_suela']) {
      for (const material of MATERIALES) {
        for (const grosor of GROSORES) {
          const precio = PRECIOS[tipo][servicio][material][grosor];
          assert.equal(typeof precio, 'number');
          assert.doesNotThrow(() =>
            calculateLinePrice(PRECIOS, tipo, servicio, material, grosor, 1),
          );
        }
      }
    }
  }
});

test('PRECIOS tiene tarifa plana numérica para puntera', () => {
  for (const tipo of ['bota', 'pie_de_gato']) {
    assert.equal(typeof PRECIOS[tipo].puntera, 'number');
    assert.doesNotThrow(() => calculateLinePrice(PRECIOS, tipo, 'puntera', null, null, 1));
  }
});

test('PRECIO_TRANSPORTE_GLS es un número', () => {
  assert.equal(typeof PRECIO_TRANSPORTE_GLS, 'number');
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

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test tests/data.test.js`
Expected: FAIL — Node reports an import error (`calculateLinePrice` isn't exported from `js/pricing.js` yet, and `js/precios.js` doesn't have the new shape yet either). That's the expected failure at this point; both get fixed by the end of this task and Task 2.

- [ ] **Step 3: Rewrite `js/precios.js`**

```js
// PENDIENTE: confirmar tarifas reales con el propietario antes de publicar.
export const PRECIOS = {
  bota: {
    resolado_completo: {
      vibram_xs_grip2: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
      cocida: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
    },
    media_suela: {
      vibram_xs_grip2: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
      cocida: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
    },
    puntera: 15,
  },
  pie_de_gato: {
    resolado_completo: {
      vibram_xs_grip2: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
      cocida: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
    },
    media_suela: {
      vibram_xs_grip2: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
      cocida: { '3.5': 0, '4': 0, '4.5': 0, '5': 0 },
    },
    puntera: 12,
  },
};

// PENDIENTE: confirmar tarifa real de envío GLS.
export const PRECIO_TRANSPORTE_GLS = 0;
```

- [ ] **Step 4: Run the test again (will still fail until Task 2 adds `calculateLinePrice`)**

Run: `node --test tests/data.test.js`
Expected: FAIL with the same import error — `calculateLinePrice` still isn't exported from `js/pricing.js`. This is expected; move on to Task 2, then re-run this file at the end of Task 2 Step 4.

- [ ] **Step 5: Commit**

```bash
git add js/precios.js tests/data.test.js
git commit -m "feat(precios): nest suela prices by material/grosor, add shipping price"
```

---

### Task 2: `js/pricing.js` — `calculateLinePrice` and `minPrecioServicio`

**Files:**
- Modify: `js/pricing.js`
- Modify: `tests/pricing.test.js`
- Modify: `js/app.js:6` (import only, see Task 6)

- [ ] **Step 1: Rewrite `tests/pricing.test.js`**

Replace the entire file with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLinePrice, minPrecioServicio } from '../js/pricing.js';

const PRECIOS = {
  bota: {
    resolado_completo: {
      vibram_xs_grip2: { '3.5': 40, '4': 42, '4.5': 44, '5': 46 },
      cocida: { '3.5': 38, '4': 40, '4.5': 42, '5': 44 },
    },
    media_suela: {
      vibram_xs_grip2: { '3.5': 25, '4': 27, '4.5': 29, '5': 31 },
      cocida: { '3.5': 23, '4': 25, '4.5': 27, '5': 29 },
    },
    puntera: 15,
  },
  pie_de_gato: {
    resolado_completo: {
      vibram_xs_grip2: { '3.5': 30, '4': 32, '4.5': 34, '5': 36 },
      cocida: { '3.5': 28, '4': 30, '4.5': 32, '5': 34 },
    },
    media_suela: {
      vibram_xs_grip2: { '3.5': 18, '4': 20, '4.5': 22, '5': 24 },
      cocida: { '3.5': 16, '4': 18, '4.5': 20, '5': 22 },
    },
    puntera: 12,
  },
};

test('calcula el precio de un servicio con material y grosor, por cantidad', () => {
  assert.equal(
    calculateLinePrice(PRECIOS, 'pie_de_gato', 'resolado_completo', 'vibram_xs_grip2', '4', 2),
    64,
  );
});

test('calcula el precio de puntera como precio plano, sin material ni grosor', () => {
  assert.equal(calculateLinePrice(PRECIOS, 'bota', 'puntera', null, null, 3), 45);
});

test('lanza error si la cantidad no es un entero positivo', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'puntera', null, null, 0));
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'puntera', null, null, 1.5));
});

test('lanza error si el tipo de calzado es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'sandalia', 'puntera', null, null, 1));
});

test('lanza error si el servicio es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'plantilla', null, null, 1));
});

test('lanza error si el material es desconocido', () => {
  assert.throws(() => calculateLinePrice(PRECIOS, 'bota', 'resolado_completo', 'goma', '4', 1));
});

test('lanza error si el grosor es desconocido', () => {
  assert.throws(() =>
    calculateLinePrice(PRECIOS, 'bota', 'resolado_completo', 'vibram_xs_grip2', '6', 1),
  );
});

test('minPrecioServicio devuelve el mínimo entre todas las combinaciones de tipo/material/grosor', () => {
  assert.equal(minPrecioServicio(PRECIOS, 'resolado_completo'), 28);
});

test('minPrecioServicio funciona también con un servicio de precio plano', () => {
  assert.equal(minPrecioServicio(PRECIOS, 'puntera'), 12);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test tests/pricing.test.js`
Expected: FAIL — `calculateLinePrice`/`minPrecioServicio` are not exported yet (`js/pricing.js` still only has `calculatePrice`).

- [ ] **Step 3: Rewrite `js/pricing.js`**

Replace the entire file (this removes `calculatePrice` — it can no longer work correctly against the nested `PRECIOS` shape, so keeping it around would be a silent bug rather than a working fallback):

```js
export function calculateLinePrice(precios, tipoCalzado, servicio, material, grosor, cantidad) {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error('cantidad debe ser un entero >= 1');
  }
  const porTipo = precios[tipoCalzado];
  if (!porTipo) {
    throw new Error(`tipo de calzado desconocido: ${tipoCalzado}`);
  }
  const porServicio = porTipo[servicio];
  if (porServicio == null) {
    throw new Error(`servicio desconocido: ${servicio}`);
  }
  if (typeof porServicio === 'number') {
    return porServicio * cantidad;
  }
  const porMaterial = porServicio[material];
  if (!porMaterial) {
    throw new Error(`material desconocido: ${material}`);
  }
  const precioUnitario = porMaterial[grosor];
  if (typeof precioUnitario !== 'number') {
    throw new Error(`grosor desconocido: ${grosor}`);
  }
  return precioUnitario * cantidad;
}

export function minPrecioServicio(precios, servicio) {
  const valores = [];
  for (const tipo of Object.keys(precios)) {
    const porServicio = precios[tipo][servicio];
    if (typeof porServicio === 'number') {
      valores.push(porServicio);
    } else {
      for (const porMaterial of Object.values(porServicio)) {
        valores.push(...Object.values(porMaterial));
      }
    }
  }
  return Math.min(...valores);
}
```

- [ ] **Step 4: Run both pricing and data tests**

Run: `node --test tests/pricing.test.js tests/data.test.js`
Expected: PASS — all tests in both files.

- [ ] **Step 5: Commit**

```bash
git add js/pricing.js tests/pricing.test.js
git commit -m "feat(pricing): replace calculatePrice with calculateLinePrice + minPrecioServicio"
```

---

### Task 3: `js/order.js` — cart-aware order summary

**Files:**
- Modify: `js/order.js`
- Modify: `tests/order.test.js`

- [ ] **Step 1: Rewrite `tests/order.test.js`**

Replace the entire file with:

```js
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

test('buildOrderSummary detalla cada línea del carrito con material y grosor, y el envío', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0001',
    carrito: [
      {
        tipoCalzado: 'pie_de_gato',
        servicio: 'resolado_completo',
        material: 'vibram_xs_grip2',
        grosor: '4',
        cantidad: 2,
        precioUnitario: 35,
        precioSubtotal: 70,
      },
      {
        tipoCalzado: 'bota',
        servicio: 'puntera',
        material: null,
        grosor: null,
        cantidad: 1,
        precioUnitario: 15,
        precioSubtotal: 15,
      },
    ],
    transporte: 6,
    precioTotal: 91,
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
  assert.match(joined, /pie_de_gato · resolado_completo \(vibram_xs_grip2, 4mm\) ×2 — 70\.00€/);
  assert.match(joined, /bota · puntera ×1 — 15\.00€/);
  assert.match(joined, /Envío GLS: 6\.00€/);
  assert.match(joined, /Total: 91\.00€/);
  assert.match(joined, /Ana Pérez/);
  assert.match(joined, /Punt GLS Centre/);
  assert.match(joined, /bizum/);
});

test('buildOrderSummary omite la línea de envío cuando el transporte es 0', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0002',
    carrito: [
      {
        tipoCalzado: 'bota',
        servicio: 'puntera',
        material: null,
        grosor: null,
        cantidad: 1,
        precioUnitario: 15,
        precioSubtotal: 15,
      },
    ],
    transporte: 0,
    precioTotal: 15,
    nombre: 'Ana Pérez',
    direccion: 'Carrer Major 1',
    telefono: '+34612345678',
    email: 'ana@example.com',
    entrega: { tipo: 'tienda', nombre: 'Tenda Centre' },
    metodoPago: 'efectivo',
  };
  const summary = buildOrderSummary(orderPayload);
  const joined = summary.lineas.join(' | ');
  assert.doesNotMatch(joined, /Envío GLS/);
  assert.match(joined, /Total: 15\.00€/);
});

test('buildOrderSummary usa la descripción reconstruida desde Stripe cuando no hay campos estructurados', () => {
  const orderPayload = {
    orderId: 'GLS-TEST-0003',
    carrito: [
      {
        descripcion: 'resolado_completo (pie_de_gato) (vibram_xs_grip2, 4mm)',
        cantidad: 2,
        precioUnitario: 35,
        precioSubtotal: 70,
      },
    ],
    transporte: 0,
    precioTotal: 70,
    nombre: 'Ana Pérez',
    direccion: 'Carrer Major 1',
    telefono: '+34612345678',
    email: 'ana@example.com',
    entrega: { tipo: 'tienda', nombre: 'Tenda Centre' },
    metodoPago: 'tarjeta',
  };
  const summary = buildOrderSummary(orderPayload);
  const joined = summary.lineas.join(' | ');
  assert.match(joined, /resolado_completo \(pie_de_gato\) \(vibram_xs_grip2, 4mm\) ×2 — 70\.00€/);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test tests/order.test.js`
Expected: FAIL — `buildOrderSummary` still reads `orderPayload.tipoCalzado`/`servicio`/`cantidad` directly instead of `orderPayload.carrito`.

- [ ] **Step 3: Rewrite `js/order.js`**

```js
export function generateOrderId(now = new Date(), randomFn = Math.random) {
  const datePart = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const randomPart = Math.floor(randomFn() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `GLS-${datePart}-${randomPart}`;
}

function formatearLineaCarrito(linea) {
  const subtotal = linea.precioSubtotal.toFixed(2);
  if (linea.descripcion) {
    return `${linea.descripcion} ×${linea.cantidad} — ${subtotal}€`;
  }
  const variante = linea.material ? ` (${linea.material}, ${linea.grosor}mm)` : '';
  return `${linea.tipoCalzado} · ${linea.servicio}${variante} ×${linea.cantidad} — ${subtotal}€`;
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
    entrega,
    metodoPago,
  } = orderPayload;

  const entregaTexto =
    entrega.tipo === 'gls'
      ? `Punto GLS: ${entrega.nombre}`
      : `Tienda asociada: ${entrega.nombre}`;

  const lineas = [`Referencia: ${orderId}`, ...carrito.map(formatearLineaCarrito)];
  if (transporte > 0) {
    lineas.push(`Envío GLS: ${transporte.toFixed(2)}€`);
  }
  lineas.push(
    `Total: ${precioTotal.toFixed(2)}€`,
    `Nombre: ${nombre}`,
    `Dirección: ${direccion}`,
    `Teléfono: ${telefono}`,
    `Email: ${email}`,
    `Entrega: ${entregaTexto}`,
    `Pago: ${metodoPago}`,
  );

  return { orderId, lineas };
}
```

- [ ] **Step 4: Run the test again**

Run: `node --test tests/order.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add js/order.js tests/order.test.js
git commit -m "feat(order): build order summary from a cart array plus shipping"
```

---

### Task 4: `js/i18n.js` — new translation keys

**Files:**
- Modify: `js/i18n.js:11` (ca block), `js/i18n.js:67` (es block), `js/i18n.js:123` (en block)

- [ ] **Step 1: Add the new keys to the `ca` block**

In `js/i18n.js`, in the `ca` object, right after the `hero_cta_secondary` line, add:

```js
    material_vibram_xs_grip2: 'Vibram XS Grip2',
    material_cocida: 'Cosida',
    material_label: 'Material',
    grosor_label: 'Gruix',
    btn_anadir: 'Afegir',
    carrito_title: 'Resum de la comanda',
    envio_gls_label: 'Enviament GLS',
```

- [ ] **Step 2: Add the equivalent keys to the `es` block**

In the `es` object, right after `hero_cta_secondary`, add:

```js
    material_vibram_xs_grip2: 'Vibram XS Grip2',
    material_cocida: 'Cocida',
    material_label: 'Material',
    grosor_label: 'Grosor',
    btn_anadir: 'Añadir',
    carrito_title: 'Resumen del pedido',
    envio_gls_label: 'Envío GLS',
```

- [ ] **Step 3: Add the equivalent keys to the `en` block**

In the `en` object, right after `hero_cta_secondary`, add:

```js
    material_vibram_xs_grip2: 'Vibram XS Grip2',
    material_cocida: 'Stitched',
    material_label: 'Material',
    grosor_label: 'Thickness',
    btn_anadir: 'Add',
    carrito_title: 'Order summary',
    envio_gls_label: 'GLS shipping',
```

- [ ] **Step 4: Run the i18n test to confirm the three languages stay in sync**

Run: `node --test tests/i18n.test.js`
Expected: PASS — `'las 3 lenguas tienen exactamente las mismas claves'` and `'ninguna traducción está vacía'` both pass.

- [ ] **Step 5: Commit**

```bash
git add js/i18n.js
git commit -m "feat(i18n): add material, grosor and cart summary translation keys"
```

---

### Task 5: `css/styles.css` — cart and service-item styles

**Files:**
- Modify: `css/styles.css` (append after the `.price-total` rule, which ends at line 373)

- [ ] **Step 1: Add the new rules**

Insert after the `.price-total { ... }` block (line 373) and before `.form-field { ... }`:

```css
.service-item {
  border: 1px solid var(--color-slate);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
}

.service-item-header {
  margin-bottom: 0.5rem;
}

.service-item-selects {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.service-item-selects select {
  flex: 1;
  padding: 0.4rem;
  border: 1px solid var(--color-slate);
  border-radius: var(--radius);
  font-size: 0.9rem;
}

.service-item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.stepper-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.stepper-inline button {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  border: 1px solid var(--color-slate);
  background: var(--color-white);
  font-size: 1rem;
  cursor: pointer;
}

.stepper-inline button:hover,
.stepper-inline button:focus-visible {
  border-color: var(--color-amber);
  outline: none;
}

.cart-summary {
  border-top: 1px solid var(--color-border-light);
  padding-top: 0.75rem;
  margin-top: 0.5rem;
}

.cart-summary-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  color: var(--color-slate);
  margin-bottom: 0.5rem;
}

.cart-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border-light);
}

.cart-line-info {
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
}

.cart-line-variant {
  font-size: 0.8rem;
  color: var(--color-slate);
}

.cart-line-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  white-space: nowrap;
}

.cart-line-controls button:not(.cart-line-remove) {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: 1px solid var(--color-slate);
  background: var(--color-white);
  cursor: pointer;
}

.cart-line-remove {
  background: none;
  border: none;
  color: #b3261e;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 0.25rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add css/styles.css
git commit -m "feat(styles): add service-item and cart summary styles"
```

(No automated test — this is pure CSS, verified visually in Task 9's manual QA.)

---

### Task 6: `js/app.js` — cart state and methods

**Files:**
- Modify: `js/app.js` (full rewrite)

- [ ] **Step 1: Rewrite `js/app.js`**

```js
// js/app.js
import { LANGS, t } from './i18n.js';
import { PRECIOS, PRECIO_TRANSPORTE_GLS } from './precios.js';
import { PUNTOS_GLS } from './puntos-gls.js';
import { TIENDAS } from './tiendas.js';
import { calculateLinePrice, minPrecioServicio } from './pricing.js';
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
    precioDesde(servicio) {
      return minPrecioServicio(PRECIOS, servicio);
    },
  }));

  Alpine.data('orderForm', () => ({
    step: 1,
    success: false,
    submitting: false,
    errorMsg: '',
    orderId: '',
    summaryLines: [],

    // Paso 1 — carrito
    tipoCalzado: 'pie_de_gato',
    carrito: [],
    resoladoMaterial: 'vibram_xs_grip2',
    resoladoGrosor: '3.5',
    mediaSuelaMaterial: 'vibram_xs_grip2',
    mediaSuelaGrosor: '3.5',
    transporteGLS: PRECIO_TRANSPORTE_GLS,

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

    get precioResolado() {
      try {
        return calculateLinePrice(
          PRECIOS,
          this.tipoCalzado,
          'resolado_completo',
          this.resoladoMaterial,
          this.resoladoGrosor,
          1,
        );
      } catch {
        return 0;
      }
    },

    get precioMediaSuela() {
      try {
        return calculateLinePrice(
          PRECIOS,
          this.tipoCalzado,
          'media_suela',
          this.mediaSuelaMaterial,
          this.mediaSuelaGrosor,
          1,
        );
      } catch {
        return 0;
      }
    },

    get precioPuntera() {
      try {
        return calculateLinePrice(PRECIOS, this.tipoCalzado, 'puntera', null, null, 1);
      } catch {
        return 0;
      }
    },

    get cantidadPuntera() {
      const linea = this.buscarLineaCarrito(this.tipoCalzado, 'puntera', null, null);
      return linea ? linea.cantidad : 0;
    },

    get totalCarrito() {
      return this.carrito.reduce((suma, linea) => suma + linea.precioSubtotal, 0);
    },

    get incluyeTransporte() {
      return this.entregaTipo === 'gls';
    },

    get precioTotal() {
      return this.totalCarrito + (this.incluyeTransporte ? this.transporteGLS : 0);
    },

    get canProceedStep1() {
      return this.carrito.length > 0 && this.carrito.every((linea) => linea.cantidad >= 1);
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

    buscarLineaCarrito(tipoCalzado, servicio, material, grosor) {
      return this.carrito.find(
        (linea) =>
          linea.tipoCalzado === tipoCalzado &&
          linea.servicio === servicio &&
          linea.material === material &&
          linea.grosor === grosor,
      );
    },

    agregarAlCarrito(tipoCalzado, servicio, material, grosor, precioUnitario, cantidad = 1) {
      const existente = this.buscarLineaCarrito(tipoCalzado, servicio, material, grosor);
      if (existente) {
        existente.cantidad += cantidad;
        existente.precioSubtotal = existente.precioUnitario * existente.cantidad;
        return;
      }
      this.carrito.push({
        tipoCalzado,
        servicio,
        material,
        grosor,
        cantidad,
        precioUnitario,
        precioSubtotal: precioUnitario * cantidad,
      });
    },

    quitarDelCarrito(linea) {
      this.carrito = this.carrito.filter((l) => l !== linea);
    },

    ajustarCantidad(linea, delta) {
      const nuevaCantidad = linea.cantidad + delta;
      if (nuevaCantidad <= 0) {
        this.quitarDelCarrito(linea);
        return;
      }
      linea.cantidad = nuevaCantidad;
      linea.precioSubtotal = linea.precioUnitario * nuevaCantidad;
    },

    anadirResolado() {
      this.agregarAlCarrito(
        this.tipoCalzado,
        'resolado_completo',
        this.resoladoMaterial,
        this.resoladoGrosor,
        this.precioResolado,
      );
    },

    anadirMediaSuela() {
      this.agregarAlCarrito(
        this.tipoCalzado,
        'media_suela',
        this.mediaSuelaMaterial,
        this.mediaSuelaGrosor,
        this.precioMediaSuela,
      );
    },

    incrementarPuntera() {
      this.agregarAlCarrito(this.tipoCalzado, 'puntera', null, null, this.precioPuntera);
    },

    decrementarPuntera() {
      const linea = this.buscarLineaCarrito(this.tipoCalzado, 'puntera', null, null);
      if (linea) this.ajustarCantidad(linea, -1);
    },

    async buscarPuntosGLS() {
      if (!isNonEmpty(this.direccion)) return;
      let coords = null;
      try {
        coords = await geocodeAddress(this.direccion);
      } catch (error) {
        console.error(error);
      }
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
        carrito: this.carrito.map((linea) => ({ ...linea })),
        transporte: this.incluyeTransporte ? this.transporteGLS : 0,
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
        console.error(error);
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
        console.error(error);
        this.errorMsg = t(Alpine.store('i18n').lang, 'form_error_generic');
        this.submitting = false;
      }
    },
  }));
});
```

- [ ] **Step 2: Run the full frontend test suite**

Run: `node --test`
Expected: PASS — `js/app.js` has no dedicated test file (consistent with the rest of the project: Alpine components aren't unit-tested, only the pure modules they import are), so this just confirms the import changes didn't break `pricing.js`/`order.js`/`precios.js` tests.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(app): rebuild orderForm around a cart instead of a single selection"
```

---

### Task 7: `index.html` — cart UI in step 1, shipping line in step 2, homepage prices

**Files:**
- Modify: `index.html:71-102` (step 1)
- Modify: `index.html:147-162` (step 2, insert shipping price line after the delivery cards)
- Modify: `index.html:219-233` (homepage service prices)

- [ ] **Step 1: Replace the step 1 block (current lines 71-102)**

Replace:

```html
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
```

With:

```html
        <template x-if="!success && step === 1">
          <div>
            <h2 x-text="$t('step1_title')"></h2>

            <label x-text="$t('tipo_calzado_label')"></label>
            <div class="toggle-group">
              <button type="button" class="toggle-option" :class="{ selected: tipoCalzado === 'pie_de_gato' }" @click="tipoCalzado = 'pie_de_gato'" x-text="$t('tipo_pie_de_gato')"></button>
              <button type="button" class="toggle-option" :class="{ selected: tipoCalzado === 'bota' }" @click="tipoCalzado = 'bota'" x-text="$t('tipo_bota')"></button>
            </div>

            <div class="service-item">
              <div class="service-item-header">
                <strong x-text="$t('service_resolado_completo_title')"></strong>
              </div>
              <div class="service-item-selects">
                <select x-model="resoladoMaterial" :aria-label="$t('material_label')">
                  <option value="vibram_xs_grip2" x-text="$t('material_vibram_xs_grip2')"></option>
                  <option value="cocida" x-text="$t('material_cocida')"></option>
                </select>
                <select x-model="resoladoGrosor" :aria-label="$t('grosor_label')">
                  <option value="3.5">3.5 mm</option>
                  <option value="4">4 mm</option>
                  <option value="4.5">4.5 mm</option>
                  <option value="5">5 mm</option>
                </select>
              </div>
              <div class="service-item-footer">
                <span x-text="precioResolado.toFixed(2) + '€/ud'"></span>
                <button type="button" class="btn btn-secondary" @click="anadirResolado()" x-text="$t('btn_anadir')"></button>
              </div>
            </div>

            <div class="service-item">
              <div class="service-item-header">
                <strong x-text="$t('service_media_suela_title')"></strong>
              </div>
              <div class="service-item-selects">
                <select x-model="mediaSuelaMaterial" :aria-label="$t('material_label')">
                  <option value="vibram_xs_grip2" x-text="$t('material_vibram_xs_grip2')"></option>
                  <option value="cocida" x-text="$t('material_cocida')"></option>
                </select>
                <select x-model="mediaSuelaGrosor" :aria-label="$t('grosor_label')">
                  <option value="3.5">3.5 mm</option>
                  <option value="4">4 mm</option>
                  <option value="4.5">4.5 mm</option>
                  <option value="5">5 mm</option>
                </select>
              </div>
              <div class="service-item-footer">
                <span x-text="precioMediaSuela.toFixed(2) + '€/ud'"></span>
                <button type="button" class="btn btn-secondary" @click="anadirMediaSuela()" x-text="$t('btn_anadir')"></button>
              </div>
            </div>

            <div class="service-item">
              <div class="service-item-footer">
                <span x-text="$t('service_puntera_title') + ' · ' + precioPuntera.toFixed(2) + '€/ud'"></span>
                <div class="stepper-inline">
                  <button type="button" @click="decrementarPuntera()" aria-label="−">−</button>
                  <span x-text="cantidadPuntera"></span>
                  <button type="button" @click="incrementarPuntera()" aria-label="+">+</button>
                </div>
              </div>
            </div>

            <template x-if="carrito.length > 0">
              <div class="cart-summary">
                <p class="cart-summary-title" x-text="$t('carrito_title')"></p>
                <template x-for="linea in carrito" :key="linea.tipoCalzado + linea.servicio + linea.material + linea.grosor">
                  <div class="cart-line">
                    <span class="cart-line-info">
                      <span x-text="$t('tipo_' + linea.tipoCalzado) + ' · ' + $t('service_' + linea.servicio + '_title')"></span>
                      <span class="cart-line-variant" x-show="linea.material" x-text="linea.material ? ($t('material_' + linea.material) + ' · ' + linea.grosor + ' mm') : ''"></span>
                    </span>
                    <span class="cart-line-controls">
                      <button type="button" @click="ajustarCantidad(linea, -1)" aria-label="−">−</button>
                      <span x-text="linea.cantidad"></span>
                      <button type="button" @click="ajustarCantidad(linea, 1)" aria-label="+">+</button>
                      <strong x-text="linea.precioSubtotal.toFixed(2) + '€'"></strong>
                      <button type="button" class="cart-line-remove" @click="quitarDelCarrito(linea)" aria-label="Quitar">✕</button>
                    </span>
                  </div>
                </template>
              </div>
            </template>

            <p class="price-total" x-show="carrito.length > 0" x-text="$t('precio_total_label') + ': ' + totalCarrito.toFixed(2) + '€'"></p>

            <div class="modal-nav">
              <span></span>
              <button type="button" class="btn btn-primary" :disabled="!canProceedStep1" @click="step = 2" x-text="$t('btn_siguiente')"></button>
            </div>
          </div>
        </template>
```

- [ ] **Step 2: Insert the shipping price line in step 2 (after the two delivery-option-card divs, before `.modal-nav`)**

In the current step 2 block, right after the closing `</div>` of the second `.delivery-option-card` (the "Tienda asociada" card, currently ending right before line 163's `<div class="modal-nav">`), insert:

```html

            <p class="price-total" x-show="entregaTipo" x-text="incluyeTransporte ? ($t('precio_total_label') + ': ' + precioTotal.toFixed(2) + '€ (' + $t('envio_gls_label') + ': ' + transporteGLS.toFixed(2) + '€)') : ($t('precio_total_label') + ': ' + precioTotal.toFixed(2) + '€')"></p>
```

So the delivery cards are immediately followed by this paragraph, then `<div class="modal-nav">`.

- [ ] **Step 3: Update the homepage service prices (current lines 219-233)**

Replace:

```html
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
```

With:

```html
        <article class="service-card">
          <h3 x-text="$t('service_resolado_completo_title')"></h3>
          <p x-text="$t('service_resolado_completo_desc')"></p>
          <p class="price" x-text="$t('service_from') + ' ' + precioDesde('resolado_completo').toFixed(2) + '€'"></p>
        </article>
        <article class="service-card">
          <h3 x-text="$t('service_media_suela_title')"></h3>
          <p x-text="$t('service_media_suela_desc')"></p>
          <p class="price" x-text="$t('service_from') + ' ' + precioDesde('media_suela').toFixed(2) + '€'"></p>
        </article>
        <article class="service-card">
          <h3 x-text="$t('service_puntera_title')"></h3>
          <p x-text="$t('service_puntera_desc')"></p>
          <p class="price" x-text="$t('service_from') + ' ' + precioDesde('puntera').toFixed(2) + '€'"></p>
        </article>
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test`
Expected: PASS — HTML isn't covered by `node --test`, but this confirms nothing in `js/` broke.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(html): rebuild step 1 as a cart, show shipping price, update homepage prices"
```

---

### Task 8: `worker/src/stripe.js` — multi-line-item checkout + session reconstruction

**Files:**
- Modify: `worker/src/stripe.js`
- Modify: `worker/tests/stripe.test.js`

- [ ] **Step 1: Rewrite `worker/tests/stripe.test.js`**

Replace the entire file with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutSessionParams,
  buildCarritoFromLineItems,
  orderPayloadFromSession,
  parseSessionPaymentStatus,
  createStripeSession,
  retrieveStripeSession,
} from '../src/stripe.js';

const orderPayload = {
  orderId: 'GLS-1',
  carrito: [
    {
      tipoCalzado: 'pie_de_gato',
      servicio: 'resolado_completo',
      material: 'vibram_xs_grip2',
      grosor: '4',
      cantidad: 2,
      precioUnitario: 35,
      precioSubtotal: 70,
    },
  ],
  transporte: 6,
  precioTotal: 76,
  nombre: 'Ana Pérez',
  direccion: 'Carrer Major 1',
  telefono: '+34612345678',
  email: 'ana@example.com',
  entrega: { tipo: 'gls', nombre: 'Punt GLS Centre' },
  metodoPago: 'tarjeta',
};

test('buildCheckoutSessionParams genera un line_item por línea del carrito más el envío', () => {
  const params = buildCheckoutSessionParams(orderPayload, 'https://pierorepp90.github.io/grip-la-seu');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('customer_email'), 'ana@example.com');
  assert.equal(params.get('line_items[0][quantity]'), '2');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '3500');
  assert.match(params.get('line_items[0][price_data][product_data][name]'), /resolado_completo/);
  assert.equal(params.get('line_items[1][quantity]'), '1');
  assert.equal(params.get('line_items[1][price_data][unit_amount]'), '600');
  assert.equal(params.get('line_items[1][price_data][product_data][name]'), 'Envío GLS');
  assert.equal(params.get('metadata[order_id]'), 'GLS-1');
  assert.equal(params.get('metadata[nombre]'), 'Ana Pérez');
  assert.equal(params.get('metadata[transporte]'), '6');
  assert.equal(params.get('metadata[entrega_tipo]'), 'gls');
  assert.match(params.get('success_url'), /gracias\.html\?session_id=\{CHECKOUT_SESSION_ID\}/);
});

test('buildCheckoutSessionParams no añade line_item de envío cuando el transporte es 0', () => {
  const params = buildCheckoutSessionParams({ ...orderPayload, transporte: 0 }, 'https://example.com');
  assert.equal(params.get('line_items[1][quantity]'), null);
});

test('buildCarritoFromLineItems reconstruye el carrito desde los line_items de Stripe, sin la línea de envío', () => {
  const session = {
    line_items: {
      data: [
        {
          description: 'resolado_completo (pie_de_gato) (vibram_xs_grip2, 4mm)',
          quantity: 2,
          amount_total: 7000,
          price: { unit_amount: 3500 },
        },
        {
          description: 'Envío GLS',
          quantity: 1,
          amount_total: 600,
          price: { unit_amount: 600 },
        },
      ],
    },
  };
  const carrito = buildCarritoFromLineItems(session);
  assert.equal(carrito.length, 1);
  assert.equal(carrito[0].descripcion, 'resolado_completo (pie_de_gato) (vibram_xs_grip2, 4mm)');
  assert.equal(carrito[0].cantidad, 2);
  assert.equal(carrito[0].precioUnitario, 35);
  assert.equal(carrito[0].precioSubtotal, 70);
});

test('orderPayloadFromSession reconstruye el pedido desde metadata y line_items', () => {
  const session = {
    customer_email: 'ana@example.com',
    line_items: {
      data: [
        {
          description: 'resolado_completo (pie_de_gato) (vibram_xs_grip2, 4mm)',
          quantity: 2,
          amount_total: 7000,
          price: { unit_amount: 3500 },
        },
      ],
    },
    metadata: {
      order_id: 'GLS-1',
      nombre: 'Ana Pérez',
      direccion: 'Carrer Major 1',
      telefono: '+34612345678',
      precio_total: '70',
      transporte: '0',
      entrega_tipo: 'gls',
      entrega_nombre: 'Punt GLS Centre',
    },
  };
  const result = orderPayloadFromSession(session);
  assert.equal(result.orderId, 'GLS-1');
  assert.equal(result.carrito.length, 1);
  assert.equal(result.transporte, 0);
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

test('retrieveStripeSession pide la sesión con los line_items expandidos', async () => {
  const fakeFetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions/sess_123?expand[]=line_items');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_123');
    return { ok: true, json: async () => ({ id: 'sess_123', payment_status: 'paid' }) };
  };
  const result = await retrieveStripeSession('sess_123', 'sk_test_123', fakeFetch);
  assert.equal(result.payment_status, 'paid');
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `(cd worker && node --test)`
Expected: FAIL — `buildCarritoFromLineItems`/`orderPayloadFromSession` don't exist yet, and `buildCheckoutSessionParams`/`retrieveStripeSession` still use the old single-item/no-expand shape.

- [ ] **Step 3: Rewrite `worker/src/stripe.js`**

```js
export function buildCheckoutSessionParams(orderPayload, siteUrl) {
  const { orderId, carrito, transporte, nombre, direccion, telefono, email, entrega, precioTotal } =
    orderPayload;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('customer_email', email);
  params.set('success_url', `${siteUrl}/gracias.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${siteUrl}/?pago=cancelado`);

  carrito.forEach((linea, index) => {
    const variante = linea.material ? ` (${linea.material}, ${linea.grosor}mm)` : '';
    params.set(`line_items[${index}][quantity]`, String(linea.cantidad));
    params.set(`line_items[${index}][price_data][currency]`, 'eur');
    params.set(
      `line_items[${index}][price_data][unit_amount]`,
      String(Math.round(linea.precioUnitario * 100)),
    );
    params.set(
      `line_items[${index}][price_data][product_data][name]`,
      `${linea.servicio} (${linea.tipoCalzado})${variante}`,
    );
  });

  if (transporte > 0) {
    const index = carrito.length;
    params.set(`line_items[${index}][quantity]`, '1');
    params.set(`line_items[${index}][price_data][currency]`, 'eur');
    params.set(`line_items[${index}][price_data][unit_amount]`, String(Math.round(transporte * 100)));
    params.set(`line_items[${index}][price_data][product_data][name]`, 'Envío GLS');
  }

  params.set('metadata[order_id]', orderId);
  params.set('metadata[nombre]', nombre);
  params.set('metadata[direccion]', direccion);
  params.set('metadata[telefono]', telefono);
  params.set('metadata[precio_total]', String(precioTotal));
  params.set('metadata[transporte]', String(transporte));
  params.set('metadata[entrega_tipo]', entrega.tipo);
  params.set('metadata[entrega_nombre]', entrega.nombre);
  return params;
}

export function buildCarritoFromLineItems(session) {
  const items = (session.line_items && session.line_items.data) || [];
  return items
    .filter((item) => item.description !== 'Envío GLS')
    .map((item) => ({
      descripcion: item.description,
      cantidad: item.quantity,
      precioUnitario: item.price.unit_amount / 100,
      precioSubtotal: item.amount_total / 100,
    }));
}

export function orderPayloadFromSession(session) {
  const m = session.metadata || {};
  return {
    orderId: m.order_id,
    carrito: buildCarritoFromLineItems(session),
    transporte: Number(m.transporte || 0),
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
  const response = await fetchFn(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}` },
    },
  );
  if (!response.ok) {
    throw new Error('No se pudo recuperar la sesión de Stripe');
  }
  return response.json();
}
```

- [ ] **Step 4: Run the test again**

Run: `(cd worker && node --test)`
Expected: PASS — all tests in `worker/tests/stripe.test.js` (other worker test files will fail until Task 10 — that's expected at this point).

- [ ] **Step 5: Commit**

```bash
git add worker/src/stripe.js worker/tests/stripe.test.js
git commit -m "feat(worker): send one Stripe line_item per cart line, rebuild cart via expand"
```

---

### Task 9: `worker/src/index.js` — use the renamed reconstruction function

**Files:**
- Modify: `worker/src/index.js:4-9` (import), `worker/src/index.js:44` (usage)

- [ ] **Step 1: Update the import**

In `worker/src/index.js`, change:

```js
import {
  buildCheckoutSessionParams,
  createStripeSession,
  retrieveStripeSession,
  parseSessionPaymentStatus,
  orderPayloadFromSessionMetadata,
} from './stripe.js';
```

to:

```js
import {
  buildCheckoutSessionParams,
  createStripeSession,
  retrieveStripeSession,
  parseSessionPaymentStatus,
  orderPayloadFromSession,
} from './stripe.js';
```

- [ ] **Step 2: Update the call site in `handleConfirmPayment`**

Change:

```js
  const orderPayload = orderPayloadFromSessionMetadata(session);
```

to:

```js
  const orderPayload = orderPayloadFromSession(session);
```

- [ ] **Step 3: Run the worker test suite**

Run: `(cd worker && node --test)`
Expected: `worker/tests/stripe.test.js` still PASS (unaffected by this file); `worker/tests/resend.test.js`/`cors.test.js` results unchanged from before this task (resend tests still fail until Task 10 — `index.js` itself has no dedicated test file, it's exercised indirectly through the manual QA in Task 11).

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.js
git commit -m "refactor(worker): use renamed orderPayloadFromSession in confirm-payment"
```

---

### Task 10: `worker/src/resend.js` — cart-aware emails

**Files:**
- Modify: `worker/src/resend.js`
- Modify: `worker/tests/resend.test.js`

- [ ] **Step 1: Rewrite `worker/tests/resend.test.js`**

Replace the entire file with:

```js
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
      grosor: '4',
      cantidad: 2,
      precioUnitario: 35,
      precioSubtotal: 70,
    },
  ],
  transporte: 6,
  precioTotal: 76,
  nombre: 'Ana Pérez',
  direccion: 'Carrer Major 1',
  telefono: '+34612345678',
  email: 'ana@example.com',
  entrega: { tipo: 'gls', nombre: 'Punt GLS Centre' },
  metodoPago: 'bizum',
};

test('buildOwnerEmail va dirigido al propietario e incluye el carrito y el envío', () => {
  const email = buildOwnerEmail(orderPayload, 'owner@example.com');
  assert.deepEqual(email.to, ['owner@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /Ana Pérez/);
  assert.match(email.html, /pie_de_gato · resolado_completo \(vibram_xs_grip2, 4mm\) ×2 — 70\.00€/);
  assert.match(email.html, /Envío GLS: 6\.00€/);
  assert.match(email.html, /76\.00€/);
  assert.match(email.html, /Punt GLS Centre/);
});

test('buildCustomerEmail va dirigido al comprador y confirma la recepción', () => {
  const email = buildCustomerEmail(orderPayload, 'ana@example.com');
  assert.deepEqual(email.to, ['ana@example.com']);
  assert.match(email.subject, /GLS-1/);
  assert.match(email.html, /pie_de_gato · resolado_completo/);
  assert.match(email.html, /Punt GLS Centre/);
});

test('buildOwnerEmail omite la línea de envío cuando el transporte es 0', () => {
  const email = buildOwnerEmail({ ...orderPayload, transporte: 0 }, 'owner@example.com');
  assert.doesNotMatch(email.html, /Envío GLS/);
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
    direccion: '"><img src=x>',
    email: 'test<script>@example.com',
  };
  const email = buildOwnerEmail(maliciousPayload, 'owner@example.com');
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
  const email = buildOwnerEmail(payload, 'owner@example.com');
  assert(!email.html.includes('<script>'));
  assert(email.html.includes('&lt;script&gt;'));
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `(cd worker && node --test)`
Expected: FAIL on `resend.test.js` — `buildOwnerEmail`/`buildCustomerEmail` still read `orderPayload.tipoCalzado`/`servicio`/`cantidad` directly.

- [ ] **Step 3: Rewrite `worker/src/resend.js`**

```js
const FROM_ADDRESS = 'Grip La Seu <onboarding@resend.dev>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function entregaTexto(entrega) {
  return entrega.tipo === 'gls'
    ? `Punto GLS: ${entrega.nombre}`
    : `Tienda asociada: ${entrega.nombre}`;
}

function formatearLineaCarrito(linea) {
  const subtotal = linea.precioSubtotal.toFixed(2);
  if (linea.descripcion) {
    return `${escapeHtml(linea.descripcion)} ×${linea.cantidad} — ${subtotal}€`;
  }
  const variante = linea.material ? ` (${linea.material}, ${linea.grosor}mm)` : '';
  return `${linea.tipoCalzado} · ${linea.servicio}${variante} ×${linea.cantidad} — ${subtotal}€`;
}

function lineasCarritoHtml(orderPayload) {
  const lineas = orderPayload.carrito.map((linea) => `<li>${formatearLineaCarrito(linea)}</li>`);
  if (orderPayload.transporte > 0) {
    lineas.push(`<li>Envío GLS: ${orderPayload.transporte.toFixed(2)}€</li>`);
  }
  return lineas.join('\n');
}

export function buildOwnerEmail(orderPayload, ownerEmail) {
  const { orderId, precioTotal, nombre, direccion, telefono, email, entrega, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [ownerEmail],
    subject: `Nuevo pedido ${orderId}`,
    html: `
      <h2>Nuevo pedido ${orderId}</h2>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
        <li>Precio total: ${precioTotal.toFixed(2)}€</li>
        <li>Nombre: ${escapeHtml(nombre)}</li>
        <li>Dirección: ${escapeHtml(direccion)}</li>
        <li>Teléfono: ${telefono}</li>
        <li>Email: ${escapeHtml(email)}</li>
        <li>Entrega: ${entregaTexto(entrega)}</li>
        <li>Pago: ${metodoPago}</li>
      </ul>
    `,
  };
}

export function buildCustomerEmail(orderPayload, customerEmailAddress) {
  const { orderId, precioTotal, entrega, metodoPago } = orderPayload;

  return {
    from: FROM_ADDRESS,
    to: [customerEmailAddress],
    subject: `Hemos recibido tu pedido ${orderId} — Grip La Seu`,
    html: `
      <h2>¡Gracias por tu pedido!</h2>
      <p>Referencia: <strong>${orderId}</strong></p>
      <ul>
        ${lineasCarritoHtml(orderPayload)}
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

- [ ] **Step 4: Run the full worker test suite**

Run: `(cd worker && node --test)`
Expected: PASS — all tests across `worker/tests/cors.test.js`, `worker/tests/stripe.test.js`, `worker/tests/resend.test.js`.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resend.js worker/tests/resend.test.js
git commit -m "feat(worker): build owner/customer emails from the cart and shipping line"
```

---

### Task 11: Full test suite + manual end-to-end QA

**Files:** none created — verification only.

- [ ] **Step 1: Run the full root test suite**

Run: `node --test`
Expected: PASS — all tests in `tests/` (pricing, data, order, i18n, geo, geocode, validation, api).

- [ ] **Step 2: Run the full worker test suite**

Run: `(cd worker && node --test)`
Expected: PASS — all tests in `worker/tests/` (cors, stripe, resend).

- [ ] **Step 3: Launch the site locally and walk through the cart**

Use the `run` skill (or `npx serve .` from the repo root) to serve the site, then in a browser:

1. Open the order modal and confirm **Pie de gato** is preselected.
2. Set Resolado completo to Cocida / 5 mm and click "Añadir" — a cart line appears with `Pie de gato · Resolado completo — Cocida · 5 mm ×1`.
3. Click "+" on Puntera twice — the puntera stepper shows `2` and a matching cart line appears.
4. Switch the tipo toggle to **Bota**, add a Media suela line — confirm the two Pie de gato lines from before are still listed in the cart summary (not cleared by switching tipo).
5. In the cart summary, use `+`/`−` on the Resolado completo line and confirm its subtotal and the running total update; click the `✕` on a line and confirm it disappears and the total updates.
6. Proceed to step 2, fill in the contact fields, choose **Punt GLS** — confirm the price line updates to include the shipping surcharge; switch to **Tienda asociada** — confirm the shipping line disappears from the total.
7. Proceed to step 3 and submit with **Bizum** — confirm the success screen lists every cart line plus (if GLS was chosen) the shipping line and the correct total.

Expected: every step above matches the description. If anything diverges, fix it before closing out the plan (this is exploratory verification, not a scripted assertion — use judgment).

- [ ] **Step 4: No commit needed for this task** — it's verification only. If Step 3 uncovers a bug, fix it in the relevant file from Tasks 6–10 and commit that fix separately with a message describing the bug found during manual QA.

---

## Notes

- **Out of scope** (per the spec): real GLS point data in `js/puntos-gls.js`, and real prices for suela/transport (both stay as `0`/placeholder `PENDIENTE` values until the owner provides them — same convention already used elsewhere in this codebase).
- `calculatePrice` (the old flat-price function) is removed entirely in Task 2, not deprecated — it can't work correctly against the new nested `PRECIOS` shape, so keeping it would be a silent bug rather than a useful fallback.
