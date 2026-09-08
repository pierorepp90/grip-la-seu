import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReturnOrderRequest } from '../src/gls.js';

const env = {
  GLS_API_BASE: 'https://api.gls-group.net/order-management/shop-returns/portal/v3',
  GLS_PORTAL_NAME: 'climberup',
  GLS_PORTAL_TOKEN: 'token-123',
  GLS_CLIENT_KEY: 'clave-abc',
  GLS_RETURN_REASON: 'Sin motivo específico',
  GLS_PORTAL_URL: 'https://returns.gls-group.com/climberup/create-return',
};

const orderPayload = {
  orderId: 'GLS-20260908120000-A1B2',
  nombre: 'Ana Pérez',
  email: 'ana@example.com',
  lang: 'ca',
  direccion: {
    calle: 'Carrer Major',
    numero: '12',
    codigoPostal: '25700',
    ciudad: "La Seu d'Urgell",
    pais: 'ES',
  },
};

test('buildReturnOrderRequest construye el payload que espera GLS', () => {
  const request = buildReturnOrderRequest(orderPayload, env);
  assert.equal(request.originalOrderReference, 'GLS-20260908120000-A1B2');
  assert.equal(request.returnReason, 'Sin motivo específico');
  assert.deepEqual(request.options.confirmationMail, { sendTo: ['ana@example.com'] });
  assert.equal(request.sender.personName, 'Ana Pérez');
  assert.equal(request.sender.email, 'ana@example.com');
  assert.equal(request.sender.address.street, 'Carrer Major 12');
  assert.equal(request.sender.address.city, "La Seu d'Urgell");
  assert.equal(request.sender.address.zipCode, '25700');
  assert.equal(request.sender.address.countryCode, 'ES');
});

test('buildReturnOrderRequest mapea el catalán a español, que GLS no soporta', () => {
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'ca' }, env).options.languageCode, 'es');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'es' }, env).options.languageCode, 'es');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'en' }, env).options.languageCode, 'en');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: 'pt' }, env).options.languageCode, 'pt');
  assert.equal(buildReturnOrderRequest({ ...orderPayload, lang: undefined }, env).options.languageCode, 'es');
});

test('buildReturnOrderRequest trunca cada campo al límite de GLS', () => {
  const request = buildReturnOrderRequest(
    {
      ...orderPayload,
      orderId: 'X'.repeat(60),
      nombre: 'N'.repeat(50),
      direccion: {
        calle: 'C'.repeat(50),
        numero: '1234567890',
        codigoPostal: '9'.repeat(15),
        ciudad: 'D'.repeat(50),
        pais: 'ES',
      },
    },
    env,
  );
  assert.equal(request.originalOrderReference.length, 50);
  assert.equal(request.sender.personName.length, 40);
  assert.equal(request.sender.address.street, `${'C'.repeat(40)} ${'123456'}`);
  assert.equal(request.sender.address.zipCode.length, 10);
  assert.equal(request.sender.address.city.length, 40);
});

test('buildReturnOrderRequest recorta espacios sobrantes', () => {
  const request = buildReturnOrderRequest(
    { ...orderPayload, nombre: '  Ana Pérez  ', direccion: { ...orderPayload.direccion, numero: '' } },
    env,
  );
  assert.equal(request.sender.personName, 'Ana Pérez');
  assert.equal(request.sender.address.street, 'Carrer Major');
});
