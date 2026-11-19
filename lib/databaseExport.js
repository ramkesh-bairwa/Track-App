// Downloads of the signed-in user's data — or, for admins, the whole
// database — as Excel, JSON or SQL, either with the data or empty (just the
// structure: every table and its columns, no rows).
import { getPool } from './db';
import { exportUserData } from './userDataTransfer';
import { sqlLiteral } from './backup';
import { trackExportTable } from './trackExport';

export const FORMATS = {
  xlsx: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  json: { ext: 'json', type: 'application/json; charset=utf-8' },
  sql: { ext: 'sql', type: 'application/sql; charset=utf-8' },
};

// Never shown in a spreadsheet (they stay in JSON / SQL so a restore works).
const SECRET_COLUMNS = new Set(['password', 'action_password', 'app_lock_password', 'google_refresh_token', 'secret', 'token']);
const EXCEL_CELL_MAX = 32000; // Excel's hard limit is 32,767 characters per cell.

async function select(conn, sql, values = []) {
  const [rows] = await conn.query({ sql, values, dateStrings: true });
  return rows;
}

// Every table in the database with its columns and CREATE statement.
async function readSchema(conn) {
  const tables = await select(
    conn,
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`
  );
  const columns = await select(
    conn,
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS def, COLUMN_KEY AS \`key\`, EXTRA AS extra
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const schema = {};
  for (const { name } of tables) {
    const [create] = await select(conn, `SHOW CREATE TABLE \`${name}\``);
    schema[name] = {
      create: create['Create Table'].replace(/\s+AUTO_INCREMENT=\d+/, ''),
      columns: columns
        .filter((c) => c.t === name)
        .map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable === 'YES',
          default: c.def,
          key: c.key || undefined,
          extra: c.extra || undefined,
        })),
    };
  }
  return schema;
}

// table → rows. 'mine': the user's account row plus everything they own;
// 'all': every row of every table.
async function readRows(conn, schema, userId, scope) {
  if (scope === 'all') {
    const out = {};
    for (const t of Object.keys(schema)) out[t] = await select(conn, `SELECT * FROM \`${t}\``);
    return { tables: out };
  }
  const payload = await exportUserData(userId);
  const tables = { users: await select(conn, 'SELECT * FROM users WHERE id = ?', [userId]), ...payload.tables };
  if (schema.track_activity) {
    tables.track_activity = await select(conn, 'SELECT * FROM track_activity WHERE owner_id = ? ORDER BY id', [userId]);
  }
  return { tables, payload };
}

// ---------- SQL ----------

function toSql({ schema, tables, withData, scope, label }) {
  const out = [
    `-- MyTrack ${label} — ${withData ? 'with data' : 'empty (structure only)'}`,
    `-- Exported ${new Date().toISOString()}`,
    '-- Import with: mysql -u <user> -p <database> < this-file.sql',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS=0;',
    '',
  ];
  for (const [t, info] of Object.entries(schema)) {
    out.push(`-- ${t}`);
    // A full-database backup replaces tables; anything else only adds what's missing.
    if (scope === 'all' && withData) {
      out.push(`DROP TABLE IF EXISTS \`${t}\`;`, `${info.create};`);
    } else {
      out.push(`${info.create.replace(/^CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS')};`);
    }
    const rows = withData ? tables[t] || [] : [];
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const cols = Object.keys(chunk[0]);
      out.push(
        `INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES\n` +
          chunk.map((r) => `(${cols.map((c) => sqlLiteral(r[c])).join(', ')})`).join(',\n') +
          ';'
      );
    }
    out.push('');
  }
  out.push('SET FOREIGN_KEY_CHECKS=1;', '');
  return out.join('\n');
}

// ---------- JSON ----------

function toJson({ schema, tables, payload, withData, scope }) {
  const structure = Object.fromEntries(Object.entries(schema).map(([t, info]) => [t, info.columns]));
  if (!withData) {
    return { format: 'mytrack-schema', version: 1, exported_at: new Date().toISOString(), empty: true, tables: structure };
  }
  if (scope === 'mine') {
    // Same file "Import" understands, plus the history log.
    return { ...payload, tables: { ...payload.tables, track_activity: tables.track_activity || [] } };
  }
  return { format: 'mytrack-database', version: 1, exported_at: new Date().toISOString(), schema: structure, tables };
}

