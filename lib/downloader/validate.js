import { badRequest } from './errors';

export function requireString(value, field, { maxLength = 2000 } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`"${field}" is required`);
  if (value.length > maxLength) throw badRequest(`"${field}" must be at most ${maxLength} characters`);
  return value.trim();
}

export function intInRange(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`"${field}" is required`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`"${field}" must be a whole number between ${min} and ${max}`);
  }
  return n;
}

export function oneOf(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`);
  return value;
}
