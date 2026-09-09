// js/app.js
import { LANGS, t } from './i18n.js';
import { PRECIOS, PRECIO_TRANSPORTE_GLS, ENVIO_GRATIS_DESDE } from './precios.js';
import { calculateLinePrice, minPrecioServicio, calcularTransporte } from './pricing.js';
import { isNonEmpty } from './validation.js';
import {
  CAMPOS_QUE_DEPENDEN_DEL_PAIS,
  claveErrorCampo,
  esPaso2Valido,
  primerCampoInvalido,
} from './campos-paso2.js';
import { generateOrderId, buildOrderSummary, buildDatosPortal } from './order.js';
import { createCheckoutSession, notifyOrderHastaResultado } from './api.js';
import { API_BASE_URL, GLS_PORTAL_URL, GLS_BUSCADOR_URL } from './config.js';
import { resolverPunto } from './punto-gls.js';
import { copiarAlPortapapeles, MS_CONFIRMACION_COPIADO } from './portapapeles.js';

document.addEventListener('alpine:init', () => {
  Alpine.store('i18n', {
    lang: localStorage.getItem('lang') || 'ca',
  });

  Alpine.magic('t', () => (key, params) => t(Alpine.store('i18n').lang, key, params));

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
    summarySections: [],

    // Paso 1 — carrito
    tipoCalzado: 'pie_de_gato',
    carrito: [],
    resoladoMaterial: 'vibram_xs_grip2',
    mediaSuelaMaterial: 'vibram_xs_grip2',

    // Paso 2
    nombre: '',
    telefono: '',
    email: '',
    calle: '',
    numero: '',
    codigoPostal: '',
    ciudad: '',
    pais: 'ES',

    // Feedback del paso 2. Un formulario vacío no se abre en rojo: cada campo se queja cuando
    // el cliente ya ha pasado por él (tocadosPaso2, que llena el blur) o cuando ha intentado
    // seguir con algo mal (intentoPaso2).
    tocadosPaso2: {},
    intentoPaso2: false,

    // Resultado de la devolución GLS, lo devuelve el Worker
    gls: null,
    // Otra petición del mismo pedido está creando la devolución ahora mismo (el Worker
    // contesta enCurso). No es ni éxito ni fallo: no se pinta ni la etiqueta ni el modo B.
    glsEnCurso: false,
    copiado: '',

    // Paso 3
    metodoPago: '',

    get precioResolado() {
      try {
        return calculateLinePrice(PRECIOS, this.tipoCalzado, 'resolado_completo', 1);
      } catch {
        return 0;
      }
    },

    get precioMediaSuela() {
      try {
        return calculateLinePrice(PRECIOS, this.tipoCalzado, 'media_suela', 1);
      } catch {
        return 0;
      }
    },

    get precioPuntera() {
      try {
        return calculateLinePrice(PRECIOS, this.tipoCalzado, 'puntera', 1);
      } catch {
        return 0;
      }
    },

    get cantidadPuntera() {
      const linea = this.buscarLineaCarrito(this.tipoCalzado, 'puntera', null);
      return linea ? linea.cantidad : 0;
    },

    get totalCarrito() {
      return this.carrito.reduce((suma, linea) => suma + linea.precioSubtotal, 0);
    },

    get transporte() {
      return calcularTransporte(this.totalCarrito, PRECIO_TRANSPORTE_GLS, ENVIO_GRATIS_DESDE);
    },

    get faltaParaEnvioGratis() {
      return Math.max(0, ENVIO_GRATIS_DESDE - this.totalCarrito);
    },

    get precioTotal() {
      return this.totalCarrito + this.transporte;
    },

    get canProceedStep1() {
      return this.carrito.length > 0 && this.carrito.every((linea) => linea.cantidad >= 1);
    },

    // Lo que el modelo de js/campos-paso2.js necesita para juzgar el formulario. Leerlo aquí
    // hace que todo lo que dependa de él (botón, mensajes, aria-invalid) se recalcule solo
    // cuando cambia cualquier campo, incluido el país.
    get valoresPaso2() {
      return {
        nombre: this.nombre,
        email: this.email,
        telefono: this.telefono,
        calle: this.calle,
        numero: this.numero,
        codigoPostal: this.codigoPostal,
        ciudad: this.ciudad,
        pais: this.pais,
      };
    },

    get canProceedStep2() {
      return esPaso2Valido(this.valoresPaso2);
    },

    // Texto del error de un campo, o cadena vacía si no toca enseñarlo todavía.
    errorCampo(campo) {
      if (!this.intentoPaso2 && !this.tocadosPaso2[campo]) return '';
      const clave = claveErrorCampo(campo, this.valoresPaso2);
      return clave ? t(Alpine.store('i18n').lang, clave) : '';
    },

    marcarTocado(campo) {
      this.tocadosPaso2[campo] = true;
    },

    // Cambiar de país puede invalidar un teléfono o un CP que ya estaban bien. El mensaje se
    // recalcula solo, pero si el campo aún no se había tocado no se vería: si ya tiene algo
    // escrito, lo damos por tocado para que el cliente se entere en el momento.
    alCambiarPais() {
      for (const campo of CAMPOS_QUE_DEPENDEN_DEL_PAIS) {
        if (isNonEmpty(this[campo.nombre])) this.marcarTocado(campo.nombre);
      }
    },

    get resumenErrorPaso2() {
      if (!this.intentoPaso2 || this.canProceedStep2) return '';
      return t(Alpine.store('i18n').lang, 'error_resumen');
    },

    // El botón "Siguiente" ya no se desactiva: un botón gris no explica nada y, además, los
    // navegadores lo sacan del orden de tabulación, así que quien navega con teclado se
    // quedaba sin nada que pulsar al final del formulario. Ahora siempre se puede pulsar
    // (y el <form> hace que Enter haga lo mismo): si falta algo, se enseñan los errores y el
    // foco salta al primer campo que falla.
    enviarPaso2() {
      if (this.canProceedStep2) {
        this.intentoPaso2 = false;
        this.step = 3;
        return;
      }
      this.intentoPaso2 = true;
      const campo = primerCampoInvalido(this.valoresPaso2);
      if (campo) document.getElementById(campo.inputId)?.focus();
    },

    buscarLineaCarrito(tipoCalzado, servicio, material) {
      return this.carrito.find(
        (linea) =>
          linea.tipoCalzado === tipoCalzado &&
          linea.servicio === servicio &&
          linea.material === material,
      );
    },

    agregarAlCarrito(tipoCalzado, servicio, material, precioUnitario, cantidad = 1) {
      const existente = this.buscarLineaCarrito(tipoCalzado, servicio, material);
      if (existente) {
        existente.cantidad += cantidad;
        existente.precioSubtotal = existente.precioUnitario * existente.cantidad;
        return;
      }
      this.carrito.push({
        tipoCalzado,
        servicio,
        material,
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
      this.agregarAlCarrito(this.tipoCalzado, 'resolado_completo', this.resoladoMaterial, this.precioResolado);
    },

    anadirMediaSuela() {
      this.agregarAlCarrito(this.tipoCalzado, 'media_suela', this.mediaSuelaMaterial, this.precioMediaSuela);
    },

    incrementarPuntera() {
      this.agregarAlCarrito(this.tipoCalzado, 'puntera', null, this.precioPuntera);
    },

    decrementarPuntera() {
      const linea = this.buscarLineaCarrito(this.tipoCalzado, 'puntera', null);
      if (linea) this.ajustarCantidad(linea, -1);
    },

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

    // La lista la arma js/order.js, que es de donde la saca también gracias.html: el cliente
    // que ya ha pagado necesita exactamente los mismos datos que el que aún no. Aquí solo se
    // adapta el estado suelto del formulario a la forma de pedido que espera el helper.
    get datosParaPortal() {
      return buildDatosPortal(
        {
          orderId: this.orderId,
          nombre: this.nombre,
          email: this.email,
          direccion: {
            calle: this.calle,
            numero: this.numero,
            codigoPostal: this.codigoPostal,
            ciudad: this.ciudad,
            pais: this.pais,
          },
        },
        this.gls?.returnReason,
      );
    },

    get portalUrl() {
      return this.gls?.portalUrl || GLS_PORTAL_URL;
    },

    // Una sola decision para los tres sitios que pintan el punto (aqui, js/gracias.js y el
    // email del worker): o el punto, o el aviso de que GLS asigno uno que no admite
    // devoluciones, o nada. El enlace al buscador se pinta siempre, al margen de esto.
    get puntoResuelto() {
      const lang = Alpine.store('i18n').lang;
      return resolverPunto(this.gls?.dropOffLocation, t(lang, 'gls_punto_24h'));
    },

    get punto() {
      return this.puntoResuelto.punto;
    },

    get puntoNoAdmiteDevoluciones() {
      return this.puntoResuelto.noAdmiteDevoluciones;
    },

    get buscadorUrl() {
      return GLS_BUSCADOR_URL;
    },

    async copiar(valor) {
      // Solo se canta "Copiado" si se copió de verdad; si el navegador no deja, el botón se
      // queda como estaba y el valor sigue en pantalla para seleccionarlo a mano.
      if (!(await copiarAlPortapapeles(valor))) return;
      this.copiado = valor;
      setTimeout(() => {
        if (this.copiado === valor) this.copiado = '';
      }, MS_CONFIRMACION_COPIADO);
    },

    async confirmarPedido() {
      this.errorMsg = '';
      this.submitting = true;
      this.glsEnCurso = false;
      try {
        const payload = this.buildOrderPayload();
        const respuesta = await notifyOrderHastaResultado(API_BASE_URL, payload);
        // enCurso significa que otra petición del mismo pedido —la otra pestaña, o la ruta de
        // tarjeta que el cliente abandonó con el botón de atrás— está creando la devolución.
        // Enseñarle entonces las instrucciones manuales del modo B sería pedirle que cree a
        // mano una etiqueta que ya viene sola: dos etiquetas facturables para el mismo pedido.
        this.glsEnCurso = respuesta.enCurso === true;
        this.gls = this.glsEnCurso ? null : (respuesta.gls ?? { ok: false });
        this.summarySections = buildOrderSummary(payload, Alpine.store('i18n').lang).secciones;
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
