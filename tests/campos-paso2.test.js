import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPOS_PASO2,
  CAMPOS_QUE_DEPENDEN_DEL_PAIS,
  campoPaso2,
  camposInvalidos,
  esPaso2Valido,
  claveErrorCampo,
  primerCampoInvalido,
} from '../js/campos-paso2.js';
import { LANGS, DICT } from '../js/i18n.js';

const VALIDO_ES = {
  nombre: 'Ana Puig',
  email: 'ana@correo.com',
  telefono: '612345678',
  calle: 'Carrer Major',
  numero: '12',
  codigoPostal: '25700',
  ciudad: 'La Seu',
  pais: 'ES',
};

const VALIDO_PT = {
  ...VALIDO_ES,
  telefono: '912345678',
  codigoPostal: '1000-001',
  ciudad: 'Lisboa',
  pais: 'PT',
};

const VACIO = {
  nombre: '',
  email: '',
  telefono: '',
  calle: '',
  numero: '',
  codigoPostal: '',
  ciudad: '',
  pais: 'ES',
};

test('el modelo cubre los siete campos del paso 2 en el orden del formulario', () => {
  assert.deepEqual(
    CAMPOS_PASO2.map((campo) => campo.nombre),
    ['nombre', 'email', 'telefono', 'calle', 'numero', 'codigoPostal', 'ciudad'],
  );
});

test('cada campo lleva el id del input y un id de error estable derivado de él', () => {
  const ids = CAMPOS_PASO2.map((campo) => campo.inputId);
  assert.deepEqual(ids, ['of-nombre', 'of-email', 'of-telefono', 'of-calle', 'of-numero', 'of-cp', 'of-ciudad']);
  for (const campo of CAMPOS_PASO2) {
    assert.equal(campo.errorId, `${campo.inputId}-error`);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('campoPaso2 busca por nombre y no inventa campos', () => {
  assert.equal(campoPaso2('codigoPostal').inputId, 'of-cp');
  assert.equal(campoPaso2('pais'), undefined);
  assert.equal(campoPaso2(''), undefined);
});

test('un formulario completo y correcto no tiene ningún campo inválido', () => {
  assert.deepEqual(camposInvalidos(VALIDO_ES), []);
  assert.equal(esPaso2Valido(VALIDO_ES), true);
  assert.deepEqual(camposInvalidos(VALIDO_PT), []);
  assert.equal(esPaso2Valido(VALIDO_PT), true);
});

test('un formulario vacío marca los siete campos', () => {
  assert.deepEqual(camposInvalidos(VACIO), [
    'nombre',
    'email',
    'telefono',
    'calle',
    'numero',
    'codigoPostal',
    'ciudad',
  ]);
  assert.equal(esPaso2Valido(VACIO), false);
});

test('cada campo se queja solo de lo suyo', () => {
  const malos = {
    nombre: '   ',
    email: 'ana@correo',
    telefono: '12345',
    calle: '',
    numero: '',
    codigoPostal: '2570',
    ciudad: '',
  };
  for (const [nombre, valorMalo] of Object.entries(malos)) {
    assert.deepEqual(camposInvalidos({ ...VALIDO_ES, [nombre]: valorMalo }), [nombre]);
  }
});

test('esPaso2Valido es lo contrario de tener campos inválidos, campo a campo', () => {
  for (const campo of CAMPOS_PASO2) {
    assert.equal(esPaso2Valido({ ...VALIDO_ES, [campo.nombre]: '' }), false);
  }
});

test('claveErrorCampo calla cuando el campo es válido', () => {
  for (const campo of CAMPOS_PASO2) {
    assert.equal(claveErrorCampo(campo.nombre, VALIDO_ES), '');
  }
});

test('claveErrorCampo devuelve una clave distinta por campo', () => {
  const claves = CAMPOS_PASO2.map((campo) => claveErrorCampo(campo.nombre, VACIO));
  assert.equal(new Set(claves).size, claves.length);
  assert.ok(claves.every((clave) => clave.startsWith('error_')));
});

test('el mensaje del teléfono y del código postal depende del país elegido', () => {
  assert.equal(claveErrorCampo('telefono', { ...VALIDO_ES, telefono: '123' }), 'error_telefono_es');
  assert.equal(claveErrorCampo('telefono', { ...VALIDO_PT, telefono: '123' }), 'error_telefono_pt');
  assert.equal(claveErrorCampo('codigoPostal', { ...VALIDO_ES, codigoPostal: '2' }), 'error_cp_es');
  assert.equal(claveErrorCampo('codigoPostal', { ...VALIDO_PT, codigoPostal: '2' }), 'error_cp_pt');
});

test('cambiar de país invalida el teléfono y el CP que ya estaban escritos', () => {
  const eraValidoEnEspana = { ...VALIDO_ES, pais: 'PT' };
  assert.deepEqual(camposInvalidos(eraValidoEnEspana), ['telefono', 'codigoPostal']);
  assert.equal(claveErrorCampo('telefono', eraValidoEnEspana), 'error_telefono_pt');
  assert.equal(claveErrorCampo('codigoPostal', eraValidoEnEspana), 'error_cp_pt');
});

test('claveErrorCampo ignora los campos que no son del paso 2', () => {
  assert.equal(claveErrorCampo('pais', VACIO), '');
  assert.equal(claveErrorCampo('metodoPago', VACIO), '');
});

test('primerCampoInvalido devuelve el primero que falla en el orden del formulario', () => {
  assert.equal(primerCampoInvalido(VACIO).inputId, 'of-nombre');
  assert.equal(primerCampoInvalido({ ...VALIDO_ES, numero: '', ciudad: '' }).inputId, 'of-numero');
  assert.equal(primerCampoInvalido({ ...VALIDO_ES, ciudad: '' }).inputId, 'of-ciudad');
  assert.equal(primerCampoInvalido(VALIDO_ES), null);
});

test('todas las claves de error del modelo existen en los cuatro idiomas', () => {
  const claves = new Set();
  for (const pais of ['ES', 'PT']) {
    for (const campo of CAMPOS_PASO2) {
      claves.add(claveErrorCampo(campo.nombre, { ...VACIO, pais }));
    }
  }
  for (const lang of LANGS) {
    for (const clave of claves) {
      assert.ok(DICT[lang][clave], `falta ${clave} en ${lang}`);
    }
  }
});

test('el modelo sabe qué campos puede invalidar un cambio de país', () => {
  assert.deepEqual(
    CAMPOS_QUE_DEPENDEN_DEL_PAIS.map((campo) => campo.nombre),
    ['telefono', 'codigoPostal'],
  );
  for (const campo of CAMPOS_QUE_DEPENDEN_DEL_PAIS) {
    assert.notEqual(campo.claveError({ ...VALIDO_ES, pais: 'ES' }), campo.claveError({ ...VALIDO_ES, pais: 'PT' }));
  }
});
