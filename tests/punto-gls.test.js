import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatearDistancia,
  formatearPunto,
  cubreElDia,
  aceptaDevoluciones,
  resolverPunto,
} from '../js/punto-gls.js';

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

// --- Puntos que no admiten devoluciones ---------------------------------------------------
//
// GLS asigna a veces un punto que sus propios datos declaran incapaz de aceptar devoluciones
// (verificado en producción: un locker de Castelldefels con offersReturnDropOff: 'N'). Nuestra
// etiqueta es una devolución prepagada, así que el punto tiene que ofrecer las dos cosas.

const puntoLaSeu = {
  name: 'PS GO PACK EXPRESS',
  type: 'SHOP',
  parcelHandlingRestriction: {
    offersParcelCollection: 'Y',
    offersReturnDropOff: 'Y',
    offersLabelPurchase: 'Y',
    offersPrepaidParcelDropOff: 'Y',
    offersLabellessDropOff: 'N',
  },
  distance: 0.18218337,
  address: {
    street: 'Carrer dels Canonges 52 bajos',
    city: "La Seu d'Urgell",
    zipCode: '25700',
    countryCode: 'ES',
  },
  externalContactDetails: { phone: '635106811' },
  openingDays: [{ weekday: 'TUE', hours: [{ openingTime: '09:30', closingTime: '13:30' }] }],
};

const lockerCastelldefels = {
  name: 'GLS Locker 24/7 MOEVE CASTELLDEFELS',
  type: 'LOCKER',
  parcelHandlingRestriction: {
    offersParcelCollection: 'Y',
    offersReturnDropOff: 'N',
    offersLabelPurchase: 'N',
    offersPrepaidParcelDropOff: 'N',
    offersLabellessDropOff: 'N',
  },
  distance: 0.17339578,
  address: { street: 'Carrer Granada 20', city: 'Castelldefels', zipCode: '08860', countryCode: 'ES' },
  openingDays: [{ weekday: 'MON', hours: [{ openingTime: '00:00', closingTime: '14:00' }] }],
};

test('aceptaDevoluciones acepta el punto que ofrece las dos capacidades', () => {
  assert.equal(
    aceptaDevoluciones({
      parcelHandlingRestriction: { offersReturnDropOff: 'Y', offersPrepaidParcelDropOff: 'Y' },
    }),
    true,
  );
});

test('aceptaDevoluciones rechaza si no admite dejar devoluciones', () => {
  assert.equal(
    aceptaDevoluciones({
      parcelHandlingRestriction: { offersReturnDropOff: 'N', offersPrepaidParcelDropOff: 'Y' },
    }),
    false,
  );
});

test('aceptaDevoluciones rechaza si no admite paquetes ya prepagados', () => {
  assert.equal(
    aceptaDevoluciones({
      parcelHandlingRestriction: { offersReturnDropOff: 'Y', offersPrepaidParcelDropOff: 'N' },
    }),
    false,
  );
});

test('aceptaDevoluciones rechaza cuando falta parcelHandlingRestriction', () => {
  // Ante la duda, no. Mandar a alguien a un punto que le rechace el paquete es peor que
  // decirle que busque uno.
  assert.equal(aceptaDevoluciones({ name: 'PS SIN DATOS' }), false);
  assert.equal(aceptaDevoluciones({ name: 'PS VACIO', parcelHandlingRestriction: {} }), false);
  assert.equal(aceptaDevoluciones(null), false);
  assert.equal(aceptaDevoluciones(undefined), false);
});

test('aceptaDevoluciones exige la "Y" literal que manda GLS', () => {
  assert.equal(
    aceptaDevoluciones({
      parcelHandlingRestriction: { offersReturnDropOff: true, offersPrepaidParcelDropOff: true },
    }),
    false,
  );
});

test('aceptaDevoluciones decide por capacidades, no por el tipo de punto', () => {
  assert.equal(aceptaDevoluciones(puntoLaSeu), true);
  assert.equal(aceptaDevoluciones(lockerCastelldefels), false);
  // Un LOCKER que declarase las dos capacidades se aceptaría: manda el dato, no el `type`.
  assert.equal(aceptaDevoluciones({ ...lockerCastelldefels, ...puntoLaSeu, type: 'LOCKER' }), true);
});

