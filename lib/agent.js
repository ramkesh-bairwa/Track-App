// The server's side of linked desktop apps (table desktop_devices).
//
// A desktop app links once with its user's email + password and gets a device
// key. Every minute it calls /api/agent/heartbeat (status in, settings and
// commands out), syncs that user's data (/api/agent/changes, /api/agent/apply)
// and uploads new screenshots (/api/agent/screenshots). Admins change a
// device's settings or queue commands from the admin panel.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { isUserActive } from './userStatus';
import { query } from './db';

export const DEVICE_SETTINGS_DEFAULTS = {
  systemPhotos: true, // camera photo on computer start / unlock / wake
  screenshotMinutes: 5, // how often screenshots are taken while switched on
};
export const COMMANDS = {
  screenshot_now: 'Take a screenshot now',
  sync_now: 'Sync now',
  lock: 'Lock the app',
  sign_out: 'Sign out of the app',
};
export const ONLINE_MS = 3 * 60 * 1000; // seen within → shown as online

export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const newDeviceToken = () => `mtd_${crypto.randomBytes(32).toString('base64url')}`;

const parse = (v, fallback) => {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

export function deviceSettings(row) {
  return { ...DEVICE_SETTINGS_DEFAULTS, ...parse(row?.settings, {}) };
}

export function cleanSettings(input) {
  const out = {};
  if (typeof input?.systemPhotos === 'boolean') out.systemPhotos = input.systemPhotos;
  const m = Number(input?.screenshotMinutes);
  if (Number.isFinite(m) && m >= 1 && m <= 120) out.screenshotMinutes = Math.round(m);
  return out;
}

// The device calling, from "Authorization: Bearer mtd_…".
export async function requireDevice(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const deny = (msg, status = 401) => ({ error: NextResponse.json({ error: msg, relink: status === 401 }, { status }) });
  if (!token.startsWith('mtd_')) return deny('This desktop app isn’t linked to the server. Sign in again under Server connection.');
  const [row] = await query(
    `SELECT d.*, u.email, u.name AS user_name FROM desktop_devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?`,
    [hashToken(token)]
  );
  if (!row) return deny('The server doesn’t know this desktop app any more. Sign in again under Server connection.');
  if (row.revoked_at) return deny('An admin disconnected this desktop app from the server. Sign in again under Server connection.');
  if (!(await isUserActive(row.user_id))) return deny('This account has been deactivated on the server.', 403);
  return { device: row };
}

export async function touchDevice(device, request, extra = {}) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || null;
  const sets = ['last_seen_at = NOW()', 'last_ip = ?'];
  const values = [ip ? ip.slice(0, 64) : null];
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`\`${k}\` = ?`);
    values.push(v);
  }
  await query(`UPDATE desktop_devices SET ${sets.join(', ')} WHERE id = ?`, [...values, device.id]);
}

// Commands waiting for a device; handed over (and cleared) at its heartbeat.
export async function takeCommands(deviceId) {
  const [row] = await query('SELECT commands FROM desktop_devices WHERE id = ?', [deviceId]);
  const list = parse(row?.commands, []);
  if (list.length) await query('UPDATE desktop_devices SET commands = NULL WHERE id = ?', [deviceId]);
  return list;
}

export async function queueCommand(deviceId, command, byName) {
  const [row] = await query('SELECT commands FROM desktop_devices WHERE id = ?', [deviceId]);
  const list = parse(row?.commands, []).filter((c) => c.command !== command);
  list.push({ command, at: new Date().toISOString(), by: byName || null });
  await query('UPDATE desktop_devices SET commands = ? WHERE id = ?', [JSON.stringify(list.slice(-10)), deviceId]);
}

export function publicDevice(row) {
  const seen = row.last_seen_at ? new Date(row.last_seen_at) : null;
  return {
    id: row.id,
    uuid: row.uuid,
    userId: row.user_id,
    userName: row.user_name || null,
    email: row.email || null,
    name: row.name,
    os: row.os,
    appVersion: row.app_version,
    settings: deviceSettings(row),
    pending: parse(row.commands, []),
    status: parse(row.status, null),
    lastSeenAt: row.last_seen_at,
    lastSyncAt: row.last_sync_at,
    lastIp: row.last_ip,
    online: Boolean(seen && Date.now() - seen.getTime() < ONLINE_MS),
    revoked: Boolean(row.revoked_at),
    createdAt: row.created_at,
  };
}

export async function listDevices(userId = null) {
  const rows = await query(
    `SELECT d.*, u.email, u.name AS user_name FROM desktop_devices d JOIN users u ON u.id = d.user_id
      ${userId ? 'WHERE d.user_id = ?' : ''} ORDER BY d.revoked_at IS NOT NULL, d.last_seen_at DESC, d.id DESC`,
    userId ? [userId] : []
  );
  return rows.map(publicDevice);
}
