import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { LANGS, DICT, t } from '../js/i18n.js';

test('todas las lenguas tienen exactamente las mismas claves', () => {
  const [first, ...rest] = LANGS.map((lang) => Object.keys(DICT[lang]).sort());
  for (const keys of rest) {
    assert.deepEqual(keys, first);
  }
});

test('ninguna traducción está vacía', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(DICT[lang])) {
      assert.ok(value.trim().length > 0, `${lang}.${key} está vacío`);
    }
  }
});

test('t() devuelve la traducción del idioma pedido', () => {
  assert.equal(t('en', 'btn_siguiente'), DICT.en.btn_siguiente);
});

test('t() cae a catalán si el idioma no existe, y a la clave si falta la traducción', () => {
  assert.equal(t('fr', 'btn_siguiente'), DICT.ca.btn_siguiente);
  assert.equal(t('ca', 'clave_inexistente'), 'clave_inexistente');
});

test('t() sustituye los parámetros entre llaves', () => {
  assert.equal(t('es', 'envio_falta_para_gratis', { importe: '12.00' }), 'Te faltan 12.00€ para el envío gratis');
});

test('t() deja el placeholder intacto si no se le pasa el parámetro', () => {
  assert.match(t('es', 'envio_falta_para_gratis'), /\{importe\}/);
});

// Las plantillas piden claves por su nombre y t() devuelve la clave cuando no la encuentra:
// una errata en el HTML no rompe nada, solo pinta "error_cp_es" en la cara del cliente. Esto
// lo comprueba a máquina, no a ojo.
test('todas las claves $t() del HTML existen en los cuatro idiomas', async () => {
  const raiz = new URL('..', import.meta.url);
  const ficheros = (await readdir(raiz)).filter((nombre) => nombre.endsWith('.html'));
  assert.ok(ficheros.length > 0, 'no se ha encontrado ningún HTML que revisar');

  let comprobadas = 0;
  for (const fichero of ficheros) {
    const html = await readFile(new URL(fichero, raiz), 'utf8');
    // Solo las claves literales: $t('dia_' + dia.weekday) se arma en tiempo de ejecución.
    for (const [, clave] of html.matchAll(/\$t\(\s*'([^']+)'\s*[,)]/g)) {
      comprobadas += 1;
      for (const lang of LANGS) {
        assert.ok(
          Object.hasOwn(DICT[lang], clave),
          `${fichero} usa $t('${clave}') y falta la traducción en ${lang}`,
        );
      }
    }
  }
  assert.ok(comprobadas > 0, 'no se ha encontrado ninguna clave $t() literal');
});
