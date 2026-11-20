// Bring a database's schema up to date without dropping anything: create the
// tables it is missing and add the columns it is missing, each guarded by
// information_schema so it is safe on MySQL 8.4 (which has no ADD COLUMN IF NOT
// EXISTS) and idempotent. Used after a raw SQL import, so restoring an older
// dump can't leave the live schema missing columns the app selects.
//
// It reads the same scripts/schema.sql the CLI migration (scripts/mysql-migrate.cjs)
// uses. applySchemaCompletion(conn) finds the file itself and is best-effort —
// it never throws, so it can't turn a successful import into a failure.
import fs from 'fs';
import path from 'path';

// New tables added since the first release; CREATE TABLE IF NOT EXISTS is safe.
const NEW_TABLES = [
  'desktop_devices', 'shared_screenshots', 'sync_keys', 'sync_state', 'sync_tombstones',
  'system_events', 'test_feedback', 'test_projects', 'track_activity', 'attendance',
];

function extractCreate(sql, name) {
  const re = new RegExp('CREATE TABLE IF NOT EXISTS\\s+`?' + name + '`?\\s*\\(', 'i');
  const m = re.exec(sql);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  for (; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') { depth--; if (depth === 0) break; }
  }
  const j = sql.indexOf(';', i);
  return sql.slice(m.index, j + 1);
}

function parseAddColumns(sql) {
  const out = [];
  const re = /ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN IF NOT EXISTS\s+`?(\w+)`?\s+([^;]+);/gi;
  let m;
  while ((m = re.exec(sql))) out.push({ table: m[1], col: m[2], def: m[3].trim() });
  return out;
}

function findSchemaSql() {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'schema.sql'),
    path.join(process.cwd(), 'schema.sql'),
    process.env.MYTRACK_SCHEMA_SQL,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch {
      // keep trying
    }
  }
  return null;
}

// conn: a mysql2/promise connection. db: its database name. Returns a summary;
// never throws (logs and returns { ok:false } on failure).
export async function applySchemaCompletion(conn, db) {
  try {
    const sql = findSchemaSql();
    if (!sql) return { ok: false, reason: 'schema.sql not found' };
    const schema = db || process.env.DB_NAME;
    const tableExists = async (t) =>
      (await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [schema, t]))[0].length > 0;
    const colExists = async (t, col) =>
      (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [schema, t, col]))[0].length > 0;

    let created = 0;
    let cols = 0;
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const t of NEW_TABLES) {
      if (await tableExists(t)) continue;
      const ddl = extractCreate(sql, t);
      if (!ddl) continue;
      try { await conn.query(ddl); created++; } catch { /* leave it */ }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS=1');

    const seen = new Set();
    for (const a of parseAddColumns(sql)) {
      const key = `${a.table}.${a.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!(await tableExists(a.table))) continue;
      if (await colExists(a.table, a.col)) continue;
      try { await conn.query(`ALTER TABLE \`${a.table}\` ADD COLUMN \`${a.col}\` ${a.def}`); cols++; } catch { /* leave it */ }
    }
    return { ok: true, tablesCreated: created, columnsAdded: cols };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
