# Carrito de pedido con variantes de suela y transporte — Design Spec

**Fecha:** 2026-08-19
**Estado:** Aprobado, pendiente de plan de implementación

## Contexto

El formulario de pedido actual (paso 1 del modal `orderForm`) solo permite **un** combo por
pedido: un tipo de calzado (`bota` | `pie_de_gato`), un servicio (`resolado_completo` |
`media_suela` | `puntera`) y una cantidad. Esta selección es excluyente — elegir otro tipo de
calzado o servicio sustituye la elección anterior en vez de sumarse.

Se pidió rediseñar esto como un carrito: el cliente debe poder acumular varias combinaciones
distintas (p.ej. 2 pares de pie de gato con resolado completo + 1 bota con media suela) en un
mismo pedido. Además, los servicios de suela (`resolado_completo`, `media_suela`) necesitan una
selección de **material** y **grosor**, cada combinación con su propio precio. Y el pedido debe
poder incluir un coste de **transporte** cuando el cliente elige envío por GLS.

Este spec cubre exclusivamente ese rediseño. **Fuera de alcance**: sustituir los puntos GLS
placeholder (`js/puntos-gls.js`) por una lista real — es un dato pendiente independiente que se
resuelve en otra conversación; el mecanismo de geocodificar la dirección del cliente y filtrar
los puntos más cercanos ya existe (`js/geo.js`, `js/geocode.js`) y funciona igual sobre datos
reales que sobre los placeholder actuales.

## Modelo de precios (`js/precios.js`)

Los servicios con suela (`resolado_completo`, `media_suela`) pasan de un precio plano a un precio
por combinación de material × grosor. `puntera` no tiene variantes y queda como precio plano,
igual que hoy.

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

Los valores en `0` son placeholder — el propietario los facilitará más adelante, igual que ya
está marcado el resto del archivo.

## `js/pricing.js`

Se añade una función que resuelve tanto el caso plano (puntera) como el anidado
(material/grosor):

```js
export function calculateLinePrice(precios, tipoCalzado, servicio, material, grosor, cantidad) {
  // material y grosor son null para 'puntera'.
  // Lanza error si tipoCalzado/servicio/material/grosor es desconocido,
  // o si cantidad no es un entero >= 1 — mismo criterio que calculatePrice hoy.
}
```

`calculatePrice` (la función actual, precio plano) se mantiene si sigue teniendo uso interno,
o se elimina si `calculateLinePrice` la vuelve redundante — se decide durante la implementación
según quede el código más simple.

## Carrito en el frontend (`js/app.js`)

El estado del paso 1 pasa de campos únicos a un array `carrito`. Cada línea:

```js
{
  tipoCalzado: 'pie_de_gato' | 'bota',
  servicio: 'resolado_completo' | 'media_suela' | 'puntera',
  material: 'vibram_xs_grip2' | 'cocida' | null,  // null solo si servicio === 'puntera'
  grosor: '3.5' | '4' | '4.5' | '5' | null,        // null solo si servicio === 'puntera'
  cantidad: number,       // entero >= 1
  precioUnitario: number,
  precioSubtotal: number, // precioUnitario * cantidad
}
```

### UI del paso 1

- **Tipo de calzado**: toggle "Pie de gato" / "Bota" arriba del todo. **Pie de gato** viene
  preseleccionado. Cambiar de tipo solo cambia qué tarjetas de servicio se muestran para
  configurar — no vacía ni afecta las líneas ya añadidas al carrito de otro tipo.
- **Puntera**: tarjeta con nombre, precio y `+`/`−` directo (sin material/grosor). Cada clic en
  `+` añade (o incrementa) la línea `{tipoCalzado actual, puntera, null, null}` en el carrito;
  `−` la decrementa y la quita si llega a 0.
- **Resolado completo / Media suela**: tarjeta con nombre, dos `<select>` (material, grosor) y
  un precio que se actualiza según la combinación elegida, más un botón "Añadir" que empuja esa
  línea concreta al carrito con cantidad 1.
- **Líneas duplicadas**: si ya existe una línea con el mismo
  `tipoCalzado`+`servicio`+`material`+`grosor`, se suma la cantidad en esa línea en vez de crear
  una nueva.
- **Resumen del carrito** (debajo de las tarjetas): lista todas las líneas de ambos tipos de
  calzado, cada una con su propio `+`/`−` de cantidad y botón de quitar. Muestra el material y
  grosor entre paréntesis cuando aplica.
- **Total**: suma de `precioSubtotal` de todas las líneas. Se muestra en el paso 1 (sin
  transporte todavía, porque el tipo de entrega no se ha elegido).
- **Validación**: `canProceedStep1` pasa de `tipoCalzado && servicio` a `carrito.length > 0` con
  todas las cantidades ≥ 1. Si se quita la última línea, el botón "Siguiente" se vuelve a
  deshabilitar.

### Transporte GLS (paso 2)

- Al elegir **"Envío GLS"** como tipo de entrega, aparece una línea
  `+ Envío GLS: PRECIO_TRANSPORTE_GLS €` y el total mostrado se actualiza para incluirla.
