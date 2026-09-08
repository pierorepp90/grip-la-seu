// js/app.js
import { LANGS, t } from './i18n.js';
import { PRECIOS, PRECIO_TRANSPORTE_GLS, ENVIO_GRATIS_DESDE } from './precios.js';
import { calculateLinePrice, minPrecioServicio, calcularTransporte } from './pricing.js';
import { isNonEmpty, isValidPhone, isValidPostalCode, isValidEmail } from './validation.js';
import { generateOrderId, buildOrderSummary } from './order.js';
import { createCheckoutSession, notifyOrder } from './api.js';
import { API_BASE_URL, GLS_PORTAL_URL, GLS_BUSCADOR_URL } from './config.js';
import { formatearPunto } from './punto-gls.js';

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
    summaryLines: [],

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

    // Resultado de la devolución GLS, lo devuelve el Worker
    gls: null,
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

    get portalUrl() {
      return this.gls?.portalUrl || GLS_PORTAL_URL;
    },

    get punto() {
      return formatearPunto(this.gls?.dropOffLocation);
    },

    get buscadorUrl() {
      return GLS_BUSCADOR_URL;
    },

    async copiar(valor) {
      await navigator.clipboard.writeText(valor);
      this.copiado = valor;
      setTimeout(() => {
        if (this.copiado === valor) this.copiado = '';
      }, 2000);
    },

    async confirmarPedido() {
      this.errorMsg = '';
      this.submitting = true;
      try {
        const payload = this.buildOrderPayload();
        const respuesta = await notifyOrder(API_BASE_URL, payload);
        this.gls = respuesta.gls ?? { ok: false };
        this.summaryLines = buildOrderSummary({ ...payload, gls: this.gls }).lineas;
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
