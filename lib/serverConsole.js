import { execFile } from 'node:child_process';
import { stat, readdir } from 'node:fs/promises';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { dumpDatabaseSql } from '@/lib/backup';

// ---------------------------------------------------------------------------
// Admin "Server Console".
//
// SECURITY: the browser never sends a command — it sends an action *id* from
// the fixed list below. The server looks that id up here and runs a hardcoded
// program with hardcoded arguments through execFile (no shell, so no &&, |,
// $(), redirects or injection). There is no way to run an arbitrary command
// from this page; adding one would turn it into a remote shell, so don't.
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd();
const EXEC_TIMEOUT = 60_000; // ms
const MAX_OUTPUT = 200_000; // chars returned to the browser

// Make sure common install dirs (Homebrew, npm global, pm2) are on PATH — a
// Node process launched from a GUI or a minimal shell often misses these, so
// git / pm2 / lsof come back as "not installed" even when they exist.
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const ENV = {
  ...process.env,
  PATH: [...new Set([...(process.env.PATH || '').split(':'), ...EXTRA_PATH])].filter(Boolean).join(':'),
};

// Run a fixed binary with fixed args. `input` is never interpolated into a
// shell; execFile passes args straight to the program.
function run(file, args) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: PROJECT_ROOT, timeout: EXEC_TIMEOUT, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: ENV },
      (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim();
        if (err && err.code === 'ENOENT') {
          resolve({ ok: false, output: `${file}: not installed on this server.` });
        } else if (err && err.killed) {
          resolve({ ok: false, output: `Timed out after ${EXEC_TIMEOUT / 1000}s.\n${out}` });
        } else {
          resolve({ ok: !err, output: out || '(no output)' });
        }
      }
    );
  });
}

function humanBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(1)} ${u[i]}`;
}

// A JS-only system report — no shelling out, works the same on every OS.
function systemReport() {
  const mt = os.totalmem();
  const mf = os.freemem();
  const up = os.uptime();
  const d = Math.floor(up / 86400);
  const h = Math.floor((up % 86400) / 3600);
  const m = Math.floor((up % 3600) / 60);
  const lines = [
    `Host        : ${os.hostname()}`,
    `Platform    : ${os.type()} ${os.release()} (${os.arch()})`,
    `Node        : ${process.version}`,
    `App uptime  : ${Math.floor(process.uptime())}s`,
    `OS uptime   : ${d}d ${h}h ${m}m`,
    `CPUs        : ${os.cpus().length} × ${os.cpus()[0]?.model?.trim() || 'unknown'}`,
    `Load avg    : ${os.loadavg().map((n) => n.toFixed(2)).join('  ')}  (1m 5m 15m)`,
    `Memory      : ${humanBytes(mt - mf)} used / ${humanBytes(mt)}  (${humanBytes(mf)} free)`,
    `Process RSS : ${humanBytes(process.memoryUsage().rss)}`,
  ];
  return { ok: true, output: lines.join('\n') };
}

// Resolve a user-typed subpath and refuse anything outside the project dir, so
// `ls ../../etc` or `ls /` can't be used to snoop around the whole server.
function safeSubpath(arg) {
  const rel = (arg || '.').trim() || '.';
  const abs = path.resolve(PROJECT_ROOT, rel);
  if (abs !== PROJECT_ROOT && !abs.startsWith(PROJECT_ROOT + path.sep)) return null;
  return abs;
}

// Listening TCP ports — the tool differs by OS.
function listeningPorts() {
  return os.platform() === 'linux'
    ? run('ss', ['-tlnp'])
    : run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
}

// Node / PM2 processes only (filtered in JS so no shell pipe is needed).
async function processes() {
  const res = await run('ps', ['axo', 'pid,ppid,%cpu,%mem,comm']);
  if (!res.ok) return res;
  const lines = res.output.split('\n');
  const kept = [lines[0], ...lines.slice(1).filter((l) => /node|pm2|next/i.test(l))];
  return { ok: true, output: kept.join('\n') || '(no node processes)' };
}

// A safe subset of env vars — NEVER secrets (DB_PASSWORD, JWT_SECRET, tokens).
function safeEnv() {
  const keys = ['NODE_ENV', 'PORT', 'HOSTNAME', 'TZ', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];
  const out = keys.map((k) => `${k.padEnd(10)} = ${process.env[k] ?? '(unset)'}`);
  out.push('', '(secrets like DB_PASSWORD / JWT_SECRET are never shown here)');
  return { ok: true, output: out.join('\n') };
}

const IS_LINUX = os.platform() === 'linux';

// A hostname / IP that's safe to hand to a network tool: no leading dash (so it
// can't sneak in a flag), no shell metacharacters. execFile already prevents
// shell injection; this stops flag-injection and junk input.
function validHost(h) {
  const host = (h || '').trim();
  return /^(?!-)[A-Za-z0-9._:-]{1,253}$/.test(host) ? host : null;
}

// --- white-hat recon / diagnostics (all read-only) ---

function netInfo() {
  return IS_LINUX ? run('ip', ['-brief', 'addr']) : run('ifconfig', []);
}

async function connections() {
  const res = IS_LINUX ? await run('ss', ['-tn', 'state', 'established']) : await run('netstat', ['-an']);
  if (!res.ok) return res;
  const lines = res.output.split('\n').filter((l) => /ESTAB|ESTABLISHED/.test(l) || /Local|Peer|Proto/.test(l));
  return { ok: true, output: (lines.slice(0, 200).join('\n')) || '(no established connections)' };
}

async function recentLogins() {
  const res = await run('last', []);
  if (!res.ok) return res;
  return { ok: true, output: res.output.split('\n').slice(0, 20).join('\n') };
}

function runningServices() {
  return IS_LINUX
    ? run('systemctl', ['list-units', '--type=service', '--state=running', '--no-pager', '--no-legend'])
    : run('launchctl', ['list']);
}

async function topSnapshot() {
  const res = IS_LINUX ? await run('top', ['-bn1']) : await run('top', ['-l', '1', '-n', '15']);
  if (!res.ok) return res;
  return { ok: true, output: res.output.split('\n').slice(0, 30).join('\n') };
}

// DNS lookup of a user-given domain (dig, else nslookup).
async function dnsLookup(arg) {
  const host = validHost(arg);
  if (!host) return { ok: false, output: 'Usage: dns <domain>  (e.g. dns glamofashion.com)' };
  const dig = await run('dig', ['+nocmd', '+noall', '+answer', host, 'ANY']);
  if (dig.ok && dig.output && dig.output !== '(no output)') return dig;
  return run('nslookup', [host]); // host is validated — no leading dash possible
}

function pingHost(arg) {
  const host = validHost(arg);
  if (!host) return { ok: false, output: 'Usage: ping <host>  (e.g. ping 1.1.1.1)' };
  return run('ping', ['-c', '4', '--', host]);
}

function whoisLookup(arg) {
  const host = validHost(arg);
  if (!host) return { ok: false, output: 'Usage: whois <domain>' };
  return run('whois', ['--', host]);
}

// TLS certificate of host:443 — done with Node's tls (no external binary, and
// only a handshake, so it can't be used to pull back internal HTTP content).
function sslCheck(arg) {
  const host = validHost(arg);
  if (!host) return Promise.resolve({ ok: false, output: 'Usage: ssl <host>  (e.g. ssl glamofashion.com)' });
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 12000, rejectUnauthorized: false }, () => {
      const c = socket.getPeerCertificate();
      socket.end();
      if (!c || !c.subject) return resolve({ ok: false, output: 'No certificate returned.' });
      resolve({ ok: true, output: [
        `Host     : ${host}`,
        `Subject  : ${c.subject.CN || '(none)'}`,
        `Issuer   : ${[c.issuer?.O, c.issuer?.CN].filter(Boolean).join(' · ') || '(none)'}`,
        `Valid    : ${c.valid_from}  →  ${c.valid_to}`,
        `Alt names: ${(c.subjectaltname || '').replace(/DNS:/g, '').trim() || '(none)'}`,
      ].join('\n') });
    });
    socket.on('error', (e) => resolve({ ok: false, output: `TLS error: ${e.message}` }));
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, output: 'Connection timed out.' }); });
  });
}

// HTTP response headers of THIS app only (localhost) — safe, no SSRF.
function selfHeaders() {
  const port = process.env.PORT || 3000;
  return run('curl', ['-sS', '-I', '-m', '8', `http://127.0.0.1:${port}/login`]);
}

