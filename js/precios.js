// Resolado completo · Pie de gato ya confirmado con el propietario.
// PENDIENTE: confirmar el resto de tarifas (Bota, Media suela) antes de publicar.
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
      vibram_xs_grip2: { '3.5': 35, '4': 36, '4.5': 37, '5': 38 },
      cocida: { '3.5': 33, '4': 34, '4.5': 35, '5': 36 },
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
