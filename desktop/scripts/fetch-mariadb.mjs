#!/usr/bin/env node
// Puts a MariaDB server for each target OS into vendor/mariadb/<os>/, laid out
// the way MariaDB's own install script expects (bin/, sbin/ or scripts/,
// share/, lib/). electron-builder copies the right one into the app.
//
//   node scripts/fetch-mariadb.mjs              this computer's OS
//   node scripts/fetch-mariadb.mjs --os win     win | linux | mac | all
//
//   win    official MariaDB 10.11 zip (downloaded)
//   linux  official MariaDB 10.11 glibc tarball (downloaded) + libaio, which
//          newer Ubuntu releases no longer ship under the old name
//   mac    MariaDB doesn't publish macOS builds, so this copies the server
//          from a local install — XAMPP by default, or MARIADB_MAC_DIR — and
//          rewrites its library paths so it runs from inside the app.
//          Needs to run on a Mac (otool / install_name_tool / codesign).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(DESKTOP, 'vendor', 'mariadb');
const CACHE = path.join(DESKTOP, '.cache');
const VERSION = '10.11.19';
const LIBAIO_DEB = 'https://deb.debian.org/debian/pool/main/liba/libaio/libaio1_0.3.113-4_amd64.deb';

const HOST_OS = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
const argOs = process.argv.includes('--os') ? process.argv[process.argv.indexOf('--os') + 1] : HOST_OS;
const targets = argOs === 'all' ? ['mac', 'win', 'linux'] : [argOs];

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  console.log(`  downloading ${url}`);
  // curl is on macOS, Windows 10+ and Ubuntu, and follows redirects / resumes.
  run('curl', ['-fL', '--retry', '3', '-o', `${file}.part`, url]);
  fs.renameSync(`${file}.part`, file);
  return file;
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

function fresh(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function size(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return total;
}

// Only what the server itself needs from share/: error messages (english),
// character sets and the system-table SQL the install script runs.
function copyShare(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === 'english' || name === 'charsets' || /\.sql$/.test(name)) copy(path.join(src, name), path.join(dest, name));
  }
}

// ---------- Windows ----------
async function fetchWin() {
  const name = `mariadb-${VERSION}-winx64`;
  const zip = await download(`https://archive.mariadb.org/mariadb-${VERSION}/winx64-packages/${name}.zip`, path.join(CACHE, `${name}.zip`));
  const tmp = fresh(path.join(CACHE, 'win-extract'));
  // bsdtar (macOS, Windows 10+) reads zip; on Linux use unzip.
  if (process.platform === 'linux') run('unzip', ['-q', zip, '-d', tmp]);
  else run('tar', ['-xf', zip, '-C', tmp]);
  const src = path.join(tmp, name);
  const dest = fresh(path.join(VENDOR, 'win'));
  fs.mkdirSync(path.join(dest, 'bin'));
  for (const f of fs.readdirSync(path.join(src, 'bin'))) {
    if (/^(mariadbd|mysqld|mariadb-install-db|mysql_install_db)\.exe$/i.test(f) || /\.dll$/i.test(f)) {
      copy(path.join(src, 'bin', f), path.join(dest, 'bin', f));
    }
  }
  copyShare(path.join(src, 'share'), path.join(dest, 'share'));
  return dest;
}

// ---------- Linux ----------
async function fetchLinux() {
  const name = `mariadb-${VERSION}-linux-systemd-x86_64`;
  const tgz = await download(`https://archive.mariadb.org/mariadb-${VERSION}/bintar-linux-systemd-x86_64/${name}.tar.gz`, path.join(CACHE, `${name}.tar.gz`));
  const tmp = fresh(path.join(CACHE, 'linux-extract'));
  run('tar', ['-xzf', tgz, '-C', tmp]);
  const src = path.join(tmp, name);
  const dest = fresh(path.join(VENDOR, 'linux'));
  for (const f of ['mariadbd', 'my_print_defaults', 'resolveip']) {
    if (fs.existsSync(path.join(src, 'bin', f))) copy(path.join(src, 'bin', f), path.join(dest, 'bin', f));
  }
  for (const f of ['mariadb-install-db', 'mysql_install_db']) {
    if (fs.existsSync(path.join(src, 'scripts', f))) copy(path.join(src, 'scripts', f), path.join(dest, 'scripts', f));
  }
  copyShare(path.join(src, 'share'), path.join(dest, 'share'));
  // libaio.so.1: Ubuntu 24.04+ renamed it (libaio1t64), which stops the
  // official server from starting. Ship our own; the app points
  // LD_LIBRARY_PATH at lib/.
  const deb = await download(LIBAIO_DEB, path.join(CACHE, 'libaio1.deb'));
  const debTmp = fresh(path.join(CACHE, 'libaio-extract'));
  run('ar', ['x', deb], { cwd: debTmp });
  const data = fs.readdirSync(debTmp).find((f) => f.startsWith('data.tar'));
  run('tar', ['-xf', data], { cwd: debTmp });
  const libDir = fs.existsSync(path.join(debTmp, 'usr/lib/x86_64-linux-gnu')) ? path.join(debTmp, 'usr/lib/x86_64-linux-gnu') : path.join(debTmp, 'lib/x86_64-linux-gnu');
  fs.mkdirSync(path.join(dest, 'lib'), { recursive: true });
  const real = fs.readdirSync(libDir).find((f) => /^libaio\.so\.1\.\d/.test(f));
  fs.copyFileSync(path.join(libDir, real), path.join(dest, 'lib', 'libaio.so.1'));
  for (const f of ['bin/mariadbd', 'bin/my_print_defaults', 'bin/resolveip', 'scripts/mariadb-install-db', 'scripts/mysql_install_db']) {
    if (fs.existsSync(path.join(dest, f))) fs.chmodSync(path.join(dest, f), 0o755);
  }
  return dest;
}