- Al elegir **"Tienda asociada"**, no se añade ningún coste de transporte.
- Si el cliente cambia de GLS a tienda (o viceversa) después de elegir, el total se recalcula en
  el momento.
- El total final (carrito + transporte si aplica) es el que se envía a Stripe / `notify-order`,
  igual que hoy pero con el nuevo cálculo.

## Backend — Stripe (`worker/src/stripe.js`)

`buildCheckoutSessionParams` deja de generar un único `line_items[0]` y genera **un `line_item`
por línea del carrito**, más **uno adicional para "Envío GLS" si `entrega.tipo === 'gls'`**. Así
Stripe también desglosa el pedido en su propia pantalla de pago.

Los metadatos de Stripe (`metadata[...]`) tienen un límite de 500 caracteres por valor, así que
**no** se serializa el carrito completo como JSON en un campo. En su lugar:

- `metadata` guarda solo lo esencial a nivel de pedido: `order_id`, `nombre`, `direccion`,
  `telefono`, `entrega_tipo`, `entrega_nombre`, `precio_total`.
- Al confirmar el pago (`retrieveStripeSession` en `handleConfirmPayment`), se pide la sesión con
  `expand[]=line_items` y el detalle del carrito (qué se pidió, cantidades, precios) se
  reconstruye a partir de esos `line_items` devueltos por Stripe, no de metadata.

Para Bizum/Transferencia/Efectivo (`notify-order`, sin Stripe) esto no aplica — el carrito
completo viaja tal cual en el body del POST (`orderPayload.carrito`), sin límite de tamaño
relevante.

## Resumen del pedido y emails (`js/order.js`, `worker/src/resend.js`)

`buildOrderSummary` recorre el array de líneas del carrito en vez de asumir un único combo, y
añade la línea de transporte si aplica:

```
Referencia: GLS-...
— Pie de gato · Resolado completo (Vibram XS Grip2, 4mm) ×2 — 70€
— Bota · Media suela (Cocida, 5mm) ×1 — 22€
— Puntera · Pie de gato ×1 — 12€
Envío GLS: 6€
Total: 110€
Nombre: ...
Dirección: ...
Teléfono: ...
Email: ...
Entrega: ...
Pago: ...
```

Esto alimenta tanto los emails (propietario y cliente, vía Resend) como la pantalla de éxito del
modal (`summaryLines`), que ya itera línea por línea — solo cambia qué líneas se generan.

## i18n (`js/i18n.js`)

Nuevas claves en ca/es/en para: etiquetas de los `<select>` de material y grosor, nombre de
"Cocida" (Vibram XS Grip2 no se traduce), botón "Añadir", encabezado del resumen del carrito,
"Envío GLS". Se mantiene la simetría de claves entre los tres idiomas (ya cubierta por el test
existente en `tests/i18n.test.js`).

## Portada (`index.html`)

La sección "Nuestros serveis" muestra hoy `Desde X€` leyendo `precios[tipo][servicio]`
directamente. Con la nueva estructura anidada para `resolado_completo`/`media_suela`, ese cálculo
pasa a ser el mínimo entre las 8 combinaciones (2 materiales × 4 grosores) para ambos tipos de
calzado. `puntera` no cambia (sigue siendo precio plano).

## Plan de pruebas

- `tests/pricing.test.js`: `calculateLinePrice` con puntera (precio plano) y con
  resolado/media suela (material+grosor); casos de error con material/grosor/tipo/servicio
  desconocido.
- `tests/order.test.js`: `buildOrderSummary` con carrito de varias líneas + envío GLS, y sin
  envío (entrega en tienda).
- `tests/data.test.js`: valida que `PRECIOS` tenga la forma nueva completa (las 8 combinaciones
  material×grosor presentes para `resolado_completo` y `media_suela`, en `bota` y
  `pie_de_gato`) y que `PRECIO_TRANSPORTE_GLS` sea un número.
- `worker/tests/stripe.test.js`: `buildCheckoutSessionParams` genera un `line_item` por línea de
  carrito + uno de envío cuando aplica; reconstrucción del carrito vía `expand[]=line_items` en
  `retrieveStripeSession`/`handleConfirmPayment`.
- `worker/tests/resend.test.js`: emails con carrito multi-línea y con/sin envío.
- `tests/geo.test.js`, `tests/geocode.test.js`, `tests/i18n.test.js`, `tests/validation.test.js`,
  `tests/api.test.js`: sin cambios de fondo esperados; se tocan solo si alguna función exportada
  cambia de forma (p.ej. si `canProceedStep1` se extrae a una función testeable en
  `validation.js`, que se decide durante la implementación).

## Fuera de alcance

- Lista real de puntos GLS (`js/puntos-gls.js` sigue con placeholder). El filtrado por
  proximidad a la dirección del cliente ya existe y funcionará igual sobre datos reales.
- Tarifas reales de suela y de transporte GLS — quedan como placeholder (`0`) hasta que el
  propietario las facilite.
