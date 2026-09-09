export function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// GLS solo tiene activados España y Portugal como países de origen.
//
// Nueve cifras en los dos casos. En España empiezan por 6, 7, 8 o 9 —móviles y fijos—; en
// Portugal por 9 los móviles y por 2 los fijos: 21x Lisboa, 22x Oporto y de 23x a 29x el resto
// del país. Aquí solo se admitía el 9 portugués, así que quien tuviera fijo no podía pasar del
// paso 2.
const TELEFONO_POR_PAIS = {
  ES: /^(?:\+34|0034)?[6789]\d{8}$/,
  PT: /^(?:\+351|00351)?[29]\d{8}$/,
};

export function isValidPhone(phone, pais) {
  if (typeof phone !== 'string') return false;
  const patron = TELEFONO_POR_PAIS[pais];
  if (!patron) return false;
  return patron.test(phone.replace(/[\s-]/g, ''));
}

const CP_POR_PAIS = {
  ES: /^\d{5}$/,
  PT: /^\d{4}(?:-\d{3})?$/,
};

export function isValidPostalCode(cp, pais) {
  if (typeof cp !== 'string') return false;
  const patron = CP_POR_PAIS[pais];
  if (!patron) return false;
  return patron.test(cp.trim());
}

export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
