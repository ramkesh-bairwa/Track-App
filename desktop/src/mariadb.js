// Runs the bundled MariaDB server for the desktop app. The database lives in
// the app's data folder on this computer (<userData>/database), listens only
// on 127.0.0.1, and starts / stops with the app.
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const mysql = require('./mysql');

const isWin = process.platform === 'win32';

function firstExisting(base, candidates) {
  return candidates.map((c) => path.join(base, c)).find((p) => fs.existsSync(p)) || null;
}

// Where the server binaries are: inside the installed app, or vendor/ when
// running from source (`npm start`).
function mariadbBase(app) {
  if (app.isPackaged) return path.join(process.resourcesPath, 'mariadb');
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
  return path.join(__dirname, '..', 'vendor', 'mariadb', os);
}

// MariaDB's install script splits paths at spaces, so a server inside e.g.
// "/Volumes/MyTrack 1.0.0/…" (run straight from the DMG) or a folder with a
// space can't be set up. Reach it through a space-free link in the temp
// folder instead (a junction on Windows — no admin rights needed).
function spaceFreePath(target, name) {
  if (!/\s/.test(target)) return target;
  const link = path.join(require('os').tmpdir(), `${name}-${process.getuid?.() ?? process.env.USERNAME ?? 'user'}`);
  if (/\s/.test(link)) return target; // nowhere better to put it
  try {
    if (fs.realpathSync(link) === fs.realpathSync(target)) return link;
  } catch {
    // missing or broken link — recreate below
  }
  fs.rmSync(link, { recursive: false, force: true });
  fs.symlinkSync(target, link, isWin ? 'junction' : 'dir');
  return link;
}

function binaries(base) {
  const exe = isWin ? '.exe' : '';
  const server = firstExisting(base, [`bin/mariadbd${exe}`, `sbin/mysqld${exe}`, `bin/mysqld${exe}`, `sbin/mariadbd${exe}`]);
  const installer = isWin
    ? firstExisting(base, ['bin/mariadb-install-db.exe', 'bin/mysql_install_db.exe'])
    : firstExisting(base, ['scripts/mariadb-install-db', 'bin/mysql_install_db', 'scripts/mysql_install_db', 'bin/mariadb-install-db']);
  const share = firstExisting(base, ['share/mysql', 'share/mariadb', 'share']);
  if (!server || !installer) throw new Error(`The bundled database is missing from ${base}. Run "npm run fetch-db" in desktop/.`);
  return { server, installer, share };
}

// Something already answering on the port (e.g. a Docker database bound to
// all addresses) — binding 127.0.0.1 alone can still succeed on macOS, so
// check both ways.
function answers(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(800, () => {
      s.destroy();
      resolve(false);
    });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

function canListen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(null));
    srv.listen(port, '127.0.0.1', () => {
      const { port: got } = srv.address();
      srv.close(() => resolve(got));
    });
  });
}

async function freePort(preferred) {
  if (preferred && !(await answers(preferred)) && (await canListen(preferred))) return preferred;
  for (let i = 0; i < 20; i += 1) {
    const port = await canListen(0);
    if (port && !(await answers(port))) return port;
  }
  throw new Error('No free port for the database.');
}

function runToEnd(cmd, args, env, logFile) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      fs.appendFileSync(logFile, `\n$ ${path.basename(cmd)} ${args.join(' ')}\n${stdout}${stderr}`);
      if (err) reject(new Error(`Setting up the database failed — see ${logFile}\n${stderr || err.message}`));
      else resolve();
    });
  });
}

class Database {
  constructor(app, config) {
    this.app = app;
    this.config = config; // persisted settings (see config.js)
    this.dir = path.join(app.getPath('userData'), 'database');
    this.dataDir = path.join(this.dir, 'data');
    this.logFile = path.join(this.dir, 'mariadb.log');
    this.proc = null;
    this.port = null;
  }

