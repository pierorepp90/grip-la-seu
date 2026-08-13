# Grip La Seu — Web de pedidos de resolado (coste 0)

## Contexto

Grip La Seu es un negocio de resolado de calzado de escalada (botas y "pies de gato")
en La Seu d'Urgell (Pirineus). Se necesita una web que sirva como escaparate y que
permita a un cliente coordinar la recogida/entrega de su calzado para resolarlo,
calculando el precio, eligiendo cómo hacer llegar el calzado al taller y pagando,
todo con coste de infraestructura 0.

## Restricción técnica clave

GitHub Pages solo sirve contenido estático: no puede ejecutar código de servidor.
Tres funcionalidades sí lo requieren (claves secretas que no pueden vivir en el
navegador):

- Crear una sesión de pago con Stripe.
- Enviar emails transaccionales con Resend.
- (Opcional, futuro) Resolución de puntos GLS vía API oficial.

**Decisión**: frontend estático en GitHub Pages + backend mínimo gratuito en
Cloudflare Workers que expone únicamente los endpoints que necesitan una clave
secreta. Todo lo demás vive en el cliente. Ni Stripe ni Resend ni Cloudflare
Workers tienen coste fijo en el uso previsto (Resend: 3000 emails/mes gratis;
Stripe cobra % solo sobre cobros reales; Workers free tier).

## Arquitectura

- **Frontend**: HTML/CSS/JS vanilla, sin build step. Se despliega directamente a
  GitHub Pages (rama del repo, sin GitHub Actions). Se usa Alpine.js vía CDN
  (un único `<script>`, sin build) para la reactividad del formulario multi-paso
  y el cálculo de precio en vivo.
  - Alternativa descartada: Vite + framework + GitHub Actions. Añade complejidad
    de build/CI innecesaria para un sitio de un solo negocio (YAGNI). Se puede
    migrar más adelante si el sitio crece.
- **Backend**: Cloudflare Workers (capa gratuita), dos endpoints:
  - `POST /api/create-checkout-session`: crea una Stripe Checkout Session y
    devuelve la URL de pago. Solo se llama si el método de pago es tarjeta.
  - `POST /api/notify-order`: envía dos emails vía Resend (propietario y
    comprador) con el resumen del pedido. Se llama directamente al confirmar
    pedido con Bizum/Transferencia/Efectivo, o desde `gracias.html` tras
    verificar que una sesión de Stripe se pagó correctamente.
  - CORS restringido al origen de GitHub Pages.
  - Llamadas a Stripe y Resend vía `fetch` directo a sus APIs REST (sin SDKs,
    para mantener el Worker ligero).
- **Sin base de datos**: no se persisten pedidos en un almacén propio; el email
  al propietario es el registro del pedido. Simplifica el sistema y lo mantiene
  gratuito. Si en el futuro se necesita un panel de pedidos, se puede añadir
  Cloudflare D1 (gratis) sin tocar el frontend.
- **Repos/despliegue**: repo `grip-la-seu` bajo la cuenta `pierorepp90` →
  `https://pierorepp90.github.io/grip-la-seu/`. El Worker se despliega aparte
  con `wrangler` (repo o carpeta separada `worker/`).

## Páginas y navegación

Landing de una sola página: Header + Hero + Servicios + Footer. El CTA
"Coordinar recogida" abre el formulario de 3 pasos como overlay/modal, sin
cambiar de URL, para mantener el contexto y ser rápido en móvil. Página aparte
`gracias.html`, usada solo como `success_url` de Stripe para verificar el pago
y disparar los emails al volver de Stripe Checkout.

## Header

- Logo a la izquierda. Versión limpia recreada del logo (bota + montañas,
  paleta del original) hasta que el propietario proporcione el archivo
  definitivo en PNG/SVG con fondo transparente.
- Selector de idioma CA · ES · EN, cambia todo el texto vía diccionario i18n en
  JS, sin recargar la página.
- Iconos de redes a la derecha: WhatsApp (`wa.me/34669918744`), Instagram
  (placeholder `@griplaseu`, editable), Email (placeholder
  `hola@griplaseu.com`, editable, `mailto:`).
- Header sticky; colapsa a menú hamburguesa en móvil (idioma + redes dentro
  del menú).

## Paleta de colores

Extraída del logo proporcionado (foto de pantalla, tonos aproximados a
refinar durante la implementación sin bloquear en una revisión previa):

- Azul marino oscuro (fondo/base).
- Naranja/ámbar (acento principal, CTAs).
- Blanco hueso (texto sobre fondo oscuro, detalles).
- Gris pizarra derivado del azul (texto secundario, bordes).

## Hero y servicios

Fondo oscuro estilo montaña, titular fuerte, subtítulo breve, CTA principal
"Coordinar recogida" (naranja) y CTA secundario hacia la sección de servicios.
Debajo, 3 tarjetas de servicio (resolado completo / media suela / puntera) con
icono, descripción corta y precio "desde X€" tomado del precio mínimo
configurado.

## Formulario (3 pasos)

### Paso 1 — Calculadora

