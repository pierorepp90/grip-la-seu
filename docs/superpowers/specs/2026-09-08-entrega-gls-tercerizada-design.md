# Entrega tercerizada con GLS — Design Spec

**Fecha:** 2026-09-08
**Estado:** Aprobado, pendiente de plan de implementación

## Contexto

Hoy el paso 2 del formulario de pedido ofrece dos formas de hacernos llegar el calzado: elegir un
**punto GLS cercano** (lista mantenida a mano en `js/puntos-gls.js`, ordenada por distancia con
`js/geo.js` tras geocodificar la dirección del cliente con `js/geocode.js`) o dejarlo en una
**tienda asociada** (`js/tiendas.js`, todavía un placeholder). El pago en efectivo solo está
permitido con entrega en tienda.

El propietario ha decidido tercerizar la entrega por completo a GLS a través de su portal de
devoluciones, `https://returns.gls-group.com/climberup/create-return`. La lista de puntos cercanos
deja de tener sentido: GLS asigna el punto. La petición original era "autocompletar el link con
los datos obtenidos previamente".

## Hallazgo que condiciona el diseño

**El portal no admite autocompletado por URL.** El portal es una SPA de Angular. En el código de
la pantalla `create-return` (`chunk-2AWIEVMJ.js`) no hay ninguna lectura de `queryParamMap`,
`URLSearchParams` ni `snapshot`; las rutas declaradas son `:portalId`, `create-return` y
`create-return/summary`, sin parámetros de datos. Se verificó además empíricamente: al cargar la
URL con parámetros los ocho campos siguen vacíos. No es cuestión de acertar los nombres — la
página no lee nada de la URL.

**Pero la API del portal sí es invocable.** El propio portal habla con:

```
POST https://api.gls-group.net/order-management/shop-returns/portal/v3/{portalName}/return-orders
  Authorization: <clave de cliente del portal>
  X-Portal-Token: <token del portal>
  X-Portal-Name: climberup
```

con este cuerpo:

```json
{
  "originalOrderReference": "GLS-20260908120000-A1B2",
  "returnReason": "Sin motivo específico",
  "options": {
    "confirmationMail": { "sendTo": ["cliente@example.com"] },
    "languageCode": "es"
  },
  "sender": {
    "personName": "Nombre Apellidos",
    "email": "cliente@example.com",
    "address": {
      "street": "Carrer Major 12",
      "city": "La Seu d'Urgell",
      "zipCode": "25700",
      "countryCode": "ES"
    }
  }
}
```

La respuesta trae `returnOrderId` y `dropOffLocations.data[]` (los puntos de entrega que asigna
GLS). Con `options.confirmationMail.sendTo`, **GLS envía él mismo al cliente el email con la
etiqueta y el QR de parcel shop**, así que no hace falta descargar el PDF ni adjuntarlo. Existen
además `GET /return-orders/{id}/label/pdf` y `GET /return-orders/{id}/parcelshop-qrcode/pdf`, que
este diseño no usa.

Configuración del portal `climberup` (`/return-portals/climberup/config.json`): marca
`CLIMBER UP`, países activos `["ES","PT"]`, un único motivo de devolución
(`Sin motivo específico`), `preventConfirmationMail: false`.

**Riesgo asumido conscientemente:** es la API interna del portal, no una API publicada para
integradores, y las credenciales son las que el portal expone en su frontend público. Puede
cambiar sin aviso y su uso programático no está explícitamente autorizado. De ahí el fallback
manual (ver "Enfoque"). En paralelo conviene pedir a GLS acceso al ShopReturnService API oficial,
que sí está documentado, y migrar a él cuando esté disponible.

### Límites de campo de GLS

Extraídos de los validadores del portal. El formulario los aplica y
`buildReturnOrderRequest` los vuelve a aplicar por si el frontend se relaja:

| Campo | Máximo |
|---|---|
| `originalOrderReference` | 50 |
| `personName` (nombre + apellidos) | 40 |
| `email` | 255 |
| calle | 40 |
| número | 6 |
| código postal | 10 |
| ciudad | 40 |

`sender.address.street` se envía como `"{calle} {número}"`.

### Idiomas

