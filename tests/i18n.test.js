import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, DICT, t } from '../js/i18n.js';

test('las 3 lenguas tienen exactamente las mismas claves', () => {
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
