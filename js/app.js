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