El mapa de idiomas de GLS incluye `es`, `en` y `pt`, pero **no `ca`**. La web arranca en catalán
por defecto, así que `ca` se mapea a `es`.

### Andorra

`activatedCountries` es `["ES","PT"]`, y **esto no es una limitación de configuración del portal**:
Andorra no figura en la lista de países del ShopReturnService de GLS. Los dos países no
comunitarios que sí figuran —Reino Unido y Suiza— están marcados como "solución nacional", es
decir, devoluciones dentro del propio país, no transfronterizas. El motivo es la aduana: una
etiqueta de devolución no lleva documentación aduanera, y Andorra está fuera de la unión aduanera
y del IVA europeo. Un envío desde Andorra sería exportación temporal para reparación, con
reimportación a la vuelta.

**Decisión del propietario (2026-09-08): Andorra queda descartada, no se pregunta a GLS.** Aunque
existiera una vía, cada par cruzaría la aduana dos veces —salida para reparación y vuelta— por un
servicio de 44€. El papeleo y el coste no lo justifican. No se añade ni aviso ni vía alternativa
en la web para clientes andorranos; el selector de país queda en `ES` / `PT` y nadie debería
reabrir esto sin que cambien las condiciones aduaneras.

## Enfoque: API con fallback manual

El Worker intenta crear la devolución por API al confirmar el pedido.

- **Si funciona (modo A):** GLS envía al cliente su email con la etiqueta. Nuestro email de
  confirmación añade la referencia de la devolución y el punto de entrega asignado. El cliente no
  ve el portal en ningún momento.
- **Si falla (modo B):** nuestro email de confirmación incluye el enlace al portal y el bloque con
  los datos exactos que tiene que pegar. El pedido se confirma igual.

**Regla dura: un fallo de GLS nunca tumba el pedido.** La llamada va envuelta en `try/catch` y
devuelve `{ ok: false, error }` en vez de lanzar, con un `AbortController` de 10 segundos para que
una API colgada no deje el pedido en el aire.

## Frontend

### Precios y transporte (`js/precios.js`, `js/pricing.js`)

Todos los pedidos van por GLS, así que el transporte deja de depender de la elección de entrega y
pasa a depender del importe:

```js
export const PRECIO_TRANSPORTE_GLS = 5;
export const ENVIO_GRATIS_DESDE = 150;
```

Nueva función pura en `pricing.js`:

```js
calcularTransporte(totalCarrito, precioTransporte, umbralGratis)
```

Devuelve `0` si `totalCarrito >= umbralGratis`, y `precioTransporte` en caso contrario. **El umbral
se compara contra el subtotal de servicios, no contra el total con envío**, para evitar la
circularidad de un pedido de 148€ que al sumarle el envío superaría el umbral.

El carrito muestra la línea "Envío GLS 5,00€" o "Envío gratis", y un aviso de cuánto falta para el
envío gratis cuando el pedido está por debajo del umbral.

En `orderForm`, el getter `incluyeTransporte` (hoy `entregaTipo === 'gls'`) desaparece; `precioTotal`
pasa a usar `calcularTransporte`.

### Paso 2 — datos y dirección (`index.html`, `js/app.js`)

Desaparece por completo la elección de entrega. El paso queda:

| Campo | Estado en `orderForm` | Validación |
|---|---|---|
| Nombre y apellidos | `nombre` | no vacío, máx. 40 |
| Email | `email` | `isValidEmail`, máx. 255 |
| Teléfono | `telefono` | `isValidPhone(telefono, pais)` |
| Calle | `calle` | no vacío, máx. 40 |
| Número | `numero` | no vacío, máx. 6 |
| Código postal | `codigoPostal` | `isValidPostalCode(cp, pais)` |
| Ciudad | `ciudad` | no vacío, máx. 40 |
| País | `pais` | selector `ES` / `PT`, por defecto `ES` |

El teléfono no lo usa GLS; lo seguimos pidiendo para poder contactar al cliente.

`canProceedStep2` se reescribe sobre estos campos.