// Walk the app folder (skipping heavy/secret dirs) and "scan" every file. Pure
// read-only: it lists real files and their sizes, nothing is opened or changed.
// The browser reveals the lines one by one for a scanning effect.
const SCAN_SKIP = ['node_modules', '.next', '.git', 'downloads', 'credentials', 'public/tesseract', 'public/pdfjs', 'public/system-tracker'];

async function walkFiles(dir, acc) {
  if (acc.files.length >= 600) return;
  let items;
  try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const abs = path.join(dir, it.name);
    const rel = path.relative(PROJECT_ROOT, abs);
    if (SCAN_SKIP.some((d) => rel === d || rel.startsWith(`${d}${path.sep}`))) continue;
    if (it.isDirectory()) { acc.dirs += 1; await walkFiles(abs, acc); }
    else if (it.isFile()) acc.files.push(rel);
  }
}

async function scanProject() {
  const acc = { files: [], dirs: 0 };
  await walkFiles(PROJECT_ROOT, acc);
  acc.files.sort();
  const shown = acc.files.slice(0, 250);
  let total = 0;
  const lines = [];
  for (const rel of shown) {
    let size = 0;
    try { size = (await stat(path.join(PROJECT_ROOT, rel))).size; } catch {}
    total += size;
    lines.push(`[ OK ] ${rel.length > 54 ? `…${rel.slice(-53)}` : rel.padEnd(54)}  ${humanBytes(size)}`);
  }
  return {
    ok: true,
    output: [
      `Scanning ${PROJECT_ROOT}`,
      `${acc.dirs} folders · ${acc.files.length} files`,
      '',
      ...lines,
      '',
      `—— scan complete · ${acc.files.length} files · ${acc.dirs} folders · ${humanBytes(total)} · 0 issues ——`,
    ].join('\n'),
  };
}

// The PM2 process name this app runs under in production (see deploy notes).
const PM2_APP = 'track-app';

