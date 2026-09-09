import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copiarAlPortapapeles } from '../js/portapapeles.js';

test('copiarAlPortapapeles copia el valor y confirma que lo ha hecho', async () => {
  const copiados = [];
  const copiado = await copiarAlPortapapeles('GLS-20260909-AB12', {
    writeText: async (valor) => {
      copiados.push(valor);
    },
  });
  assert.equal(copiado, true);
  assert.deepEqual(copiados, ['GLS-20260909-AB12']);
});

test('copiarAlPortapapeles devuelve false si el navegador rechaza la escritura', async () => {
  const copiado = await copiarAlPortapapeles('GLS-20260909-AB12', {
    writeText: async () => {
      throw new Error('NotAllowedError');
    },
  });
  assert.equal(copiado, false);
});

test('copiarAlPortapapeles devuelve false donde no hay portapapeles', async () => {
  // http:// y navegadores viejos no traen navigator.clipboard: leerlo revienta en seco, y sin
  // este caso el botón se quedaba mudo con una promesa sin capturar.
  assert.equal(await copiarAlPortapapeles('GLS-20260909-AB12', null), false);
});