test('resolverPunto devuelve el punto formateado cuando admite devoluciones', () => {
  const resultado = resolverPunto(puntoLaSeu);
  assert.equal(resultado.noAdmiteDevoluciones, false);
  assert.equal(resultado.punto.nombre, 'PS GO PACK EXPRESS');
  assert.equal(resultado.punto.distancia, '182 m');
});

test('resolverPunto esconde el punto y avisa cuando no admite devoluciones', () => {
  const resultado = resolverPunto(lockerCastelldefels);
  assert.equal(resultado.punto, null);
  assert.equal(resultado.noAdmiteDevoluciones, true);
});

test('resolverPunto no avisa de nada cuando GLS no asignó punto', () => {
  // Sin punto no hay nada que explicar: el buscador ya se pinta siempre.
  for (const vacio of [null, undefined, {}]) {
    assert.deepEqual(resolverPunto(vacio), { punto: null, noAdmiteDevoluciones: false });
  }
});

// --- Puntos abiertos las 24 h -------------------------------------------------------------
//
// GLS expresa un punto 24/7 como dos tramos pegados por día: 00:00–14:00 y 14:00–23:59.
// Pintados literalmente son seis líneas casi idénticas de ruido. El filtro de puntos deja
// fuera casi todos los lockers, pero una tienda puede declarar esta misma forma.

test('cubreElDia detecta los dos tramos pegados con los que GLS expresa un 24/7', () => {
  assert.equal(
    cubreElDia([
      { openingTime: '00:00', closingTime: '14:00' },
      { openingTime: '14:00', closingTime: '23:59' },
    ]),
    true,
  );
});

test('cubreElDia acepta un único tramo que cubra el día entero', () => {
  assert.equal(cubreElDia([{ openingTime: '00:00', closingTime: '23:59' }]), true);
  assert.equal(cubreElDia([{ openingTime: '00:00', closingTime: '24:00' }]), true);
  // GLS podría cerrar el tramo con la medianoche del día siguiente.
  assert.equal(cubreElDia([{ openingTime: '00:00', closingTime: '00:00' }]), true);
});

test('cubreElDia rechaza un horario normal de tienda', () => {
  assert.equal(cubreElDia([{ openingTime: '09:30', closingTime: '13:30' }]), false);
  assert.equal(
    cubreElDia([
      { openingTime: '09:30', closingTime: '13:30' },
      { openingTime: '17:30', closingTime: '20:30' },
    ]),
    false,
  );
});

test('cubreElDia rechaza tramos que empiezan a medianoche pero dejan un hueco', () => {
  assert.equal(
    cubreElDia([
      { openingTime: '00:00', closingTime: '14:00' },
      { openingTime: '17:00', closingTime: '23:59' },
    ]),
    false,
  );
});

test('cubreElDia rechaza lo que no sepa leer, en vez de inventarse un 24 h', () => {
  assert.equal(cubreElDia([]), false);
  assert.equal(cubreElDia(undefined), false);
  assert.equal(cubreElDia([{ openingTime: 'todo el día', closingTime: '23:59' }]), false);
});

test('formatearPunto colapsa a "24 h" el día que está abierto entero', () => {
  const resultado = formatearPunto(
    {
      name: 'GLS 24/7',
      openingDays: [
        {
          weekday: 'MON',
          hours: [
            { openingTime: '00:00', closingTime: '14:00' },
            { openingTime: '14:00', closingTime: '23:59' },
          ],
        },
        { weekday: 'TUE', hours: [{ openingTime: '09:00', closingTime: '14:00' }] },
      ],
    },
    'Abierto 24 h',
  );
  assert.deepEqual(resultado.horarios, [
    { weekday: 'MON', tramos: 'Abierto 24 h' },
    { weekday: 'TUE', tramos: '09:00–14:00' },
  ]);
});

test('resolverPunto pasa la etiqueta de 24 h traducida al formateador', () => {
  const punto24h = {
    name: 'PS 24 HORES',
    parcelHandlingRestriction: { offersReturnDropOff: 'Y', offersPrepaidParcelDropOff: 'Y' },
    openingDays: [{ weekday: 'SUN', hours: [{ openingTime: '00:00', closingTime: '23:59' }] }],
  };
  assert.deepEqual(resolverPunto(punto24h, 'Obert 24 h').punto.horarios, [
    { weekday: 'SUN', tramos: 'Obert 24 h' },
  ]);
});