// ---------- macOS ----------
const SYSTEM_LIB = /^(\/usr\/lib\/|\/System\/)/;

function deps(file) {
  return out('otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(' (')[0])
    .filter((p) => p && !SYSTEM_LIB.test(p) && !p.startsWith('@'));
}

async function fetchMac() {
  if (process.platform !== 'darwin') throw new Error('The macOS database has to be prepared on a Mac.');
  const src = process.env.MARIADB_MAC_DIR || '/Applications/XAMPP/xamppfiles';
  const mysqld = ['sbin/mariadbd', 'sbin/mysqld', 'bin/mariadbd', 'bin/mysqld'].map((p) => path.join(src, p)).find((p) => fs.existsSync(p));
  if (!mysqld) {
    throw new Error(`No MariaDB server found in ${src}. Install XAMPP, or set MARIADB_MAC_DIR to a MariaDB install (the folder that has bin/ and share/).`);
  }
  const dest = fresh(path.join(VENDOR, 'mac'));
  copy(mysqld, path.join(dest, 'sbin', 'mysqld'));
  for (const f of ['my_print_defaults', 'resolveip']) copy(path.join(src, 'bin', f), path.join(dest, 'bin', f));
  const script = ['bin/mariadb-install-db', 'bin/mysql_install_db', 'scripts/mariadb-install-db'].map((p) => path.join(src, p)).find((p) => fs.existsSync(p));
  copy(script, path.join(dest, 'bin', 'mysql_install_db'));
  // Pick the folder holding *this* server's files: maria_add_gis_sp.sql only
  // ships with MariaDB. (XAMPP also has a stale share/mysql left over from an
  // old MySQL — its SQL and error messages don't match the server.)
  const shareDirs = [path.join(src, 'share', 'mariadb'), path.join(src, 'share'), path.join(src, 'share', 'mysql')];
  const share =
    shareDirs.find((d) => fs.existsSync(path.join(d, 'maria_add_gis_sp.sql')) && fs.existsSync(path.join(d, 'english', 'errmsg.sys'))) ||
    shareDirs.find((d) => fs.existsSync(path.join(d, 'mysql_system_tables.sql')));
  copyShare(share, path.join(dest, 'share', 'mysql'));

  // Bundle every non-system library the binaries load (recursively) into
  // lib/, and point the binaries and libraries at those copies.
  const libDir = path.join(dest, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const bins = ['sbin/mysqld', 'bin/my_print_defaults', 'bin/resolveip'].map((p) => path.join(dest, p));
  const seen = new Map(); // original path → bundled file name
  const queue = bins.flatMap(deps);
  while (queue.length) {
    const lib = queue.shift();
    if (seen.has(lib)) continue;
    const name = path.basename(lib);
    seen.set(lib, name);
    const copyTo = path.join(libDir, name);
    fs.copyFileSync(fs.realpathSync(lib), copyTo);
    fs.chmodSync(copyTo, 0o755);
    queue.push(...deps(lib));
  }
  for (const bin of bins) {
    for (const lib of deps(bin)) run('install_name_tool', ['-change', lib, `@executable_path/../lib/${seen.get(lib)}`, bin]);
  }
  for (const [orig, name] of seen) {
    const file = path.join(libDir, name);
    run('install_name_tool', ['-id', `@loader_path/${name}`, file]);
    for (const lib of deps(file)) run('install_name_tool', ['-change', lib, `@loader_path/${seen.get(lib)}`, file]);
    void orig;
  }
  // Changing a binary invalidates its signature; macOS refuses to run
  // unsigned code on Apple Silicon, so re-sign everything ad hoc.
  for (const f of [...bins, ...[...seen.values()].map((n) => path.join(libDir, n))]) {
    run('codesign', ['--force', '--sign', '-', f], { stdio: 'ignore' });
  }
  for (const f of [...bins, path.join(dest, 'bin', 'mysql_install_db')]) fs.chmodSync(f, 0o755);
  return dest;
}

const fetchers = { win: fetchWin, linux: fetchLinux, mac: fetchMac };
for (const target of targets) {
  if (!fetchers[target]) {
    console.error(`Unknown --os "${target}". Use win, linux, mac or all.`);
    process.exit(1);
  }
  console.log(`MariaDB for ${target}…`);
  const dir = await fetchers[target]();
  console.log(`  ready: ${path.relative(DESKTOP, dir)} (${(size(dir) / 1024 / 1024).toFixed(1)} MB)`);
}
void os;
