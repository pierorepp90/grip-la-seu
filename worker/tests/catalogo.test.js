import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizarIdentificador, describirLinea, nombrePais, nombreMetodoPago } from '../src/catalogo.js';

test('describirLinea traduce servicio, tipo de calzado y material al castellano', () => {
  assert.equal(
    describirLinea({
      servicio: 'resolado_completo',
      tipoCalzado: 'pie_de_gato',
      material: 'vibram_xs_grip2',
    }),
    'Resolado completo · Pie de gato · Vibram XS Grip2',
  );
});

test('describirLinea omite el material cuando la línea no lo lleva', () => {
  assert.equal(
    describirLinea({ servicio: 'puntera', tipoCalzado: 'bota', material: null }),
    'Puntera · Bota',
  );
});

test('describirLinea usa la descripción ya construida cuando viene de Stripe', () => {
  assert.equal(
    describirLinea({ descripcion: 'Resolado completo · Pie de gato', cantidad: 1 }),
    'Resolado completo · Pie de gato',
  );
});

test('describirLinea nunca deja escapar un identificador crudo al cliente', () => {
  // /api/notify-order no está autenticado: puede llegar un identificador que no está en el
  // catálogo. Aun así el cliente no debe leer nunca un nombre de variable con guiones bajos.
  const descripcion = describirLinea({
    servicio: 'servicio_nuevo',
    tipoCalzado: 'zapatilla_trail',
    material: 'goma_rara',
  });
  assert.doesNotMatch(descripcion, /_/);
  assert.equal(descripcion, 'Servicio nuevo · Zapatilla trail · Goma rara');
});

test('humanizarIdentificador convierte guiones bajos en palabras', () => {
  assert.equal(humanizarIdentificador('media_suela'), 'Media suela');
  assert.equal(humanizarIdentificador(''), '');
  assert.equal(humanizarIdentificador(null), '');
});

test('nombrePais traduce los países del formulario y deja pasar el resto', () => {
  assert.equal(nombrePais('ES'), 'España');
  assert.equal(nombrePais('PT'), 'Portugal');
  assert.equal(nombrePais('FR'), 'FR');
});

test('nombreMetodoPago traduce los métodos de pago', () => {
  assert.equal(nombreMetodoPago('tarjeta'), 'Tarjeta');
  assert.equal(nombreMetodoPago('bizum'), 'Bizum');
  assert.equal(nombreMetodoPago('transferencia'), 'Transferencia');
  assert.equal(nombreMetodoPago('otro_metodo'), 'Otro metodo');
});
