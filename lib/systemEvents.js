// "System login" history: the desktop app takes a camera photo when this
// computer is started / signed in to, unlocked, or woken from sleep.
import crypto from 'crypto';
import os from 'os';
import { query } from '@/lib/db';
import { checkLoginPhoto } from '@/lib/loginHistory';

export const SYSTEM_KINDS = {
  system_start: 'Computer started / signed in',
  unlock: 'Screen unlocked',
  wake: 'Woke from sleep',
};

// Requests from the desktop app itself carry a secret it makes up at every
// launch (MYTRACK_LOCAL_TOKEN) — nothing else can add system events.
export function isLocalRequest(request) {
  const token = process.env.MYTRACK_LOCAL_TOKEN;
  const sent = request.headers.get('x-mytrack-local') || '';
  if (process.env.MYTRACK_DESKTOP !== '1' || !token || sent.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
}

export async function recordSystemEvent(kind, photo) {
  const uuid = crypto.randomUUID();
  const osName = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform;
  await query('INSERT INTO system_events (uuid, kind, device, os, photo) VALUES (?, ?, ?, ?, ?)', [
    uuid,
    SYSTEM_KINDS[kind] ? kind : 'system_start',
    os.hostname().slice(0, 255),
    osName,
    checkLoginPhoto(photo) ? null : photo,
  ]);
  return uuid;
}

export async function listSystemEvents(limit = 200) {
  return query(
    `SELECT uuid, kind, device, os, (photo IS NOT NULL) AS has_photo, created_at
       FROM system_events ORDER BY created_at DESC, id DESC LIMIT ${Math.min(500, Math.max(1, Number(limit) || 200))}`
  );
}

export async function systemEventPhoto(uuid) {
  const rows = await query('SELECT photo FROM system_events WHERE uuid = ?', [uuid]);
  return rows[0]?.photo || null;
}

// On / off for this computer (kept in this install's sync_state). On unless
// switched off.
export async function systemPhotosEnabled() {
  const rows = await query("SELECT v FROM sync_state WHERE k = 'system_photos'");
  return rows[0]?.v !== '0';
}

export async function setSystemPhotos(enabled) {
  await query("INSERT INTO sync_state (k, v) VALUES ('system_photos', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [enabled ? '1' : '0']);
}