- Tipo de calzado: toggle Botas / Pies de gato.
- Cantidad: stepper −/cantidad/+ (mínimo 1).
- Servicio: toggle Resolado completo / Media suela / Puntera.
- Precio total en vivo, calculado desde una tabla en `precios.js`
  (tipo × servicio × cantidad) con valores placeholder claramente marcados
  como pendientes de confirmar por el propietario antes de publicar. El
  cliente final no ve la palabra "placeholder"; simplemente ve un precio.
- Botón "Siguiente" deshabilitado hasta completar las 3 selecciones.

### Paso 2 — Datos y entrega

- Campos: nombre, dirección, teléfono, email. Validación básica: campos no
  vacíos, teléfono con formato español, email con formato válido. El email es
  necesario para poder enviarle la confirmación de pedido vía Resend (el
  requisito original no lo mencionaba explícitamente pero es imprescindible
  para cumplir "se envía... al comprador del servicio confirmando la
  recepción del pedido").
- Entrega, dos tarjetas seleccionables (excluyentes):
  - **Punto GLS**: al introducir la dirección se geocodifica gratis con
    Nominatim (OpenStreetMap) y se muestran los 2-3 puntos más cercanos de una
    lista curada en `puntos-gls.js` (placeholder con ubicaciones de ejemplo en
    La Seu d'Urgell/Pirineus, a sustituir por la lista real). Distancia
    calculada en el cliente (fórmula de Haversine), sin llamadas a APIs de
    pago.
  - **Tienda asociada**: lista de tiendas en `tiendas.js` (placeholder, 1-2
    ejemplos editables). Elegir esta opción habilita "Efectivo" como método de
    pago en el paso 3.
- Botones Atrás / Siguiente.

### Paso 3 — Pago

- Métodos: Bizum, Transferencia, Tarjeta (Stripe), Efectivo (solo
  visible/habilitado si en el paso 2 se eligió "Tienda asociada").
- Bizum / Transferencia: instrucciones con datos placeholder (número Bizum /
  IBAN, editables antes de publicar) + botón "Ya lo he enviado, confirmar
  pedido" → llama a `/api/notify-order`.
- Tarjeta: botón "Pagar con tarjeta" → llama a `/api/create-checkout-session`
  → redirige a Stripe Checkout (`success_url` = `gracias.html?session_id=...`,
  `cancel_url` de vuelta al paso de pago).
- Efectivo: botón "Confirmar pedido" → llama directo a `/api/notify-order`
  (se paga al dejar el calzado en tienda).
- Tras confirmar (o volver de Stripe con pago verificado en `gracias.html`),
  pantalla de agradecimiento con resumen del pedido y número de referencia
  generado en el cliente (timestamp + aleatorio).

**Limitación conocida y aceptada para este alcance**: la confirmación de pago
con tarjeta se dispara al volver el usuario a `gracias.html`, no mediante un
webhook de Stripe. Si el usuario cierra la pestaña tras pagar sin llegar a esa
página, el pedido no se notifica automáticamente aunque el cobro se haya
realizado (el propietario debería revisar el panel de Stripe periódicamente
como red de seguridad). Añadir un webhook es una mejora futura, no necesaria
para el MVP.

## Emails (Resend)

- Al propietario: todos los datos del pedido (tipo de calzado, cantidad,
  servicio, precio, nombre, dirección, teléfono, email, entrega elegida,
  método de pago).
- Al comprador: confirmación con resumen del pedido y próximos pasos (a qué
  punto GLS/tienda llevar el calzado, o confirmación de pago con tarjeta
  recibido).
- Remitente: dominio placeholder hasta que el propietario verifique un dominio
  propio en Resend; mientras tanto puede usarse el dominio de pruebas
  `onboarding@resend.dev`.

## Internacionalización

Diccionario i18n en JS (`i18n.js`) con claves para CA/ES/EN. El copy de
marketing y del formulario se redacta en los 3 idiomas, con el catalán como
idioma de referencia (negocio local de La Seu d'Urgell).

## Manejo de errores

- Geocodificación fallida o dirección no reconocida: se muestra la lista
  completa de puntos GLS sin filtrar/ordenar, con aviso de que no se pudo
  geolocalizar y hay que elegir manualmente.
- Fallo al crear la sesión de Stripe o al enviar el email: mensaje de error
  claro con opción de reintentar; los datos del formulario no se pierden
  (permanecen en el estado del cliente).
- No se avanza de paso si faltan campos obligatorios.

## Testing

- Sin backend de test automatizado dado el alcance (sitio de un solo
  negocio). Verificación manual: recorrer el flujo completo en escritorio y
  móvil para cada método de pago y cada tipo de entrega, comprobando que
  ambos emails llegan correctamente vía Resend en modo test.
- El Worker se prueba localmente con `wrangler dev` antes de desplegar.

## Datos pendientes de rellenar por el propietario (placeholders explícitos)

- `precios.js`: tarifas reales por tipo de calzado/servicio.
- `puntos-gls.js`: lista real de puntos GLS recomendados.
- `tiendas.js`: lista real de tiendas asociadas.
- Instagram y email de contacto reales (header/footer).
- Logo definitivo (PNG/SVG, fondo transparente).
- Número Bizum / IBAN reales.
- Claves de Stripe (publishable + secret) y dominio verificado en Resend.