  env(base) {
    const env = { ...process.env };
    // Linux: the bundled libaio.so.1 (see fetch-mariadb.mjs).
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [path.join(base, 'lib'), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    return env;
  }

  // First run only: create the system tables in an empty data folder.
  async initialize(base, bin) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.dataDir}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    const env = this.env(base);
    if (isWin) {
      // Sets root's password itself.
      await runToEnd(bin.installer, [`--datadir=${tmp}`, `--password=${this.config.get('rootPassword')}`], env, this.logFile);
    } else {
      await runToEnd(
        '/bin/sh',
        [
          bin.installer,
          '--no-defaults',
          `--basedir=${base}`,
          `--datadir=${tmp}`,
          '--auth-root-authentication-method=normal',
          '--skip-test-db',
          '--skip-name-resolve',
          '--force',
        ],
        env,
        this.logFile
      );
    }
    // Only a fully set-up folder becomes the real one, so an interrupted
    // first run is simply retried next time.
    fs.renameSync(tmp, this.dataDir);
    this.config.set('dbInitialized', false); // accounts not secured yet
  }

  // A server left running by a crashed earlier session still holds the data
  // folder's lock, so a new one couldn't start — stop it first.
  async stopLeftover() {
    const pidFile = path.join(this.dir, 'mariadb.pid');
    let pid;
    try {
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    } catch {
      return;
    }
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    if (!pid || !alive()) return;
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 60 && alive(); i += 1) await new Promise((r) => setTimeout(r, 250));
    if (alive()) process.kill(pid, 'SIGKILL');
  }

  async start() {
    const base = spaceFreePath(mariadbBase(this.app), 'mytrack-mariadb');
    const bin = binaries(base);
    await this.stopLeftover();
    if (!fs.existsSync(path.join(this.dataDir, 'mysql'))) await this.initialize(base, bin);

    this.port = await freePort(this.config.get('dbPort') || 3307);
    this.config.set('dbPort', this.port);

    const args = [
      '--no-defaults',
      `--basedir=${base}`,
      `--datadir=${this.dataDir}`,
      `--lc-messages-dir=${bin.share}`,
      `--port=${this.port}`,
      '--bind-address=127.0.0.1',
      '--skip-name-resolve',
      `--log-error=${this.logFile}`,
      `--pid-file=${path.join(this.dir, 'mariadb.pid')}`,
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
      '--max-allowed-packet=64M',
      '--innodb-buffer-pool-size=128M',
      '--innodb-log-file-size=48M',
    ];
    // Unix: a short socket path (macOS limits it to ~100 characters).
    if (!isWin) args.push(`--socket=${path.join(require('os').tmpdir(), `mytrack-${process.getuid?.() ?? 0}.sock`)}`);

    fs.mkdirSync(this.dir, { recursive: true });
    this.logStart = fs.existsSync(this.logFile) ? fs.statSync(this.logFile).size : 0;
    this.proc = spawn(bin.server, args, { env: this.env(base), stdio: 'ignore', windowsHide: true });
    this.proc.on('exit', (code) => {
      this.proc = null;
      this.exitCode = code;
    });
    await this.waitUntilReady();
    await this.secureAccounts();
  }

  // Ready when *our* server says so in its log (an answer on the port alone
  // could come from some other program).
  newLog() {
    try {
      const fd = fs.openSync(this.logFile, 'r');
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.max(0, size - this.logStart));
      fs.readSync(fd, buf, 0, buf.length, this.logStart);
      fs.closeSync(fd);
      return buf.toString('utf8');
    } catch {
      return '';
    }
  }

  async waitUntilReady(timeoutMs = 90000) {
    const started = Date.now();
    for (;;) {
      if (!this.proc) {
        const bind = /Bind on TCP\/IP port|Address already in use/i.test(this.newLog());
        throw new Error(bind ? `The database couldn't use port ${this.port} — please restart the app.` : `The database stopped while starting — see ${this.logFile}`);
      }
      if (/ready for connections/i.test(this.newLog()) && (await answers(this.port))) return;
      if (Date.now() - started > timeoutMs) throw new Error(`The database didn't start in time — see ${this.logFile}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // After the first start: give root a random password and create the app's
  // own account, so nothing is reachable without a password.
  async secureAccounts() {
    const rootPassword = this.config.get('rootPassword');
    const appPassword = this.config.get('dbPassword');
    if (this.config.get('dbInitialized')) return;
    const conn = await mysql.connect({ port: this.port, user: 'root', password: isWin ? rootPassword : '' });
    try {
      await conn.query("CREATE USER IF NOT EXISTS 'mytrack'@'127.0.0.1' IDENTIFIED BY ?", [appPassword]);
      await conn.query("ALTER USER 'mytrack'@'127.0.0.1' IDENTIFIED BY ?", [appPassword]);
      await conn.query("GRANT ALL PRIVILEGES ON *.* TO 'mytrack'@'127.0.0.1'");
      const [roots] = await conn.query("SELECT Host FROM mysql.user WHERE User = 'root'");
      // root@<this computer's name> can't be changed while name lookups are
      // off (and isn't needed) — remove it, and any other root that fails.
      for (const { Host } of roots) {
        try {
          await conn.query('ALTER USER ?@? IDENTIFIED BY ?', ['root', Host, rootPassword]);
        } catch {
          await conn.query('DROP USER ?@?', ['root', Host]).catch(() => {});
        }
      }
      await conn.query("DELETE FROM mysql.global_priv WHERE User = ''").catch(() => {});
      await conn.query('FLUSH PRIVILEGES');
    } finally {
      await conn.end();
    }
    this.config.set('dbInitialized', true);
  }

  credentials() {
    return { host: '127.0.0.1', port: this.port, user: 'mytrack', password: this.config.get('dbPassword'), database: 'my_track' };
  }

  // Creates the app database and applies schema.sql — safe to run on every
  // start (every statement in it is "if not exists").
  async migrate(schemaFile) {
    const conn = await mysql.connect({ port: this.port, user: 'mytrack', password: this.config.get('dbPassword'), multipleStatements: true });
    try {
      await conn.query('CREATE DATABASE IF NOT EXISTS `my_track` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      await conn.query('USE `my_track`');
      await conn.query(fs.readFileSync(schemaFile, 'utf8'));
    } finally {
      await conn.end();
    }
  }

  // Clean shutdown (flushes InnoDB), falling back to a kill.
  async stop() {
    if (!this.proc) return;
    const proc = this.proc;
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    try {
      const conn = await mysql.connect({ port: this.port, user: 'mytrack', password: this.config.get('dbPassword') });
      await conn.query('SHUTDOWN').catch(() => {});
      await conn.end().catch(() => {});
    } catch {
      proc.kill();
    }
    const timer = setTimeout(() => proc.kill('SIGKILL'), 20000);
    await exited;
    clearTimeout(timer);
  }
}

Database.newSecret = () => crypto.randomBytes(24).toString('base64url');
Database.freePort = freePort;

module.exports = Database;
