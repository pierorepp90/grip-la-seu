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
