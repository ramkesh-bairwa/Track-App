// Saved devices (IMEI tab): validation shared by the create and edit routes.
import { normalizeImei } from './imei';

export const DEVICE_COLUMNS = 'id, name, imei, imei2, notes, created_at, last_lat, last_lon, last_accuracy, last_ip, last_seen_at';
export const MAX_DEVICES = 50;

// Returns { values } (only the fields present in `body`) or { error }.
export function readDevice(body, { partial = false } = {}) {
  const values = {};
  if (!partial || body?.name !== undefined) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'Give the device a name, e.g. “My Pixel 8”.' };
    if (name.length > 100) return { error: 'The name can be at most 100 characters.' };
    values.name = name;
  }
  if (!partial || body?.imei !== undefined) {
    const imei = normalizeImei(body?.imei);
    if (!imei) return { error: 'That isn’t a valid IMEI — check the 15 digits (dial *#06# on the phone).' };
    values.imei = imei;
  }
  if (body?.imei2 !== undefined) {
    if (body.imei2 == null || String(body.imei2).trim() === '') values.imei2 = null;
    else {
      const imei2 = normalizeImei(body.imei2);
      if (!imei2) return { error: 'The second IMEI isn’t valid — check its 15 digits.' };
      values.imei2 = imei2;
    }
  }
  if (body?.notes !== undefined) {
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (notes.length > 300) return { error: 'Notes can be at most 300 characters.' };
    values.notes = notes || null;
  }
  if (values.imei && values.imei2 && values.imei === values.imei2) return { error: 'The two IMEIs are the same.' };
  return { values };
}

export const isDuplicate = (err) => err?.code === 'ER_DUP_ENTRY';

// Before `npm run seed` has created user_devices, say so instead of a generic 500.
export const NO_TABLE = 'ER_NO_SUCH_TABLE';
export const noTableResponse = { error: 'Saved devices need a database update — run “npm run seed”, then reload.' };

// A location report from the device itself: { lat, lon, accuracy } or { error }.
export function readLocation(body) {
  const lat = Number(body?.latitude);
  const lon = Number(body?.longitude);
  const accuracy = body?.accuracy == null ? null : Number(body.accuracy);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { error: 'Send latitude (-90…90) and longitude (-180…180).' };
  }
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0)) return { error: 'Accuracy must be a positive number of metres.' };
  return { lat, lon, accuracy: accuracy == null ? null : Math.min(accuracy, 1e7) };
}
