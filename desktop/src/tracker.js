// Screenshot tracker for the desktop app — the cross-platform version of
// scripts/screenshot-tracker (macOS only). Same folder layout and the same
// on / off switch, so the Screenshots page works unchanged:
//
//   <dir>/<account email>/.enabled                 switched on (the page creates / removes it)
//   <dir>/<account email>/YYYY-MM-DD/HH-MM-SS.jpg  one per display (-display2.jpg …)
//   <dir>/<account email>/.status.json             how the last run went
//
// While any account is switched on it captures every 5 minutes, and MyTrack
// opens by itself at login so that keeps going after a restart.
const fs = require('fs');
const path = require('path');
const { app, desktopCapturer, powerMonitor, screen, systemPreferences } = require('electron');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const CHECK_MS = 15 * 1000; // how quickly a flipped switch is noticed
const MAX_SIDE = 1920;
const KEEP_DAYS = 60;

const pad = (n) => String(n).padStart(2, '0');

class Tracker {
  constructor(root, { onEnabledChange } = {}) {
    this.root = root;
    this.onEnabledChange = onEnabledChange;
    this.lastShot = new Map(); // folder → time of last capture
    this.enabled = new Set();
    this.locked = false;
    this.busy = false;
    this.intervalMs = DEFAULT_INTERVAL_MS;
  }

  // Set by an admin on the server (lib/agent.js): minutes between screenshots.
  setIntervalMinutes(minutes) {
    const m = Math.min(120, Math.max(1, Number(minutes) || 5));
    this.intervalMs = m * 60 * 1000;
  }

  // "Take a screenshot now" from the server: into that account's folder,
  // whether or not its switch is on.
  async captureNow(email) {
    const name = String(email || '').toLowerCase();
    if (!name || name !== path.basename(name)) return;
    const dir = path.join(this.root, name);
    fs.mkdirSync(dir, { recursive: true });
    while (this.busy) await new Promise((r) => setTimeout(r, 500));
    this.busy = true;
    try {
      await this.capture(dir);
      this.lastShot.set(dir, Date.now());
    } finally {
      this.busy = false;
    }
  }

  start() {
    fs.mkdirSync(this.root, { recursive: true });
    powerMonitor.on('lock-screen', () => (this.locked = true));
    powerMonitor.on('unlock-screen', () => (this.locked = false));
    powerMonitor.on('suspend', () => (this.locked = true));
    powerMonitor.on('resume', () => (this.locked = false));
    this.timer = setInterval(() => this.tick(), CHECK_MS);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
  }

  folders() {
    try {
      return fs
        .readdirSync(this.root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.includes('@'))
        .map((d) => path.join(this.root, d.name));
    } catch {
      return [];
    }
  }

  status(dir, state, message) {
    const file = path.join(dir, '.status.json');
    const body = { time: new Date().toISOString(), state, mode: 'screen', message };
    // Don't rewrite an unchanged "paused" every 15 seconds.
    if (state === 'paused') {
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).state === 'paused') return;
      } catch {
        // no status yet
      }
    }
    fs.writeFileSync(file, JSON.stringify(body));
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const enabled = new Set();
      for (const dir of this.folders()) {
        if (!fs.existsSync(path.join(dir, '.enabled'))) {
          this.lastShot.delete(dir);
          this.status(dir, 'paused', 'Screenshots are switched off. Turn them on from the Screenshots page.');
          continue;
        }
        enabled.add(dir);
        // Just switched on → right away; otherwise every 5 minutes.
        if (!this.lastShot.has(dir) || now - this.lastShot.get(dir) >= this.intervalMs) {
          this.lastShot.set(dir, now);
          await this.capture(dir);
        }
      }
      const changed = enabled.size !== this.enabled.size || [...enabled].some((d) => !this.enabled.has(d));
      this.enabled = enabled;
      if (changed) this.onEnabledChange?.(enabled.size > 0);
    } catch (err) {
      console.error('tracker:', err);
    } finally {
      this.busy = false;
    }
  }

  async capture(dir) {
    if (this.locked) return this.status(dir, 'skipped', 'The screen was locked.');
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      // Asking once makes macOS list MyTrack under Screen Recording.
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {});
      return this.status(
        dir,
        'no-permission',
        'MyTrack isn’t allowed to record the screen. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then restart MyTrack.'
      );
    }
    const d = new Date();
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const stamp = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    try {
      // Thumbnail size = the largest display, capped at MAX_SIDE (keeps files ~0.5 MB).
      const biggest = screen.getAllDisplays().reduce((m, x) => {
        const w = x.size.width * x.scaleFactor;
        const h = x.size.height * x.scaleFactor;
        return w * h > m.w * m.h ? { w, h } : m;
      }, { w: 0, h: 0 });
      const scale = Math.min(1, MAX_SIDE / Math.max(biggest.w, biggest.h, 1));
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(biggest.w * scale), height: Math.round(biggest.h * scale) },
      });
      const shots = sources.filter((s) => !s.thumbnail.isEmpty());
      if (shots.length === 0) return this.status(dir, 'error', 'Couldn’t capture the screen.');
      const folder = path.join(dir, day);
      fs.mkdirSync(folder, { recursive: true });
      shots.forEach((s, i) => {
        const name = i === 0 ? `${stamp}.jpg` : `${stamp}-display${i + 1}.jpg`;
        fs.writeFileSync(path.join(folder, name), s.thumbnail.toJPEG(60));
      });
      this.status(dir, 'ok', `Saved ${day}/${stamp}.jpg`);
      this.cleanup(dir);
    } catch (err) {
      this.status(dir, 'error', `Capture failed: ${err.message}`);
    }
  }

  // Day folders older than KEEP_DAYS are deleted (like capture.sh).
  cleanup(dir) {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
      const [y, m, day] = name.split('-').map(Number);
      if (new Date(y, m - 1, day).getTime() < cutoff) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  }
}

// Open MyTrack at login while any account has screenshots switched on, so
// capturing continues after a restart — and stop doing so once all are off.
function setOpenAtLogin(on) {
  // macOS: a LaunchAgent. Electron's setLoginItemSettings uses
  // SMAppService, which silently does nothing for an unsigned app.
  if (process.platform === 'darwin') {
    const file = path.join(app.getPath('home'), 'Library', 'LaunchAgents', 'com.podup.mytrack.plist');
    try {
      app.setLoginItemSettings({ openAtLogin: false }); // drop any older registration
    } catch {
      // not registered
    }
    if (on) {
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.podup.mytrack</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(process.execPath)}</string>
    <string>--hidden</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`
      );
    } else {
      fs.rmSync(file, { force: true });
    }
    return;
  }
  if (process.platform === 'linux') {
    const dir = path.join(app.getPath('home'), '.config', 'autostart');
    const file = path.join(dir, 'mytrack.desktop');
    if (on) {
      const exec = process.env.APPIMAGE || process.execPath;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=MyTrack\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else {
      fs.rmSync(file, { force: true });
    }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: on ? ['--hidden'] : [] });
}

module.exports = { Tracker, setOpenAtLogin };
