// The desktop app's side of being linked to a server (see lib/agent.js for
// the server's side). desktop/main.js calls /api/agent-local/tick every
// minute; one tick:
//   1. heartbeat — tells the server how this computer is doing, gets back the
//      admin's settings (screenshots on/off, interval, system photos) and any
//      commands (take a screenshot now, lock, sign out, sync now)
//   2. applies those settings here
//   3. syncs the linked user's data both ways (only their slice)
//   4. uploads screenshots taken since the last upload
// Everything is kept in this install's sync_state (agent_* keys).
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { query } from './db';
import { syncConnection, getState, setState, exportChanges, applyChanges } from './sync';
import { computeScope } from './syncScope';
import { screenshotRoot, isShotName, trackerSwitch, setTrackerSwitch } from './screenshots';
import { systemPhotosEnabled, setSystemPhotos } from './systemEvents';
import { isDate } from './calendarServer';

const KEYS = [
  'agent_server_url',
  'agent_token',
  'agent_device_uuid',
  'agent_user_email',
  'agent_user_name',
  'agent_pull_cursor',
  'agent_push_cursor',
  'agent_last_shot',
  'agent_last_run_at',
  'agent_last_ok_at',
  'agent_last_error',
  'agent_last_result',
  'agent_settings',
];
const UPLOADS_PER_TICK = 40;
const g = globalThis;

const osName = () => ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform);
const appVersion = () => process.env.MYTRACK_APP_VERSION || null;

async function state() {
  const conn = await syncConnection();
  try {
    return await getState(conn, KEYS);
  } finally {
    await conn.end();
  }
}

async function save(values) {
  const conn = await syncConnection();
  try {
    await setState(conn, values);
  } finally {
    await conn.end();
  }
}

export function cleanServerUrl(raw) {
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(url)) return null;
  return url;
}

async function call(s, pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`${s.agent_server_url}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${s.agent_token || ''}`, ...(raw ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const e = new Error(`Can’t reach the server at ${s.agent_server_url} (${err.cause?.code || err.name || err.message}). It will try again in a minute.`);
    e.offline = true;
    throw e;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `The server answered ${res.status}.`);
    e.relink = Boolean(json.relink);
    throw e;
  }
  return json;
}

// ---------- linking ----------

export async function linkToServer({ serverUrl, email, password }) {
  const url = cleanServerUrl(serverUrl);
  if (!url) throw new Error('Enter the server’s address, like https://mytrack.example.com');
  const s = await state();
  const deviceUuid = s.agent_device_uuid || crypto.randomUUID();
  const out = await call({ agent_server_url: url }, '/api/agent/link', {
    method: 'POST',
    body: { email, password, deviceName: os.hostname(), os: osName(), appVersion: appVersion(), deviceUuid },
  });
  const sameServer = s.agent_server_url === url && s.agent_user_email === out.user.email;
  await save({
    agent_server_url: url,
    agent_token: out.token,
    agent_device_uuid: out.device.uuid,
    agent_user_email: out.user.email,
    agent_user_name: out.user.name,
    agent_last_error: null,
    // A different server or account starts over with a full sync.
    ...(sameServer ? {} : { agent_pull_cursor: null, agent_push_cursor: null, agent_last_shot: null, agent_last_result: null }),
  });
  return out.user;
}

export async function unlinkFromServer() {
  await save({ agent_token: null, agent_last_error: null, agent_settings: null });
}

export async function agentStatus() {
  const s = await state();
  let result = null;
  let settings = null;
  try {
    result = s.agent_last_result ? JSON.parse(s.agent_last_result) : null;
    settings = s.agent_settings ? JSON.parse(s.agent_settings) : null;
  } catch {}
  return {
    linked: Boolean(s.agent_server_url && s.agent_token),
    serverUrl: s.agent_server_url || '',
    email: s.agent_user_email || '',
    name: s.agent_user_name || '',
    deviceUuid: s.agent_device_uuid || '',
    lastRunAt: s.agent_last_run_at || null,
    lastOkAt: s.agent_last_ok_at || null,
    lastError: s.agent_last_error || '',
    lastResult: result,
    settings,
  };
}

// ---------- one tick ----------

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function applySettings(email, settings) {
  const owner = { email };
  const now = await trackerSwitch(owner).catch(() => ({ enabled: false }));
  if (Boolean(settings.screenshots) !== now.enabled) await setTrackerSwitch(owner, Boolean(settings.screenshots), 'Admin (server)');
  if (typeof settings.systemPhotos === 'boolean' && settings.systemPhotos !== (await systemPhotosEnabled())) {
    await setSystemPhotos(settings.systemPhotos);
  }
}

