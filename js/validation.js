export function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidSpanishPhone(phone) {
  if (typeof phone !== 'string') return false;
  const cleaned = phone.replace(/[\s-]/g, '');
  return /^(?:\+34|0034)?[6789]\d{8}$/.test(cleaned);
}

export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