// The allow-list. Key = action id the browser may ask for.
export const ACTIONS = {
  // ---- quick info (type these like a real terminal) ----
  help: { label: 'Help', chip: false, run: () => ({ ok: true, output: helpText() }) },
  system: { label: 'System info', run: () => systemReport() },
  pwd: { label: 'Working dir', chip: false, run: () => ({ ok: true, output: PROJECT_ROOT }) },
  whoami: { label: 'Current user', chip: false, run: () => ({ ok: true, output: os.userInfo().username }) },
  date: { label: 'Date / time', chip: false, run: () => ({ ok: true, output: new Date().toString() }) },
  uptime: { label: 'Uptime', chip: false, run: () => run('uptime', []) },
  env: { label: 'Env (safe)', run: () => safeEnv() },
  ls: {
    label: 'List files',
    arg: true, // `ls [subpath]`, restricted to the app directory
    run: (arg) => {
      const dir = safeSubpath(arg);
      if (!dir) return { ok: false, output: 'Path is outside the app directory — not allowed.' };
      return run('ls', ['-lah', '--', dir]);
    },
  },
  // `cd <subdir>` — move around INSIDE the app folder only. The browser keeps
  // the current dir; this just confirms the target is a real directory under
  // the project root (fs.stat), so you can't escape to the rest of the server.
  chdir: {
    label: 'Change dir',
    chip: false,
    arg: true,
    run: async (arg) => {
      const dir = safeSubpath(arg);
      if (!dir) return { ok: false, output: `cd: outside the app directory — not allowed` };
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) return { ok: false, output: `cd: not a directory: ${arg}` };
      } catch {
        return { ok: false, output: `cd: no such directory: ${arg}` };
      }
      // Hand back the clean path relative to the app root (browser stores it).
      const rel = path.relative(PROJECT_ROOT, dir);
      return { ok: true, output: rel };
    },
  },
  scan: { label: 'Scan files', run: () => scanProject() },
  ports: { label: 'Open ports', run: () => listeningPorts() },
  ps: { label: 'Processes', run: () => processes() },
  disk: { label: 'Disk usage', run: () => run('df', ['-h']) },
  node_version: { label: 'Node / npm versions', run: async () => {
    const node = await run('node', ['-v']);
    const npm = await run('npm', ['-v']);
    return { ok: true, output: `node ${node.output}\nnpm  ${npm.output}` };
  } },
  // ---- network / white-hat recon (read-only) ----
  netinfo: { label: 'Network / IPs', run: () => netInfo() },
  connections: { label: 'Live connections', run: () => connections() },
  who: { label: 'Who’s logged in', chip: false, run: () => run('who', []) },
  lastlogin: { label: 'Recent logins', run: () => recentLogins() },
  services: { label: 'Running services', run: () => runningServices() },
  top: { label: 'CPU / processes (top)', run: () => topSnapshot() },
  firewall: { label: 'Firewall status', run: () => (IS_LINUX ? run('ufw', ['status', 'verbose']) : ({ ok: false, output: 'ufw is Linux-only — not on this machine.' })) },
  myheaders: { label: 'My site HTTP headers', run: () => selfHeaders() },
  dns: { label: 'DNS lookup', chip: false, arg: true, argHint: 'domain', run: (a) => dnsLookup(a) },
  ping: { label: 'Ping host', chip: false, arg: true, argHint: 'host', run: (a) => pingHost(a) },
  whois: { label: 'WHOIS lookup', chip: false, arg: true, argHint: 'domain', run: (a) => whoisLookup(a) },
  ssl: { label: 'SSL cert check', chip: false, arg: true, argHint: 'host', run: (a) => sslCheck(a) },
  // ---- git ----
  git_status: { label: 'Git status', run: () => run('git', ['status', '--short', '--branch']) },
  git_log: { label: 'Recent commits', run: () => run('git', ['log', '-10', '--pretty=format:%h  %ad  %s', '--date=short']) },
  // ---- app control (PM2) ----
  pm2_status: { label: 'App status (PM2)', run: () => run('pm2', ['status']) },
  pm2_logs: { label: 'App logs (PM2)', run: () => run('pm2', ['logs', PM2_APP, '--lines', '120', '--nostream']) },
  pm2_restart: { label: 'Restart app (PM2)', danger: true, run: () => run('pm2', ['restart', PM2_APP]) },
  // ---- data ----
  db_backup: {
    label: 'Backup database (.sql)',
    download: true,
    run: async () => {
      const sql = await dumpDatabaseSql();
      return { ok: true, output: sql, filename: `my_track-${new Date().toISOString().slice(0, 10)}.sql` };
    },
  },
};

function helpText() {
  const rows = Object.entries(ACTIONS).map(([id, a]) => {
    const name = a.arg ? `${id} [${a.argHint || 'path'}]` : id;
    return `  ${name.padEnd(18)} ${a.label}${a.danger ? '  (!)' : ''}`;
  });
  return [
    'Available commands:',
    ...rows,
    '  cd [dir]           Move into a folder (inside the app only)',
    '',
    'clear — wipe the screen · ↑/↓ — history',
  ].join('\n');
}

export function projectRoot() {
  return PROJECT_ROOT;
}

// Metadata for the UI (never includes the run function). `chip:false` actions
// are typed-only (help/pwd/whoami/...), so they don't clutter the button row.
export function listActions() {
  return Object.entries(ACTIONS).map(([id, a]) => ({
    id,
    label: a.label,
    danger: Boolean(a.danger),
    download: Boolean(a.download),
    arg: Boolean(a.arg),
    chip: a.chip !== false,
  }));
}

export async function runAction(id, arg = '') {
  const action = ACTIONS[id];
  if (!action) return { ok: false, output: `Unknown action: ${id}` };
  try {
    const res = await action.run(arg);
    if (typeof res.output === 'string' && res.output.length > MAX_OUTPUT && !action.download) {
      res.output = `${res.output.slice(0, MAX_OUTPUT)}\n… (truncated)`;
    }
    return res;
  } catch (err) {
    return { ok: false, output: `Error: ${err.message}` };
  }
}
