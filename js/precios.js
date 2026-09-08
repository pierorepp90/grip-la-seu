// Precio fijo por tipo de calzado y servicio. El material (Vibram XS Grip2 /
// XS Grip Edge) es preferencia del cliente y no cambia el precio; el grosor
// es siempre 4mm, sin selector.
// Resolado completo, Media suela y Puntera · Pie de gato ya confirmados con
// el propietario. PENDIENTE: confirmar tarifas de Bota.
export const PRECIOS = {
  bota: {
    resolado_completo: 0,
    media_suela: 0,
    puntera: 15,
  },
  pie_de_gato: {
    resolado_completo: 44,
    media_suela: 40,
    puntera: 8,
  },
};

// Envío GLS: 5€, gratis a partir de 150€ de servicios (sin contar el propio envío).
export const PRECIO_TRANSPORTE_GLS = 5;
export const ENVIO_GRATIS_DESDE = 150;
