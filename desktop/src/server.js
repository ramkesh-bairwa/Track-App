// Runs the MyTrack web server (Next.js standalone build) inside Electron.
//
// The server writes next to itself (Next's cache, uploaded testing
// screenshots…), and an installed app's own folder is read-only (Program
// Files, a signed .app), so each build is copied once into
// <userData>/server/<build id>/ and run from there. Data that must outlive
// app updates lives in <userData>/data and is linked in.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { utilityProcess } = require('electron');

const DIST = '.next-desktop';

// The server ships as build/server.tar.gz (+ server-id.txt with its build id).
function bundle(app) {
  const dir = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'build');
  const archive = path.join(dir, 'server.tar.gz');
  try {
    return { archive, id: fs.readFileSync(path.join(dir, 'server-id.txt'), 'utf8').trim() };
  } catch {
    throw new Error(`The app server is missing from ${dir}. Run "npm run build-server" in desktop/.`);
  }
}

// macOS has tar; Windows 10+ ships it as System32\tar.exe.
function tarCommand() {
  if (process.platform !== 'win32') return 'tar';
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sys) ? sys : 'tar';
}

// Unpacks this build into userData (once per build) and removes older copies.
function prepare(app) {
  const { archive, id } = bundle(app);
  const root = path.join(app.getPath('userData'), 'server');
  const target = path.join(root, id);
  if (!fs.existsSync(path.join(target, 'server.js'))) {
    const tmp = `${target}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    execFileSync(tarCommand(), ['-xzf', archive, '-C', tmp], { windowsHide: true });
    fs.renameSync(tmp, target);
  }
  for (const name of fs.readdirSync(root)) {
    if (name !== id) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
  // Uploaded testing screenshots are served from public/, so link the
  // persistent folder in (a junction on Windows needs no admin rights).
  const data = path.join(app.getPath('userData'), 'data');
  const keep = path.join(data, 'testing-feedback');
  const link = path.join(target, 'public', 'testing-feedback');
  fs.mkdirSync(keep, { recursive: true });
  if (!fs.existsSync(link)) fs.symlinkSync(keep, link, process.platform === 'win32' ? 'junction' : 'dir');
  return target;
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/login', timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode > 0);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

class AppServer {
  constructor(app) {
    this.app = app;
    this.proc = null;
    this.port = null;
    this.output = '';
    this.logFile = path.join(app.getPath('userData'), 'server.log');
  }

  async start({ port, env }) {
    const dir = prepare(this.app);
    this.port = port;
    fs.writeFileSync(this.logFile, `--- ${new Date().toISOString()} starting on port ${port}\n`);
    this.proc = utilityProcess.fork(path.join(dir, 'server.js'), [], {
      cwd: dir,
      stdio: 'pipe',
      serviceName: 'MyTrack server',
      env: { ...process.env, ...env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    });
    const log = (chunk) => {
      const text = chunk.toString();
      this.output = (this.output + text).slice(-8000);
      fs.appendFile(this.logFile, text, () => {});
    };
    this.proc.stdout?.on('data', log);
    this.proc.stderr?.on('data', log);
    this.proc.on('exit', (code) => {
      this.proc = null;
      this.exitCode = code;
    });

    const started = Date.now();
    for (;;) {
      if (!this.proc) throw new Error(`The MyTrack server stopped while starting.\n\n${this.output.slice(-1500)}`);
      if (await ping(port)) return;
      if (Date.now() - started > 90000) throw new Error(`The MyTrack server didn't start in time — see ${this.logFile}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async stop() {
    if (!this.proc) return;
    const proc = this.proc;
    await new Promise((resolve) => {
      proc.once('exit', resolve);
      proc.kill();
      setTimeout(resolve, 5000);
    });
  }
}

module.exports = AppServer;
