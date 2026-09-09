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

---

## Qué cambió en la implementación

**Añadido el 2026-09-09, después de implementar y de pasar el primer pedido real por producción.**

Todo lo de arriba se escribió el 8 de septiembre, antes de tocar código y antes de que ninguna
llamada real llegara a GLS. Las decisiones que recoge —tercerizar a GLS, la API del portal con
fallback manual, descartar Andorra, el umbral de envío gratis— siguen siendo las buenas y el
razonamiento que las sostiene sigue valiendo. Lo que ya no describe es el código.

Esta sección dice **qué se hizo distinto y por qué**, para que quien lea el documento sepa de qué
partes desconfiar. Donde las dos se contradigan, manda esta. La cabecera sigue diciendo
"pendiente de plan de implementación" porque eso era el 8 de septiembre; el plan se escribió y
todo lo que sigue está desplegado.

Buena parte de estos cambios no son mejoras de diseño: son cosas que **solo se supieron al llamar
de verdad a la API y al ver un pedido real de un cliente real**. Van marcadas como tales, porque
son las que más le van a servir a quien venga después.

### Lo que enseñó la primera llamada real

**`trackId`, no `returnOrderId`.** El documento dice que la pantalla de éxito y el email enseñan el
`returnOrderId`. La respuesta real trae además `references.trackId` (`"Z79MB8U2"`): el código corto
con el que una persona sigue su envío. El `returnOrderId` es un UUID que solo sirve para hablar con
la API, y enseñárselo al cliente habría sido darle algo que no puede usar en ningún sitio.
`parseReturnOrderResponse` devuelve los dos:

- al **cliente** (pantalla de éxito y email) se le enseña `trackId`;
- al **propietario** se le enseñan los dos —`Referencia: Z79MB8U2 (id b6e39dbf-…)`— porque el UUID
  es lo que necesita para gestionar o anular la devolución desde el panel de GLS;
- si GLS dejara de mandar `references`, `trackId` cae al UUID.

**Hay puntos de entrega que no admiten devoluciones.** El documento da por hecho que el punto que
asigna GLS es un punto donde se puede dejar el paquete. No siempre. A un cliente de Castelldefels
se le asignó `GLS Locker 24/7 MOEVE CASTELLDEFELS`, con `parcelHandlingRestriction`
`{ offersReturnDropOff: 'N', offersPrepaidParcelDropOff: 'N' }`. Le estábamos diciendo que dejara
el paquete en un sitio que se lo iba a rechazar. El propietario confirma que en España los lockers
de GLS solo recogen, nunca admiten devoluciones.

El punto se filtra por **capacidades y no por `type`**: `type` es descriptivo y mañana puede
aparecer un punto que no sea locker y tampoco acepte devoluciones. Nuestra etiqueta es una
devolución ya prepagada, así que hacen falta las dos capacidades con la `'Y'` literal; si el campo
falta, el punto se descarta igual. De un punto rechazado no se pinta ni un dato —ni el nombre—,
solo un aviso y el enlace al buscador público de GLS, que se pinta siempre pase lo que pase.

**Un punto abierto 24/7 llega partido en dos tramos.** GLS lo expresa como `00:00–14:00` y
`14:00–23:59` por día: pintado literalmente son seis líneas casi idénticas de ruido. Un día cuyos
tramos cubren el día entero se colapsa a "24 h" traducido. El filtro de arriba deja fuera casi
todos los lockers, pero una tienda puede declarar esta misma forma.

**El pago con tarjeta nunca había funcionado.** No es de este diseño, pero salió a la luz
validándolo: `retrieveStripeSession` pedía la sesión con `line_items[limit]=100`, un parámetro que
el endpoint de recuperación no acepta, y Stripe respondía 400. Todo pago con tarjeta fallaba al
volver de Stripe; nadie lo había visto porque nadie había completado uno. Además, `gracias.js` daba
el mismo mensaje cuando el pago no se había completado y cuando la comprobación fallaba: a alguien
que **sí** había pagado se le invitaba a pagar otra vez.

**El recibo estaba lleno de nombres de variable.** Un pedido real enseñó al cliente
`resolado_completo (pie_de_gato) (vibram_xs_grip2) ×1 — 44.00€`, y no solo en la página de gracias:
`buildCheckoutSessionParams` lo montaba igual como nombre del producto en la propia pantalla de
pago de Stripe, que es lo que el cliente lee mientras teclea la tarjeta. De ahí sale
`worker/src/catalogo.js`, que el documento no menciona (ver abajo).

### Deduplicación en KV: nada de esto quedó como está escrito

El apartado "Deduplicación con Workers KV" es la parte más desfasada del documento. Sigue siendo
verdad el motivo —un F5 crearía una segunda devolución GLS de verdad, con su etiqueta y su coste—,
pero ni las claves, ni el valor, ni los TTL son los que dice.

