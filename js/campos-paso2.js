// js/campos-paso2.js
//
// Única fuente de verdad de la validación del paso 2. Cada campo declara aquí su validador,
// el id de su input y la clave del mensaje que explica qué esperamos. De esta lista salen las
// dos cosas que antes vivían separadas: si se puede pasar al paso 3 (canProceedStep2) y el
// mensaje que ve el cliente debajo de cada campo. Si mañana se añade un campo al formulario,
// se añade aquí y el resto (botón, mensajes, aria-invalid, foco) lo hereda solo.
//
// Las reglas en sí no viven aquí: son las de js/validation.js, que no se tocan.
import { isNonEmpty, isValidEmail, isValidPhone, isValidPostalCode } from './validation.js';

// GLS solo admite España y Portugal, y el <select> del formulario no ofrece nada más. Si aun
// así llegara otro país, el validador ya devuelve false; el mensaje cae al de España para no
// quedarnos sin explicación que dar.
const CLAVES_ERROR_TELEFONO = { ES: 'error_telefono_es', PT: 'error_telefono_pt' };
const CLAVES_ERROR_CP = { ES: 'error_cp_es', PT: 'error_cp_pt' };

function claveSegunPais(claves, pais) {
  return claves[pais] ?? claves.ES;
}

// El orden es el del formulario: de él sale a qué campo saltamos al pulsar "Siguiente" con
// algo mal.
export const CAMPOS_PASO2 = [
  {
    nombre: 'nombre',
    inputId: 'of-nombre',
    errorId: 'of-nombre-error',
    esValido: (valores) => isNonEmpty(valores.nombre),
    claveError: () => 'error_nombre',
  },
  {
    nombre: 'email',
    inputId: 'of-email',
    errorId: 'of-email-error',
    esValido: (valores) => isValidEmail(valores.email),
    claveError: () => 'error_email',
  },
  {
    nombre: 'telefono',
    inputId: 'of-telefono',
    errorId: 'of-telefono-error',
    esValido: (valores) => isValidPhone(valores.telefono, valores.pais),
    claveError: (valores) => claveSegunPais(CLAVES_ERROR_TELEFONO, valores.pais),
    dependeDelPais: true,
  },
  {
    nombre: 'calle',
    inputId: 'of-calle',
    errorId: 'of-calle-error',
    esValido: (valores) => isNonEmpty(valores.calle),
    claveError: () => 'error_calle',
  },
  {
    nombre: 'numero',
    inputId: 'of-numero',
    errorId: 'of-numero-error',
    esValido: (valores) => isNonEmpty(valores.numero),
    claveError: () => 'error_numero',
  },
  {
    nombre: 'codigoPostal',
    inputId: 'of-cp',
    errorId: 'of-cp-error',
    esValido: (valores) => isValidPostalCode(valores.codigoPostal, valores.pais),
    claveError: (valores) => claveSegunPais(CLAVES_ERROR_CP, valores.pais),
    dependeDelPais: true,
  },
  {
    nombre: 'ciudad',
    inputId: 'of-ciudad',
    errorId: 'of-ciudad-error',
    esValido: (valores) => isNonEmpty(valores.ciudad),
    claveError: () => 'error_ciudad',
  },
];

// Cambiar de país puede tumbar un teléfono o un CP que ya estaban escritos y eran correctos.
// Quien pinta el formulario necesita saber cuáles son para no dejar el mensaje viejo puesto.
export const CAMPOS_QUE_DEPENDEN_DEL_PAIS = CAMPOS_PASO2.filter((campo) => campo.dependeDelPais);

export function campoPaso2(nombre) {
  return CAMPOS_PASO2.find((campo) => campo.nombre === nombre);
}

export function camposInvalidos(valores) {
  return CAMPOS_PASO2.filter((campo) => !campo.esValido(valores)).map((campo) => campo.nombre);
}

export function esPaso2Valido(valores) {
  return CAMPOS_PASO2.every((campo) => campo.esValido(valores));
}

// Cadena vacía cuando el campo está bien (o cuando no es del paso 2): quien pinta el mensaje
// no tiene que preguntar dos veces.
export function claveErrorCampo(nombre, valores) {
  const campo = campoPaso2(nombre);
  if (!campo || campo.esValido(valores)) return '';
  return campo.claveError(valores);
}

export function primerCampoInvalido(valores) {
  return CAMPOS_PASO2.find((campo) => !campo.esValido(valores)) ?? null;
}
