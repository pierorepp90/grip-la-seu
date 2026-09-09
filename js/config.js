// js/config.js
export const API_BASE_URL = 'https://grip-la-seu-api.grlaseu.workers.dev';

// URL pública del portal de devoluciones. El Worker la manda en gls.portalUrl; esta copia es
// el respaldo para que el enlace de emergencia nunca salga muerto si esa variable falta.
export const GLS_PORTAL_URL = 'https://returns.gls-group.com/climberup/create-return';

// Buscador público de puntos GLS, por si el que asigna GLS no le va bien al cliente.
export const GLS_BUSCADOR_URL = 'https://www.gls-spain.es/es/parcel-shops/';

// Motivo de devolución que el Worker manda a GLS (GLS_RETURN_REASON en worker/wrangler.toml).
// El Worker lo devuelve en gls.returnReason para que la lista de datos a copiar diga siempre
// la misma opción que él elige; esta copia es solo el respaldo para las respuestas que
// vengan sin él (página cacheada, pedido guardado en KV antes de que empezara a mandarlo).
export const GLS_MOTIVO_DEVOLUCION = 'Sin motivo específico';
