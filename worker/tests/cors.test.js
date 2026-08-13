import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorsHeaders } from '../src/cors.js';

test('incluye Access-Control-Allow-Origin cuando el origen coincide', () => {
  const headers = buildCorsHeaders('https://pierorepp90.github.io', 'https://pierorepp90.github.io');
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://pierorepp90.github.io');
});

test('omite Access-Control-Allow-Origin cuando el origen no coincide', () => {
  const headers = buildCorsHeaders('https://evil.example', 'https://pierorepp90.github.io');
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
});

test('siempre incluye métodos y headers permitidos', () => {
  const headers = buildCorsHeaders('https://evil.example', 'https://pierorepp90.github.io');
  assert.equal(headers['Access-Control-Allow-Methods'], 'POST, GET, OPTIONS');
  assert.equal(headers['Access-Control-Allow-Headers'], 'Content-Type');
});
