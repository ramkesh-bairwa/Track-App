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

// Whether camera photos are taken for this user's Login history. On unless
// switched off; a database that hasn't been migrated yet (no login_photos
// column) keeps them on.
export async function loginPhotosEnabled(userId) {
  try {
    const rows = await query('SELECT login_photos FROM users WHERE id = ?', [userId]);
    return rows[0]?.login_photos !== 0;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return true;
    throw err;
  }
}

// The server runs MySQL, which can't apply schema.sql (its ADD COLUMN IF NOT
// EXISTS is MariaDB-only), so the column is added here the first time.
export async function setLoginPhotos(userId, enabled) {
  const update = () => query('UPDATE users SET login_photos = ? WHERE id = ?', [enabled ? 1 : 0, userId]);
  try {
    await update();
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    await query('ALTER TABLE users ADD COLUMN login_photos TINYINT(1) NOT NULL DEFAULT 1').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e; // another request just added it
    });
    await update();
  }
}

// Records a successful login (with its camera photo) and returns its uuid.
// kind: 'login' (signed in) | 'app_open' (desktop app opened while signed in).
export async function recordLogin(userId, { ip, userAgent, photo = null, kind = 'login' }) {
  const uuid = randomUUID();
  if (photo && !(await loginPhotosEnabled(userId))) photo = null;
  await query('INSERT INTO login_events (uuid, user_id, ip, user_agent, photo, kind, source) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    uuid,
    userId,
    (ip || '').slice(0, 64) || null,
    (userAgent || '').slice(0, 500) || null,
    photo,
    kind,
    process.env.MYTRACK_DESKTOP === '1' ? 'desktop' : 'web',
  ]);
  return uuid;
}

// Attaches the captured photo to a recent login of the same user, once.
export async function attachLoginPhoto(userId, uuid, photo) {
  const invalid = checkLoginPhoto(photo);
  if (invalid) return { error: invalid };
  if (!(await loginPhotosEnabled(userId))) return { ok: true, skipped: true };
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
    `SELECT uuid, ip, user_agent, kind, source, (photo IS NOT NULL) AS has_photo, created_at
       FROM login_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ${n}`,
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