async function syncData(s) {
  // 1. Pull the user's slice from the server (trusted as is).
  const theirs = await call(s, `/api/agent/changes?since=${encodeURIComponent(s.agent_pull_cursor || '')}`);
  const pulled = await applyChanges(theirs);
  // 2. Push only that user's slice from here, plus this computer's system photos.
  const [me] = await query('SELECT id FROM users WHERE email = ?', [s.agent_user_email]);
  let pushed = { stats: {} };
  let ours = { now: s.agent_push_cursor };
  if (me) {
    const conn = await syncConnection();
    let scope;
    try {
      scope = await computeScope(conn, me.id, { systemEvents: true });
    } finally {
      await conn.end();
    }
    ours = await exportChanges(s.agent_push_cursor || null, { skip: pulled.applied, scope });
    pushed = await call(s, '/api/agent/apply', { method: 'POST', body: ours });
  }
  await save({ agent_pull_cursor: theirs.now, agent_push_cursor: ours.now });
  const count = (p) => Object.values(p.tables || {}).reduce((n, rows) => n + rows.length, 0) + (p.tombstones?.length || 0);
  return { pulled: { received: count(theirs), ...pulled.stats }, pushed: { sent: me ? count(ours) : 0, ...pushed.stats } };
}

async function uploadShots(s) {
  const dir = path.join(screenshotRoot(), String(s.agent_user_email).toLowerCase());
  let days;
  try {
    days = (await fs.readdir(dir)).filter(isDate).sort();
  } catch {
    return 0;
  }
  const last = s.agent_last_shot || '';
  let sent = 0;
  for (const date of days) {
    if (last && date < last.slice(0, 10)) continue;
    const files = (await fs.readdir(path.join(dir, date)).catch(() => [])).filter(isShotName).sort();
    for (const file of files) {
      const key = `${date}/${file}`;
      if (key <= last) continue;
      if (sent >= UPLOADS_PER_TICK) return sent;
      const body = await fs.readFile(path.join(dir, date, file));
      await call(s, `/api/agent/screenshots?date=${date}&file=${encodeURIComponent(file)}`, {
        method: 'POST',
        body,
        raw: true,
        headers: { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg' },
      });
      await save({ agent_last_shot: key });
      s.agent_last_shot = key;
      sent += 1;
    }
  }
  return sent;
}

// Returns { linked, commands, settings } for desktop/main.js.
export async function runTick({ reason = 'timer' } = {}) {
  if (g.__myTrackAgentRunning) return { linked: true, busy: true };
  const s = await state();
  if (!s.agent_server_url || !s.agent_token) return { linked: false };
  g.__myTrackAgentRunning = true;
  const started = Date.now();
  try {
    const email = String(s.agent_user_email).toLowerCase();
    const tracker = await readJSON(path.join(screenshotRoot(), email, '.status.json'));
    const beat = await call(s, '/api/agent/heartbeat', {
      method: 'POST',
      body: { status: { tracker, reason, at: new Date().toISOString() }, appVersion: appVersion(), os: osName(), name: os.hostname() },
    });
    await applySettings(email, beat.settings || {});
    const commands = beat.commands || [];
    const data = await syncData(s); // every tick; cheap when nothing changed
    const shots = await uploadShots(s);
    const result = { ...data, screenshots: shots, seconds: Math.round((Date.now() - started) / 100) / 10 };
    const now = new Date().toISOString();
    await save({
      agent_last_run_at: now,
      agent_last_ok_at: now,
      agent_last_error: null,
      agent_last_result: JSON.stringify(result),
      agent_settings: JSON.stringify(beat.settings || {}),
      agent_user_name: beat.user?.name || s.agent_user_name,
    });
    return { linked: true, email, commands: commands.map((c) => c.command), settings: beat.settings || {}, result };
  } catch (err) {
    await save({ agent_last_run_at: new Date().toISOString(), agent_last_error: err.message }).catch(() => {});
    return { linked: true, email: String(s.agent_user_email || '').toLowerCase(), error: err.message, relink: Boolean(err.relink), offline: Boolean(err.offline) };
  } finally {
    g.__myTrackAgentRunning = false;
  }
}
