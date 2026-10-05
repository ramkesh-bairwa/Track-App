import { randomUUID } from 'crypto';
import { query } from './db';

const MAX_PHOTO_LEN = 700_000; // ~500 KB image as a data URL
const PHOTO_WINDOW_MS = 10 * 60 * 1000; // photo may be attached within 10 min of the login

const MIN_PHOTO_LEN = 1_000; // anything smaller can't be a real camera frame

// Returns an error message for an unusable login photo, or null if it's fine.
export function checkLoginPhoto(photo) {
  if (typeof photo !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/.test(photo)) return 'Invalid photo.';
  if (photo.length < MIN_PHOTO_LEN) return 'Invalid photo.';
  if (photo.length > MAX_PHOTO_LEN) return 'Photo too large.';
  return null;
}

// Records a successful login (with its camera photo) and returns its uuid.
export async function recordLogin(userId, { ip, userAgent, photo = null }) {
  const uuid = randomUUID();
  await query('INSERT INTO login_events (uuid, user_id, ip, user_agent, photo) VALUES (?, ?, ?, ?, ?)', [
    uuid,
    userId,
    (ip || '').slice(0, 64) || null,
    (userAgent || '').slice(0, 500) || null,
    photo,
  ]);
  return uuid;
}

// Attaches the captured photo to a recent login of the same user, once.
export async function attachLoginPhoto(userId, uuid, photo) {
  const invalid = checkLoginPhoto(photo);
  if (invalid) return { error: invalid };
  const rows = await query('SELECT id, created_at, photo FROM login_events WHERE uuid = ? AND user_id = ?', [uuid, userId]);
  const ev = rows[0];
  if (!ev) return { error: 'Login not found.' };
  if (ev.photo) return { ok: true, alreadySet: true };
  if (Date.now() - new Date(ev.created_at).getTime() > PHOTO_WINDOW_MS) return { error: 'Too late to attach a photo.' };
  await query('UPDATE login_events SET photo = ? WHERE id = ?', [photo, ev.id]);
  return { ok: true };
}

export async function listLogins(userId, limit = 50) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  return query(
    `SELECT uuid, ip, user_agent, (photo IS NOT NULL) AS has_photo, created_at
       FROM login_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ${n}`,
    [userId]
  );
}

export async function getLoginPhoto(userId, uuid) {
  const rows = await query('SELECT photo FROM login_events WHERE uuid = ? AND user_id = ?', [uuid, userId]);
  return rows[0]?.photo || null;
}

// Friendly device string from a User-Agent (best-effort, no dependency).
export function describeDevice(ua = '') {
  const s = String(ua);
  const browser =
    /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' :
    /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os =
    /Windows NT 10/.test(s) ? 'Windows' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'macOS' :
    /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Linux/.test(s) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}
