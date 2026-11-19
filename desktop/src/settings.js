// <userData>/mytrack.env — the settings people may edit themselves (Google
// Drive keys, Pexels key…), in the same KEY=value format as the web app's
// .env. Created on first run from the bundled defaults.env, or — when running
// from source — from the project's own .env (API keys only, never the
// database settings, which the desktop app manages itself).
const fs = require('fs');
const path = require('path');

const MANAGED = /^(DB_|JWT_SECRET|PORT$|HOSTNAME$|NODE_ENV$|SCREENSHOT_|DOWNLOAD_ROOT$|MYTRACK_|NEXT_)/;
const SEED_KEYS = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'PEXELS_API_KEY'];

function parse(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || MANAGED.test(m[1])) continue;
    env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function settingsFile(app) {
  return path.join(app.getPath('userData'), 'mytrack.env');
}

function ensure(app) {
  const file = settingsFile(app);
  if (fs.existsSync(file)) return file;
  let seed = '';
  if (app.isPackaged) {
    const defaults = path.join(process.resourcesPath, 'defaults.env');
    if (fs.existsSync(defaults)) seed = fs.readFileSync(defaults, 'utf8');
  } else {
    const projectEnv = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(projectEnv)) {
      seed = fs
        .readFileSync(projectEnv, 'utf8')
        .split(/\r?\n/)
        .filter((l) => SEED_KEYS.some((k) => l.startsWith(`${k}=`)))
        .join('\n');
    }
  }
  const header = [
    '# MyTrack desktop settings. Edit, save, then restart MyTrack.',
    '# Google Drive backup: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET',
    '# (add http://localhost:<port>/api/auth/google/callback as a redirect URI',
    '#  in Google Cloud — the port is shown in Help → About MyTrack).',
    '# Image downloader: PEXELS_API_KEY',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${header}${seed.replace(/^#.*\n?/gm, '').trim()}\n`, { mode: 0o600 });
  return file;
}

exports.settingsFile = settingsFile;
exports.load = (app) => parse(fs.readFileSync(ensure(app), 'utf8'));
