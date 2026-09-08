import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatearDistancia, formatearPunto } from '../js/punto-gls.js';

const punto = {
  name: 'PS GO PACK EXPRESS',
  type: 'SHOP',
  distance: 0.18218337,
  address: {
    street: 'Carrer dels Canonges 52 bajos',
    city: "La Seu d'Urgell",
    zipCode: '25700',
    countryCode: 'ES',
  },
  externalContactDetails: { phone: '635106811' },
  openingDays: [
    {
      weekday: 'TUE',
      hours: [
        { openingTime: '09:30', closingTime: '13:30' },
        { openingTime: '17:30', closingTime: '20:30' },
      ],
    },
    { weekday: 'SAT', hours: [{ openingTime: '09:00', closingTime: '14:00' }] },
  ],
};

test('formatearDistancia usa metros por debajo del kilómetro', () => {
  assert.equal(formatearDistancia(0.18218337), '182 m');
  assert.equal(formatearDistancia(0.999), '999 m');
});

test('formatearDistancia usa kilómetros con un decimal a partir de 1', () => {
  assert.equal(formatearDistancia(1), '1.0 km');
  assert.equal(formatearDistancia(12.34), '12.3 km');
});

test('formatearDistancia cambia de unidad al redondear, no antes', () => {
  // 0.9996 km son 999.6 m, que redondean a 1000: se pinta en km, no "1000 m".
  assert.equal(formatearDistancia(0.9996), '1.0 km');
});

test('formatearDistancia devuelve null si no hay distancia', () => {
  assert.equal(formatearDistancia(undefined), null);
  assert.equal(formatearDistancia(null), null);
  assert.equal(formatearDistancia('0.5'), null);
});

test('formatearPunto extrae nombre, dirección, distancia y teléfono', () => {
  const resultado = formatearPunto(punto);
  assert.equal(resultado.nombre, 'PS GO PACK EXPRESS');
  assert.equal(resultado.direccion, "Carrer dels Canonges 52 bajos, 25700 La Seu d'Urgell");
  assert.equal(resultado.distancia, '182 m');
  assert.equal(resultado.telefono, '635106811');
});

test('formatearPunto agrupa los tramos horarios por día', () => {
  const resultado = formatearPunto(punto);
  assert.deepEqual(resultado.horarios, [
    { weekday: 'TUE', tramos: '09:30–13:30, 17:30–20:30' },
    { weekday: 'SAT', tramos: '09:00–14:00' },
  ]);
});

test('formatearPunto devuelve null si no hay punto o no tiene nombre', () => {
  assert.equal(formatearPunto(null), null);
  assert.equal(formatearPunto(undefined), null);
  assert.equal(formatearPunto({}), null);
});

test('formatearPunto tolera que falten campos opcionales', () => {
  const resultado = formatearPunto({ name: 'PS MINIMO' });
  assert.equal(resultado.nombre, 'PS MINIMO');
  assert.equal(resultado.direccion, '');
  assert.equal(resultado.distancia, null);
  assert.equal(resultado.telefono, null);
  assert.deepEqual(resultado.horarios, []);
});

test('formatearPunto construye la dirección con los trozos que haya', () => {
  assert.equal(
    formatearPunto({ name: 'X', address: { city: 'Berga' } }).direccion,
    'Berga',
  );
  assert.equal(
    formatearPunto({ name: 'X', address: { street: 'Carrer Major 1', city: 'Berga' } }).direccion,
    'Carrer Major 1, Berga',
  );
});
