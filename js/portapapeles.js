// js/portapapeles.js
//
// Un solo copiado para los dos sitios que pintan la lista de datos del portal de GLS: el modal
// de index.html y gracias.html.

// Lo que dura el "Copiado" antes de volver a "Copiar". Compartido para que el botón se porte
// igual en los dos sitios.
export const MS_CONFIRMACION_COPIADO = 2000;

// navigator.clipboard no existe en http:// ni en navegadores viejos —leerlo revienta en seco—
// y writeText() puede rechazar aunque exista (permiso denegado, documento sin foco). Sin este
// try/catch la promesa se quedaba sin capturar y el botón se moría en silencio.
//
// Devuelve si se copió de verdad, para que quien pinte el botón solo cante "Copiado" cuando lo
// sea: un fallo no puede parecer un acierto. Si falla, el valor sigue en pantalla y el cliente
// lo puede seleccionar a mano.
export async function copiarAlPortapapeles(valor, clipboard = globalThis.navigator?.clipboard) {
  try {
    await clipboard.writeText(valor);
    return true;
  } catch (error) {
    console.error('No se pudo copiar al portapapeles', error);
    return false;
  }
}
