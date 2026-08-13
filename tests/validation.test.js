import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNonEmpty, isValidSpanishPhone, isValidEmail } from '../js/validation.js';

test('isNonEmpty rechaza vacíos y solo-espacios', () => {
  assert.equal(isNonEmpty('Ana'), true);
  assert.equal(isNonEmpty('   '), false);
  assert.equal(isNonEmpty(''), false);
  assert.equal(isNonEmpty(undefined), false);
});

test('isValidSpanishPhone acepta formatos comunes', () => {
  assert.equal(isValidSpanishPhone('612345678'), true);
  assert.equal(isValidSpanishPhone('+34612345678'), true);
  assert.equal(isValidSpanishPhone('+34 612 345 678'), true);
  assert.equal(isValidSpanishPhone('612-345-678'), true);
});

test('isValidSpanishPhone rechaza formatos inválidos', () => {
  assert.equal(isValidSpanishPhone('12345'), false);
  assert.equal(isValidSpanishPhone('512345678'), false);
  assert.equal(isValidSpanishPhone('abcdefghi'), false);
  assert.equal(isValidSpanishPhone(''), false);
});

test('isValidEmail acepta emails con formato válido', () => {
  assert.equal(isValidEmail('ana@example.com'), true);
});

test('isValidEmail rechaza emails sin @ o sin dominio', () => {
  assert.equal(isValidEmail('ana.example.com'), false);
  assert.equal(isValidEmail('ana@'), false);
  assert.equal(isValidEmail(''), false);
});