**Se eliminan** (con sus tests): `js/puntos-gls.js`, `js/tiendas.js`, `js/geo.js`, `js/geocode.js`,
`tests/geo.test.js`, `tests/geocode.test.js`. Y del estado de `orderForm`: `entregaTipo`,
`entregaNombre`, `puntosCercanos`, `tiendas`, `geocodeError` y el método `buscarPuntosGLS()`.

### Validación (`js/validation.js`)

- Nueva `isValidPostalCode(cp, pais)`: `ES` → 5 dígitos; `PT` → `NNNN` o `NNNN-NNN`.
- `isValidSpanishPhone` se sustituye por `isValidPhone(telefono, pais)`. La actual rechaza los
  móviles portugueses, lo que haría el formulario inrellenable desde Portugal. `ES` mantiene la
  regla actual; `PT` acepta 9 dígitos empezando por 9, con `+351` opcional.

### Paso 3 — pago (`index.html`, `js/app.js`, `js/i18n.js`)

Se elimina la opción **Efectivo**, que solo tenía sentido con entrega en tienda, junto con el aviso
`pago_efectivo_solo_tienda`. Quedan Bizum, transferencia y tarjeta.

### Payload del pedido (`js/app.js`)

`buildOrderPayload()` sustituye `direccion` y `entrega: { tipo, nombre }` por:

```js
direccion: { calle, numero, codigoPostal, ciudad, pais },
lang: Alpine.store('i18n').lang,
```

`lang` es nuevo: hace falta para el `languageCode` de GLS.

### Pantalla de éxito (`index.html`, `js/gracias.js`)

Recibe el bloque `gls` de la respuesta del Worker y pinta:

- **Modo A:** "GLS te ha enviado un email con tu etiqueta", `returnOrderId` y punto de entrega.
- **Modo B:** enlace a `GLS_PORTAL_URL` y el bloque de datos para copiar.

### Textos (`js/i18n.js`)

Se retiran las claves de entrega y puntos (`entrega_label`, `entrega_gls`, `entrega_tienda`,
`puntos_cercanos_title`, `puntos_geocode_error`, `pago_efectivo`, `pago_efectivo_solo_tienda`) en
los cuatro idiomas, y se añaden las de dirección desglosada, envío gratis y los dos modos de
resultado GLS.

## Worker

### Nuevo módulo `worker/src/gls.js`

Sigue la separación puro / HTTP que ya usan `stripe.js` y `resend.js`:

```js
buildReturnOrderRequest(orderPayload, env)   // puro → el JSON de GLS, con truncados y mapeo de idioma
parseReturnOrderResponse(json)               // puro → { returnOrderId, dropOffLocation }
createReturnOrder(request, env, fetchFn)     // HTTP, con AbortController de 10s
```

`parseReturnOrderResponse` toma `dropOffLocations.data[0]` cuando existe y `null` si no.

### Configuración (`worker/wrangler.toml`)

En `[vars]`:

```toml
GLS_API_BASE = "https://api.gls-group.net/order-management/shop-returns/portal/v3"
GLS_PORTAL_NAME = "climberup"
GLS_RETURN_REASON = "Sin motivo específico"
GLS_PORTAL_URL = "https://returns.gls-group.com/climberup/create-return"
```

Como secretos (`wrangler secret put`): `GLS_PORTAL_TOKEN` y `GLS_CLIENT_KEY`. Son credenciales de
la cuenta del propietario; fuera del repo, y rotarlas es un comando en vez de un commit.

### Orquestación (`worker/src/index.js`)

```js
async function resolveGlsReturn(orderPayload, env)
```

Envuelve `buildReturnOrderRequest` + `createReturnOrder` + `parseReturnOrderResponse` en
`try/catch` y devuelve `{ ok: true, returnOrderId, dropOffLocation }` o `{ ok: false, error }`.
Nunca lanza.

La llaman `handleNotifyOrder` y `handleConfirmPayment` antes de construir los emails, y le pasan el
resultado a `buildOwnerEmail` y `buildCustomerEmail`. Ambos endpoints devuelven el bloque `gls` en
su respuesta JSON para que la pantalla de éxito elija modo A o B.

### Deduplicación con Workers KV

