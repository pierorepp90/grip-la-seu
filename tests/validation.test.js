import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNonEmpty, isValidPhone, isValidPostalCode, isValidEmail } from '../js/validation.js';

test('isNonEmpty rechaza vacíos y solo-espacios', () => {
  assert.equal(isNonEmpty('Ana'), true);
  assert.equal(isNonEmpty('   '), false);
  assert.equal(isNonEmpty(''), false);
  assert.equal(isNonEmpty(undefined), false);
});

test('isValidPhone acepta móviles y fijos españoles', () => {
  assert.equal(isValidPhone('612345678', 'ES'), true);
  assert.equal(isValidPhone('+34612345678', 'ES'), true);
  assert.equal(isValidPhone('+34 612 345 678', 'ES'), true);
  assert.equal(isValidPhone('612-345-678', 'ES'), true);
});

test('isValidPhone acepta móviles portugueses', () => {
  assert.equal(isValidPhone('912345678', 'PT'), true);
  assert.equal(isValidPhone('+351912345678', 'PT'), true);
  assert.equal(isValidPhone('+351 912 345 678', 'PT'), true);
});

// Los fijos portugueses son de nueve cifras y empiezan por 2: 21x Lisboa, 22x Oporto y de
// 23x a 29x el resto del país. Se rechazaban, así que un cliente portugués con fijo no podía
// terminar el formulario.
test('isValidPhone acepta fijos portugueses', () => {
  assert.equal(isValidPhone('212345678', 'PT'), true);
  assert.equal(isValidPhone('223456789', 'PT'), true);
  assert.equal(isValidPhone('289123456', 'PT'), true);
  assert.equal(isValidPhone('+351212345678', 'PT'), true);
  assert.equal(isValidPhone('00351 212 345 678', 'PT'), true);
});

test('isValidPhone rechaza los prefijos portugueses que no existen', () => {
  assert.equal(isValidPhone('112345678', 'PT'), false);
  assert.equal(isValidPhone('312345678', 'PT'), false);
  assert.equal(isValidPhone('812345678', 'PT'), false);
  assert.equal(isValidPhone('21234567', 'PT'), false);
  assert.equal(isValidPhone('2123456789', 'PT'), false);
});

test('isValidPhone no mezcla países', () => {
  assert.equal(isValidPhone('612345678', 'PT'), false);
  assert.equal(isValidPhone('+351912345678', 'ES'), false);
});

test('isValidPhone rechaza formatos inválidos y países desconocidos', () => {
  assert.equal(isValidPhone('12345', 'ES'), false);
  assert.equal(isValidPhone('512345678', 'ES'), false);
  assert.equal(isValidPhone('abcdefghi', 'ES'), false);
  assert.equal(isValidPhone('', 'ES'), false);
  assert.equal(isValidPhone('612345678', 'FR'), false);
});

test('isValidPostalCode acepta 5 dígitos en España', () => {
  assert.equal(isValidPostalCode('25700', 'ES'), true);
  assert.equal(isValidPostalCode(' 25700 ', 'ES'), true);
});

test('isValidPostalCode acepta los dos formatos portugueses', () => {
  assert.equal(isValidPostalCode('1000', 'PT'), true);
  assert.equal(isValidPostalCode('1000-260', 'PT'), true);
});

test('isValidPostalCode rechaza formatos inválidos y países desconocidos', () => {
  assert.equal(isValidPostalCode('2570', 'ES'), false);
  assert.equal(isValidPostalCode('257000', 'ES'), false);
  assert.equal(isValidPostalCode('ABCDE', 'ES'), false);
  assert.equal(isValidPostalCode('1000-26', 'PT'), false);
  assert.equal(isValidPostalCode('25700', 'FR'), false);
  assert.equal(isValidPostalCode(undefined, 'ES'), false);
});

test('isValidEmail acepta emails con formato válido', () => {
  assert.equal(isValidEmail('ana@example.com'), true);
});

test('isValidEmail rechaza emails sin @ o sin dominio', () => {
  assert.equal(isValidEmail('ana.example.com'), false);
  assert.equal(isValidEmail('ana@'), false);
  assert.equal(isValidEmail(''), false);
});
