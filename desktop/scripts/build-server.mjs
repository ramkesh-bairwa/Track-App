#!/usr/bin/env node
// Builds the MyTrack web app (the folder above desktop/) into a self-contained
// Node server for the desktop app, in desktop/build/server.
//
// It builds into ../.next-desktop — never ../.next — so it can run while
// `next dev` is serving the web app from the same project.
//
//   node scripts/build-server.mjs              build, without API keys
//   node scripts/build-server.mjs --with-keys  also bundle Google Drive /
//                                             Pexels keys from ../.env
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DESKTOP, '..');
const DIST = '.next-desktop';
const OUT = path.join(DESKTOP, 'build');
const SERVER = path.join(OUT, 'server');

// User data that lives in public/ and must never ship inside the app.
const PRIVATE_PUBLIC = new Set(['system-tracker', 'testing-feedback']);
// Keys copied into defaults.env by --with-keys (never database settings).
const KEY_NAMES = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'PEXELS_API_KEY'];

function step(msg) {
  console.log(`\n▸ ${msg}`);
}

step(`Building the web app into ${DIST}/ (standalone)…`);
execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: DIST, NEXT_OUTPUT: 'standalone', NEXT_TELEMETRY_DISABLED: '1' },
});

const standalone = path.join(ROOT, DIST, 'standalone');
if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  throw new Error(`Expected ${standalone}/server.js — the standalone build didn't produce a server.`);
}

step('Assembling desktop/build/server…');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(standalone, SERVER, { recursive: true, verbatimSymlinks: false, dereference: true });
// Next leaves static assets and public/ out of the standalone folder.
fs.cpSync(path.join(ROOT, DIST, 'static'), path.join(SERVER, DIST, 'static'), { recursive: true });
fs.mkdirSync(path.join(SERVER, 'public'), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, 'public'))) {
  if (PRIVATE_PUBLIC.has(name)) continue;
  fs.cpSync(path.join(ROOT, 'public', name), path.join(SERVER, 'public', name), { recursive: true });
}
// Next's file tracing also pulls in folders the server code merely points
// at (the screenshot and testing-feedback folders) — this computer's private
// data. Strip them from the bundle.
for (const name of PRIVATE_PUBLIC) fs.rmSync(path.join(SERVER, 'public', name), { recursive: true, force: true });
// Next copies .env files into the standalone folder — they hold this
// machine's database password and keys, so they must not ship.
for (const name of fs.readdirSync(SERVER)) {
  if (name === '.env' || name.startsWith('.env.')) fs.rmSync(path.join(SERVER, name), { force: true });
}
for (const name of ['downloads', 'secrets', 'desktop']) fs.rmSync(path.join(SERVER, name), { recursive: true, force: true });

fs.copyFileSync(path.join(ROOT, 'scripts', 'schema.sql'), path.join(OUT, 'schema.sql'));

// The app ships the server as one archive: electron-builder drops every
// folder named node_modules from extra resources, and one file also installs
// faster. The app unpacks it into its data folder on first start.
step('Packing build/server.tar.gz…');
const buildId = fs.readFileSync(path.join(SERVER, DIST, 'BUILD_ID'), 'utf8').trim();
fs.writeFileSync(path.join(OUT, 'server-id.txt'), buildId);
execFileSync('tar', ['-czf', path.join(OUT, 'server.tar.gz'), '-C', SERVER, '.'], { stdio: 'inherit' });

// defaults.env seeds the app's settings file on first run.
let defaults = '# Defaults for <app data>/mytrack.env (copied there on first run).\n';
if (process.argv.includes('--with-keys')) {
  const env = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '';
  const picked = env.split('\n').filter((l) => KEY_NAMES.some((k) => l.startsWith(`${k}=`)));
  defaults += picked.join('\n') + '\n';
  console.log(`  bundled keys: ${picked.map((l) => l.split('=')[0]).join(', ') || 'none found'}`);
  console.log('  ⚠ Anyone you give this installer to can read these keys.');
}
fs.writeFileSync(path.join(OUT, 'defaults.env'), defaults);

const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((t, e) => {
    const p = path.join(dir, e.name);
    return t + (e.isDirectory() ? size(p) : e.isFile() ? fs.statSync(p).size : 0);
  }, 0);
console.log(`\n✓ desktop/build/server ready (${(size(SERVER) / 1024 / 1024).toFixed(0)} MB)`);