Hoy `index.js` documenta que recargar `gracias.html` reenvía ambos emails. Con este cambio esa
recarga crearía **una segunda devolución GLS real**, con su etiqueta y su coste. Eso deja de ser
una molestia aceptable, así que se añade Workers KV — el mismo criterio del comentario existente,
que reservaba KV para cuando el propietario lo pidiera explícitamente.

- Binding `PEDIDOS` en `wrangler.toml`.
- Claves: `session:<sessionId>` en `handleConfirmPayment`, `order:<orderId>` en `handleNotifyOrder`.
- Valor: `{ returnOrderId, dropOffLocation, processedAt }` en JSON, con `expirationTtl` de 90 días.
- Ambos handlers leen antes de actuar: si la clave existe, devuelven el resultado guardado sin
  crear la devolución ni reenviar emails. Si no, procesan y escriben.

Esto resuelve de paso el reenvío de emails duplicados que ya existía.

### Emails (`worker/src/resend.js`)

`entregaTexto(entrega)` se sustituye por `direccionTexto(direccion)`, que renderiza la dirección
desglosada.

**Email al cliente**, según el modo:

- **A:** "GLS te ha enviado tu etiqueta por email", referencia de la devolución y punto de entrega
  asignado.
- **B:** enlace al portal y el bloque de datos exactos a pegar (referencia de pedido, motivo,
  nombre, email, calle, número, CP, ciudad, país).

**Email al propietario:** siempre los datos completos, más una línea final que es la red de
seguridad operativa — `Devolución GLS: <returnOrderId>`, o
`⚠️ No se pudo crear la devolución automáticamente — el cliente ha recibido instrucciones manuales`.
Así el propietario se entera en el momento, no cuando escriba el cliente.

### Resumen del pedido (`js/order.js`)

`buildOrderSummary` sustituye la línea `Entrega:` por las líneas de dirección desglosada, y añade
la referencia de la devolución GLS cuando existe.

### Stripe (`worker/src/stripe.js`)

Los metadatos `direccion`, `entrega_tipo` y `entrega_nombre` se sustituyen por `calle`, `numero`,
`cp`, `ciudad`, `pais` y `lang`. `orderPayloadFromSession` los reconstruye en la misma forma que
produce `buildOrderPayload()` en el frontend, para que ambos caminos de pago alimenten a
`resolveGlsReturn` con la misma estructura.

## Tests

Con `node --test`, siguiendo el patrón existente de inyectar `fetchFn`.

**Nuevos** (`worker/tests/gls.test.js`): construcción del payload; truncado de cada campo al límite
de GLS; concatenación de `street`; mapeo de idioma incluido `ca → es`; parseo de respuesta con y
sin `dropOffLocations`; `createReturnOrder` con `fetchFn` falso que devuelve error HTTP.

**Nuevos** (`tests/pricing.test.js`): `calcularTransporte` en los tres casos — por debajo del
umbral, justo en el umbral, por encima.

**Nuevos** (`tests/validation.test.js`): `isValidPostalCode` para ES y PT, válidos e inválidos;
`isValidPhone` para móviles españoles y portugueses.

**Modificados:** `tests/order.test.js` y `worker/tests/resend.test.js` para la dirección desglosada
y las dos ramas de email; `worker/tests/stripe.test.js` para los metadatos nuevos.
`tests/data.test.js` importa hoy `puntos-gls.js` y `tiendas.js`, que se borran: se le retiran esos
dos casos y se le añade una comprobación de que `ENVIO_GRATIS_DESDE` es un número.

**Eliminados:** `tests/geo.test.js` y `tests/geocode.test.js`.

## Validación manual

Crear una devolución de prueba requiere un `POST` real que **genera una devolución de verdad en la
cuenta GLS del propietario**. No se hace sin su permiso explícito, y después hay que anularla desde
el panel de GLS.

## Fuera de alcance

- Migrar al ShopReturnService API oficial de GLS (requiere gestión previa con GLS).
- Andorra, en cualquier forma: descartada por aduanas (ver "Andorra").
- El envío de vuelta (taller → cliente). El portal de devoluciones solo cubre el trayecto de ida.
- Descargar y adjuntar el PDF de la etiqueta: innecesario, GLS lo envía con
  `options.confirmationMail`.