| El documento decía | Lo que hay |
|---|---|
| `session:<sessionId>` en `confirm-payment` y `order:<orderId>` en `notify-order`, separadas | Una sola clave, `order:<orderId>`, para las dos rutas de pago |
| Valor `{ returnOrderId, dropOffLocation, processedAt }` | `{ gls, order, processedAt }` |
| `expirationTtl` de 90 días, igual para todo | Tres vidas según lo que se guarde |
| — | Marca de "en curso" y clave `emails:<orderId>` aparte |

**Una clave para las dos rutas.** El `orderId` lo genera el navegador una vez por pedido y
sobrevive a las dos rutas: en bizum viaja en el cuerpo, en tarjeta va y vuelve en
`metadata[order_id]` de Stripe. Con claves separadas, "Pagar con tarjeta" → atrás → confirmar por
bizum eran **dos devoluciones facturables del mismo pedido**. Por eso `/api/confirm-payment` llama
ahora a Stripe **antes** que a KV: el `orderId` solo se conoce después de recuperar la sesión. Se
sigue leyendo también la clave `session:…` que escribía la versión anterior, porque en KV quedan
hasta 90 días de pedidos guardados así y no leerlos duplicaría su devolución al recargar.

**Tres vidas, no una.** Guardar los fallos tan a largo plazo como los éxitos clavaba el pedido en
el modo manual durante 90 días aunque el problema —una clave caducada, un 429— se arreglara diez
minutos después:

- **90 días** un éxito, o un fallo *ambiguo*: timeout, abort, corte de red, 5xx, o un 2xx sin
  `returnOrderId`. GLS pudo crear la devolución y no llegar a contárnoslo, y reintentar eso es
  exactamente como un cliente acaba con dos etiquetas.
- **10 minutos** un fallo *definitivo*: un 4xx, o una petición que ni se pudo construir. Ahí GLS
  contestó antes de hacer nada y no hay nada que duplicar.
- **60 segundos** la marca de "en curso" (el mínimo que admite KV).

La clasificación vive en `clasificarFalloGls` y mira `error.httpStatus`, que `gls.js` cuelga del
error al lanzarlo; sacar el código del texto del mensaje a base de regex se rompe la primera vez
que alguien lo retoca.

**La marca de "en curso" y el estado que el documento no contempla.** La ventana de deduplicación
era la llamada entera a GLS —hasta diez segundos, justo mientras la pantalla dice "Comprobando el
pago…"— y dos peticiones simultáneas fallaban las dos la lectura y creaban dos devoluciones. Ahora
se escribe `{ enCurso: true, startedAt }` **antes** de llamar a GLS, y la segunda petición la ve y
responde `{ enCurso: true }` —con el pago confirmado y el pedido, no un error—. KV no tiene
compare-and-set: esto estrecha la carrera a milisegundos, no la cierra.

Eso obligó a un tercer estado en la pantalla de éxito que el documento no prevé: ni modo A ni modo
B, sino "tu etiqueta se está preparando", con el recibo pintado entero. **No se pinta el modo B**:
pedirle a alguien que cree a mano una etiqueta que ya viene sola es justo como se acaba pagando dos
veces. El navegador sondea (`reintentarMientrasEnCurso` en `js/api.js`, 10 intentos cada 3 s); la
ventana total tiene que ser **menor** que el TTL de la marca, o la última petición ya no la vería y
arrancaría su propia llamada a GLS. Hay un test que vigila esa desigualdad.

**Emails después de responder.** El documento los pone en línea. Van en `ctx.waitUntil`: son
best-effort desde siempre (`allSettled`, fallos registrados), y hacer esperar al cliente dos
llamadas a Resend con el pedido ya cobrado solo alarga la pantalla de espera y con ella la ventana
en la que le da a F5. Se construyen **dentro** de la promesa: construidos fuera, una excepción
síncrona en un builder subía al handler y devolvía un 500 con la devolución ya creada y KV ya
marcado, así que el reintento cortaba por la rama cacheada y nadie recibía email nunca.

**`emails:<orderId>`.** Los emails fallidos se apuntan además en su propia clave con vida de 90
días. En el registro del pedido siguen estando, pero ese registro caduca en diez minutos cuando el
fallo de GLS es definitivo, y que un email no haya salido es la única señal que le queda al
propietario: no puede irse con él.

### El punto de entrega se pinta, y desde un solo módulo

El documento pasa `dropOffLocation` crudo y deja a cada sitio decidir. En la práctica hacían falta
tres cosas iguales en tres sitios —el modal de `index.html`, `js/gracias.js` y el email del
Worker—: formatear el punto, decidir si admite devoluciones y colapsar los días de 24 h. Eso es
`js/punto-gls.js`, con `resolverPunto()` como única decisión de qué pintar y tres respuestas
posibles: el punto, el aviso de que no admite devoluciones, o nada.

