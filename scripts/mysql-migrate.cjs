// MySQL 8.4-safe idempotent migration for the my-track2 merge.
// Reads scripts/schema.sql (MariaDB-targeted) and applies only what MySQL needs:
//   - the NEW tables (CREATE TABLE IF NOT EXISTS is MySQL-OK)
//   - NEW columns on existing tables, guarded by information_schema (MySQL has
//     no ADD COLUMN IF NOT EXISTS). Sync triggers/indexes are deferred.
const fs = require('fs');
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.trim().match(/^([^#=]+)=(.*)$/); if (m && !(m[1].trim() in process.env)) process.env[m[1].trim()] = m[2].trim(); }
const mysql = require('mysql2/promise');

const NEW_TABLES = ['desktop_devices','shared_screenshots','sync_keys','sync_state','sync_tombstones','system_events','test_feedback','test_projects','track_activity','attendance'];

function extractCreate(sql, name) {
  const re = new RegExp('CREATE TABLE IF NOT EXISTS\\s+`?' + name + '`?\\s*\\(', 'i');
  const m = re.exec(sql); if (!m) return null;
  // find matching close paren + semicolon
  let i = m.index + m[0].length, depth = 1;
  for (; i < sql.length; i++) { if (sql[i] === '(') depth++; else if (sql[i] === ')') { depth--; if (depth === 0) break; } }
  // include up to the semicolon after the closing paren (engine/charset opts)
  let j = sql.indexOf(';', i);
  return sql.slice(m.index, j + 1);
}

function parseAddColumns(sql) {
  const out = [];
  const re = /ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN IF NOT EXISTS\s+`?(\w+)`?\s+([^;]+);/gi;
  let m;
  while ((m = re.exec(sql))) out.push({ table: m[1], col: m[2], def: m[3].trim() });
  return out;
}

(async () => {
  const sql = fs.readFileSync('scripts/schema.sql', 'utf8');
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: false });
  const db = process.env.DB_NAME;
  const tableExists = async (t) => (await c.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [db, t]))[0].length > 0;
  const colExists = async (t, col) => (await c.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [db, t, col]))[0].length > 0;

  let created = 0, cols = 0, skipped = 0, errors = 0;
  await c.query("SET FOREIGN_KEY_CHECKS=0");
  // 1) new tables
  for (const t of NEW_TABLES) {
    if (await tableExists(t)) { console.log('table exists, skip:', t); continue; }
    const ddl = extractCreate(sql, t);
    if (!ddl) { console.log('!! could not extract CREATE for', t); errors++; continue; }
    try { await c.query(ddl); created++; console.log('created table:', t); }
    catch (e) { console.log('ERR create', t, '->', e.message); errors++; }
  }
  await c.query("SET FOREIGN_KEY_CHECKS=1");
  // 2) new columns on existing tables (guarded)
  const adds = parseAddColumns(sql);
  const seen = new Set();
  for (const a of adds) {
    const key = a.table + '.' + a.col; if (seen.has(key)) continue; seen.add(key);
    if (!(await tableExists(a.table))) { continue; } // table not on live at all
    if (await colExists(a.table, a.col)) { skipped++; continue; }
    try { await c.query(`ALTER TABLE \`${a.table}\` ADD COLUMN \`${a.col}\` ${a.def}`); cols++; console.log('added column:', key); }
    catch (e) { console.log('ERR column', key, '->', e.message); errors++; }
  }
  console.log(`\nDONE: tables created=${created}, columns added=${cols}, columns already present=${skipped}, errors=${errors}`);
  await c.end();
  process.exit(errors ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
