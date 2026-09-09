// Nombres de catálogo en castellano para el Worker.
//
// Estos nombres los lee el cliente en dos sitios de los que no hay vuelta atrás: el nombre del
// producto en la propia página de pago de Stripe (mientras teclea la tarjeta) y el email de
// confirmación. Ahí no puede aparecer nunca `resolado_completo (pie_de_gato)`: eso son nombres
// de variable, no el nombre de un servicio.
//
// El equivalente traducido a los cuatro idiomas vive en js/order.js sobre las claves de
// js/i18n.js. Está duplicado a propósito: worker/ se despliega solo (wrangler, su propio
// package.json) y no puede importar de la carpeta js/ del sitio estático. Los emails son solo
// en castellano por diseño, así que aquí no hace falta más idioma que este.

const SERVICIOS = {
  resolado_completo: 'Resolado completo',
  media_suela: 'Media suela',
  puntera: 'Puntera',
};

const TIPOS_CALZADO = {
  bota: 'Bota',
  pie_de_gato: 'Pie de gato',
};

const MATERIALES = {
  vibram_xs_grip2: 'Vibram XS Grip2',
  vibram_xs_grip_edge: 'Vibram XS Grip Edge',
};

const PAISES = {
  ES: 'España',
  PT: 'Portugal',
};

const METODOS_PAGO = {
  tarjeta: 'Tarjeta',
  bizum: 'Bizum',
  transferencia: 'Transferencia',
};

// Red de seguridad, no traducción: /api/notify-order no está autenticado y acepta cualquier
// cuerpo, así que puede llegar un identificador que no esté en el catálogo. Aunque no sepamos
// cómo se llama, el cliente no debe leer un guion bajo.
export function humanizarIdentificador(valor) {
  if (!valor) return '';
  const texto = String(valor).replace(/_/g, ' ').trim();
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function nombreDe(diccionario, clave) {
  if (!clave) return '';
  return Object.hasOwn(diccionario, clave) ? diccionario[clave] : humanizarIdentificador(clave);
}

// Dos formas de línea conviven en el carrito y las dos tienen que seguir funcionando: la ruta
// de bizum/transferencia manda la línea estructurada, y la de tarjeta la reconstruye desde
// Stripe con la descripción ya montada (la que montó esta misma función al crear la sesión).
export function describirLinea(linea) {
  if (linea.descripcion) return linea.descripcion;
  return [
    nombreDe(SERVICIOS, linea.servicio),
    nombreDe(TIPOS_CALZADO, linea.tipoCalzado),
    nombreDe(MATERIALES, linea.material),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function nombrePais(codigo) {
  if (!codigo) return '';
  return Object.hasOwn(PAISES, codigo) ? PAISES[codigo] : String(codigo);
}

export function nombreMetodoPago(metodo) {
  return nombreDe(METODOS_PAGO, metodo);
}
