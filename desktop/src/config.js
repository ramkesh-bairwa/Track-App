// The desktop app's own settings, kept in <userData>/config.json: generated
// database passwords, the session secret and the ports last used. Created on
// first run; never leaves this computer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const secret = () => crypto.randomBytes(24).toString('base64url');

class Config {
  constructor(app) {
    this.file = path.join(app.getPath('userData'), 'config.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    let changed = false;
    for (const key of ['rootPassword', 'dbPassword', 'jwtSecret']) {
      if (!this.data[key]) {
        this.data[key] = secret();
        changed = true;
      }
    }
    if (changed) this.save();
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Readable by this user only — it holds the database passwords.
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}

module.exports = Config;