El módulo es **puro a propósito** —ni DOM, ni `window`, ni idiomas; la etiqueta de "24 h" entra
como argumento— porque desde el 2026-09-09 lo importa también el Worker. Durante un tiempo
`worker/src/resend.js` mantuvo una copia a mano, con la excusa de que `worker/` se despliega solo y
"no puede importar de `js/`". **Esa excusa era falsa y nadie la había comprobado**: esbuild sigue
los imports relativos sin mirar fronteras de paquete. Verificado con `wrangler deploy --dry-run`,
cuyo bundle trae el módulo una sola vez. Lo que el Worker sí conserva es lo suyo: los nombres de
día en castellano y el HTML escapado del email.

### El paso 2 no es el que describe la tabla

La tabla de campos sigue siendo correcta, pero el documento resume la validación en
"`canProceedStep2` se reescribe sobre estos campos" y eso se quedó corto. Toda la respuesta a un
dato mal escrito era el botón "Siguiente" apagado: quien ponía el teléfono en un formato que no
aceptamos no tenía forma de saber cuál de los siete campos estaba mal, y se iba. Además, los
navegadores sacan los botones desactivados del orden de tabulación, así que con teclado o lector de
pantalla no había nada que pulsar (WCAG 3.3.1).

La validación vive ahora en `js/campos-paso2.js`, un único sitio donde cada campo declara su
validador, el id de su input y la clave del mensaje. De esa lista salen tanto si se puede avanzar
como el mensaje que se ve debajo de cada campo, así que no pueden discrepar. El paso 2 es un
`<form>` (Enter hace lo mismo que "Siguiente"), "Siguiente" ya no se desactiva nunca, y cambiar de
país recalcula el teléfono y el CP, que pueden dejar de ser válidos.

Las reglas de `js/validation.js` no cambiaron **salvo una**: el 2026-09-09 el patrón portugués pasó
de `9\d{8}` a `[29]\d{8}`. Donde el documento dice "`PT` acepta 9 dígitos empezando por 9" se
equivocaba: eso son solo los móviles. Los fijos portugueses también tienen nueve cifras pero
empiezan por 2 —21x Lisboa, 22x Oporto, de 23x a 29x el resto—, así que un cliente portugués con
fijo no podía terminar el formulario.

### El recibo y `worker/src/catalogo.js`

Nada de esto está en el documento. `buildOrderSummary` no devuelve cadenas planas sino **secciones
de filas etiqueta/valor**, y recibe el idioma activo: los tres sitios que pintan el pedido
necesitan las dos columnas por separado para poder maquetarlas, y el email además las necesita en
una tabla con estilos en línea para que Gmail y Outlook las respeten.

- La referencia de la devolución GLS **no** sale del recibo, al contrario de lo que dice el
  documento: se pinta pegada al aviso de la etiqueta y al punto de entrega, que es donde el cliente
  la busca. Cada referencia aparece una sola vez.
- `worker/src/catalogo.js` traduce los identificadores del catálogo a castellano para el Worker,
  que los usa en el nombre del producto en Stripe y en los emails. Está duplicado del equivalente
  traducido de `js/order.js`, pero por un motivo distinto al que se creía: no es que no se pueda
  importar (ver arriba), es que los emails y la pantalla de Stripe son solo en castellano por
  diseño y lo que habría que compartir aquí no es lógica, es diccionario.
- Ninguno de los dos traduce a ciegas: un identificador que no esté en el diccionario se humaniza
  en vez de pintar `service_lo_que_sea_title` en la cara del cliente. `/api/notify-order` no está
  autenticado y acepta cualquier cuerpo.
- `direccionTexto(direccion)` nunca llegó a existir; el email monta la dirección desglosada dentro
  de la sección "Entrega" del recibo.
- En el modo B, `gracias.html` daba solo el enlace al portal mientras el modal de `index.html` daba
  el enlace **y** los nueve datos con su botón de copiar: justo al revés de lo que debería, porque
  el de la tarjeta ya ha pagado. La lista sale ahora de `buildDatosPortal()` y la usan los dos. Sus
  etiquetas van en castellano a propósito: nombran los campos del formulario de GLS.
- El motivo de devolución ya no se escribe a mano en ningún sitio: lo elige el Worker
  (`GLS_RETURN_REASON`) y viaja en `gls.returnReason`. Antes, cambiar la variable dejaba al cliente
  eligiendo otra opción del desplegable sin que nadie se enterara.

### Lo que sigue valiendo

- El hallazgo del portal —que no admite autocompletado por URL, y por qué— y la decisión de llamar
  a su API con fallback manual.
- El riesgo asumido: sigue siendo la API interna del portal, con credenciales de su frontend
  público, y sigue pendiente el ShopReturnService oficial.
- Los límites de campo, el mapeo de idiomas con `ca → es` y el cuerpo de la petición.
- Andorra: descartada por aduanas, y nadie debería reabrirlo sin que cambien las condiciones.
- Los precios, `calcularTransporte` y el umbral comparado contra el subtotal de servicios.
- La regla dura: **un fallo de GLS nunca tumba el pedido**. Es la única línea del documento que
  ninguna de estas revisiones ha tocado.
