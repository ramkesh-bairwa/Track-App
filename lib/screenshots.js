// Screenshots from scripts/screenshot-tracker. Each account's shots live in
//   <SCREENSHOT_DIR>/<account email>/<YYYY-MM-DD>/<HH-MM-SS>.jpg
// and only admins (users.is_admin) can list, view or delete them.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextResponse } from 'next/server';
import { query } from './db';
import { getCurrentUser } from './auth';
import { isDate } from './calendarServer';

export function screenshotRoot() {
  const dir = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'public', 'system-tracker');
  return dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir;
}

const SHOT = /^\d{2}-\d{2}-\d{2}(-display\d)?\.(jpe?g|png)$/i;
export const isShotName = (name) => typeof name === 'string' && SHOT.test(name);

// The folder for one account, or null if its email can't be a safe folder name.
function userDir(email) {
  const name = String(email || '').toLowerCase();
  if (!name || name !== path.basename(name) || name.startsWith('.')) return null;
  return path.join(screenshotRoot(), name);
}

async function readDir(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

// Returns the signed-in admin, or a 404 response for everyone else — non-admins
// shouldn't learn the feature exists.
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user?.is_admin) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { user };
}

export async function shotOwner(id) {
  const rows = await query('SELECT id, name, email, avatar FROM users WHERE id = ?', [Number(id) || 0]);
  return rows[0] && userDir(rows[0].email) ? rows[0] : null;
}

export async function listShots(owner, date) {
  if (!isDate(date)) return [];
  return (await readDir(path.join(userDir(owner.email), date))).filter(isShotName).sort();
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// capture.sh writes HH-MM-SS.json next to each shot: the app and window title.
// Returns { 'HH-MM-SS': { app, title } }.
export async function listShotMeta(owner, date) {
  if (!isDate(date)) return {};
  const dir = path.join(userDir(owner.email), date);
  const names = (await readDir(dir)).filter((n) => /^\d{2}-\d{2}-\d{2}\.json$/.test(n));
  const meta = {};
  await Promise.all(
    names.map(async (n) => {
      const m = await readJSON(path.join(dir, n));
      if (m) meta[n.slice(0, 8)] = { app: String(m.app || ''), title: String(m.title || '') };
    })
  );
  return meta;
}

// The tracker's last run for this account: { time, state, mode, message }.
// state: ok | no-permission | skipped | error.
export async function trackerStatus(owner) {
  const s = await readJSON(path.join(userDir(owner.email), '.status.json'));
  if (!s) return null;
  return { time: String(s.time || ''), state: String(s.state || ''), mode: String(s.mode || ''), message: String(s.message || '') };
}

// { 'YYYY-MM-DD': number of capture times } — extra displays of one capture count once.
export async function dayCounts(owner) {
  const days = (await readDir(userDir(owner.email))).filter(isDate);
  const counts = {};
  await Promise.all(
    days.map(async (d) => {
      const n = new Set((await listShots(owner, d)).map((f) => f.slice(0, 8))).size;
      if (n) counts[d] = n;
    })
  );
  return counts;
}

// Every account, with how many screenshots it has.
export async function usersWithCounts() {
  const users = await query('SELECT id, name, email, avatar FROM users ORDER BY name, id');
  return Promise.all(
    users.map(async (u) => {
      if (!userDir(u.email)) return { ...u, days: 0, shots: 0 };
      const counts = await dayCounts(u);
      const values = Object.values(counts);
      return { ...u, days: values.length, shots: values.reduce((a, b) => a + b, 0) };
    })
  );
}

export function shotPath(owner, date, file) {
  if (!isDate(date) || !isShotName(file)) return null;
  return path.join(userDir(owner.email), date, file);
}

export async function deleteShots(owner, date, files) {
  const all = await listShots(owner, date);
  const dir = path.join(userDir(owner.email), date);
  const doomed = all.filter((f) => files.includes(f));
  await Promise.all(doomed.map((f) => fs.rm(path.join(dir, f), { force: true })));
  if (doomed.length === all.length) {
    await fs.rm(dir, { recursive: true, force: true });
    return doomed.length;
  }
  // Drop the app/title note once no image from that moment is left.
  const left = new Set(all.filter((f) => !doomed.includes(f)).map((f) => f.slice(0, 8)));
  const stamps = [...new Set(doomed.map((f) => f.slice(0, 8)))].filter((s) => !left.has(s));
  await Promise.all(stamps.map((s) => fs.rm(path.join(dir, `${s}.json`), { force: true })));
  return doomed.length;
}

export async function deleteDay(owner, date) {
  if (!isDate(date)) return;
  await fs.rm(path.join(userDir(owner.email), date), { recursive: true, force: true });
}

export async function deleteAll(owner) {
  const dir = userDir(owner.email);
  await Promise.all((await readDir(dir)).filter(isDate).map((d) => fs.rm(path.join(dir, d), { recursive: true, force: true })));
}
