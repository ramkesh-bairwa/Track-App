import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import { query } from '@/lib/db';

const PROJECT_ROOT = process.cwd();

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// A plain SQL dump built through the app's own mysql2 connection — no
// mysqldump binary required, so it works wherever the app itself runs.
export async function dumpDatabaseSql() {
  const tables = await query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'
  );

  let sql = `-- MyTrack database backup — ${new Date().toISOString()}\nSET FOREIGN_KEY_CHECKS=0;\n\n`;
  for (const { TABLE_NAME: table } of tables) {
    const createRows = await query(`SHOW CREATE TABLE \`${table}\``);
    sql += `DROP TABLE IF EXISTS \`${table}\`;\n${createRows[0]['Create Table']};\n\n`;

    const rows = await query(`SELECT * FROM \`${table}\``);
    for (const row of rows) {
      const cols = Object.keys(row);
      const values = cols.map((c) => sqlLiteral(row[c]));
      sql += `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${values.join(', ')});\n`;
    }
    sql += '\n';
  }
  sql += 'SET FOREIGN_KEY_CHECKS=1;\n';
  return sql;
}

// The project's own source, plus a credentials/ folder holding the local
// .env — this is meant to fully restore the project, .env included, so it's
// deliberately let in here even though it's excluded from the source glob.
export async function buildCodeZip() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath) : null;

  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    if (envContent) {
      archive.append(envContent, { name: 'credentials/.env' });
    }

    archive.glob('**/*', {
      cwd: PROJECT_ROOT,
      dot: false,
      ignore: [
        'node_modules/**',
        '.next/**',
        '.git/**',
        'downloads/**',
        'secrets/**',
        '.env',
        '.env.*',
      ],
    });
    archive.finalize();
  });
}

// Exchanges the signed-in user's stored OAuth refresh token for a fresh
// access token — the upload runs as *them*, in their own Drive, rather than
// a service account's isolated storage.
async function getDriveAccessTokenForUser(refreshToken) {
  if (!refreshToken) {
    throw new Error('Google Drive is not connected. Connect it from the Backup menu first.');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || 'Could not reconnect to Google Drive.');
  return json.access_token;
}

// Uploads via a raw multipart request to the Drive v3 API instead of the
// `googleapis` SDK — keeps this to one small HTTP call instead of a very
// large dependency.
export async function uploadFileToDrive({ buffer, filename, mimeType = 'application/octet-stream', refreshToken }) {
  const accessToken = await getDriveAccessTokenForUser(refreshToken);
  const metadata = { name: filename };

  const boundary = 'mytrack-backup-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`, 'utf8'),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8'),
    buffer,
    Buffer.from(`\r\n--${boundary}--`, 'utf8'),
  ]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'Could not upload to Google Drive.');
  return json;
}