// ---------- Excel ----------

function excelValue(column, value) {
  if (value === null || value === undefined) return '';
  if (SECRET_COLUMNS.has(column) && value !== '') return '(hidden)';
  if (typeof value === 'object') value = JSON.stringify(value);
  if (typeof value === 'string' && value.length > EXCEL_CELL_MAX) {
    return /^data:[^;]+;base64,/.test(value) ? `[file, ${Math.round(value.length / 1365)} KB]` : `${value.slice(0, EXCEL_CELL_MAX)}…[cut]`;
  }
  return value;
}

function parse(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// One easy-to-read tab per track: its records under the real column names.
function trackSheets(tables) {
  const columns = tables.track_columns || [];
  const entries = tables.track_entries || [];
  return (tables.tracks || []).map((track) => {
    const cols = columns.filter((c) => c.track_id === track.id).sort((a, b) => a.position - b.position || a.id - b.id);
    const rows = entries
      .filter((e) => e.track_id === track.id)
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((e) => ({ ...e, data: parse(e.data, {}) }));
    const serials = new Map(rows.map((e, i) => [e.id, i + 1]));
    const table = trackExportTable(track, cols, rows, serials);
    return { name: `Track - ${track.name}`, columns: table.columns, rows: table.rows };
  });
}

async function toExcel({ schema, tables, withData, label }) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const used = new Set();
  function addSheet(name, header, rows) {
    let base = String(name).replace(/[[\]*?:/\\]/g, '').slice(0, 31).trim() || 'Sheet';
    let n = base;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 27)} (${i})`;
    used.add(n.toLowerCase());
    const sheet = workbook.addWorksheet(n, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(header);
    rows.forEach((r) => sheet.addRow(r));
    const head = sheet.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF2' } };
    header.forEach((h, j) => {
      const longest = Math.max(String(h).length, ...rows.slice(0, 200).map((r) => Math.min(60, String(r[j] ?? '').split('\n')[0].length)));
      sheet.getColumn(j + 1).width = Math.max(10, Math.min(60, longest + 2));
    });
    if (header.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
  }

  const names = Object.keys(schema);
  addSheet(
    'Summary',
    withData ? ['Table', 'Rows', 'Columns'] : ['Table', 'Columns'],
    names.map((t) =>
      withData
        ? [t, (tables[t] || []).length, schema[t].columns.map((c) => c.name).join(', ')]
        : [t, schema[t].columns.map((c) => `${c.name} ${c.type}`).join(', ')]
    )
  );
  workbook.getWorksheet('Summary').getCell('A1').note = `MyTrack ${label} — exported ${new Date().toLocaleString()}`;

  if (withData) for (const s of trackSheets(tables)) addSheet(s.name, s.columns, s.rows);
  for (const t of names) {
    const cols = schema[t].columns.map((c) => c.name);
    const rows = withData ? (tables[t] || []).map((r) => cols.map((c) => excelValue(c, r[c]))) : [];
    addSheet(t, cols, rows);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------- entry point ----------

export async function buildExport({ userId, format, withData, scope }) {
  const conn = await getPool().getConnection();
  try {
    const schema = await readSchema(conn);
    const { tables, payload } = withData ? await readRows(conn, schema, userId, scope) : { tables: {} };
    const label = scope === 'all' ? 'database' : 'data';
    const ctx = { schema, tables, payload, withData, scope, label };
    let body;
    if (format === 'sql') body = toSql(ctx);
    else if (format === 'xlsx') body = await toExcel(ctx);
    else body = JSON.stringify(toJson(ctx), null, withData ? 0 : 2);
    const filename = `mytrack-${scope === 'all' ? 'database' : 'my-data'}-${withData ? 'with-data' : 'empty'}-${new Date()
      .toISOString()
      .slice(0, 10)}.${FORMATS[format].ext}`;
    return { body, filename, type: FORMATS[format].type };
  } finally {
    conn.release();
  }
}
