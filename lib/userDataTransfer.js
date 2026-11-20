// Moves one account's data between MyTrack installs (the website and the
// desktop app each have their own database). Export writes everything the
// user owns to a JSON file; import loads such a file into the signed-in
// account, giving every row a new id and fixing up the references between
// them. People on the user's task boards are matched by email and created
// when the other install doesn't have them yet.
import { randomUUID, randomBytes } from 'crypto';
import { getPool } from './db';
import { hashPassword } from './auth';
import { TASK_COLLABORATORS_KEY } from './taskConfig';

export const EXPORT_FORMAT = 'mytrack-export';
export const EXPORT_VERSION = 1;

// In insert order (parents first). `owner`: column holding the user's id.
// `parents`: column → table it points into. `self`: a column pointing into
// the same table (filled in after every row exists). `people`: columns
// holding some user's id. `uuid`: kept when free, replaced when taken.
const TABLES = [
  { table: 'tracks', owner: 'user_id', self: 'parent_id', uuid: 'uuid' },
  { table: 'track_columns', parents: { track_id: 'tracks' } },
  { table: 'track_entries', parents: { track_id: 'tracks' }, uuid: 'uuid' },
  { table: 'notes', owner: 'user_id', self: 'parent_id', uuid: 'uuid' },
  { table: 'code_snippets', owner: 'user_id', uuid: 'uuid' },
  { table: 'code_versions', parents: { snippet_id: 'code_snippets' } },
  { table: 'calendar_activities', owner: 'user_id' },
  { table: 'calendar_leaves', owner: 'user_id' },
  // INSERT IGNORE: a phone already saved here (same IMEI) is skipped.
  { table: 'user_devices', owner: 'user_id', ignoreDuplicates: true },
  { table: 'test_projects', owner: 'user_id', uuid: 'uuid' },
  { table: 'test_feedback', parents: { project_id: 'test_projects' } },
  { table: 'task_boards', owner: 'owner_id', uuid: 'uuid' },
  { table: 'task_columns', parents: { board_id: 'task_boards' } },
  { table: 'task_members', parents: { board_id: 'task_boards' }, people: ['user_id'] },
  { table: 'tasks', parents: { board_id: 'task_boards' }, uuid: 'uuid', people: ['assignee_id', 'created_by', 'updated_by'] },
  {
    table: 'task_activity',
    parents: { board_id: 'task_boards', task_id: 'tasks' },
    self: 'revert_of',
    people: ['user_id', 'reverted_by', 'note_by'],
  },
  {
    table: 'task_comments',
    parents: { board_id: 'task_boards', task_id: 'tasks', activity_id: 'task_activity' },
    people: ['user_id'],
  },
  // INSERT IGNORE: (user_id, history_key) is unique.
  { table: 'user_activity', owner: 'user_id', ignoreDuplicates: true },
];

const ACCOUNT_FIELDS = ['name', 'email', 'avatar', 'sidebar_color', 'topbar_color', 'hidden_menus'];
const PASSWORD_FIELDS = ['password', 'action_password', 'require_password_delete', 'require_password_edit', 'app_lock_password'];

const isMissingTable = (err) => err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR';

// dateStrings: dates travel as the database wrote them ("2026-10-29 10:51:45"),
// not as JS Dates shifted to UTC.
async function select(conn, sql, values = []) {
  const [rows] = await conn.query({ sql, values, dateStrings: true });
  return rows;
}

function idsOf(rows) {
  return rows.map((r) => r.id);
}

// ---------- export ----------

export async function exportUserData(userId) {
  const conn = await getPool().getConnection();
  try {
    const [account] = await select(conn, `SELECT * FROM users WHERE id = ?`, [userId]);
    if (!account) throw new Error('Account not found.');

    const tables = {};
    for (const spec of TABLES) {
      let rows = [];
      try {
        if (spec.owner) {
          rows = await select(conn, `SELECT * FROM \`${spec.table}\` WHERE \`${spec.owner}\` = ? ORDER BY id`, [userId]);
        } else {
          // Rows belonging to a parent already exported (e.g. a track's entries).
          const [col, parentTable] = Object.entries(spec.parents)[0];
          const parentIds = idsOf(tables[parentTable] || []);
          if (parentIds.length) {
            rows = await select(conn, `SELECT * FROM \`${spec.table}\` WHERE \`${col}\` IN (?) ORDER BY id`, [parentIds]);
          }
        }
      } catch (err) {
        if (!isMissingTable(err)) throw err;
      }
      tables[spec.table] = rows;
    }

    // Everyone the boards mention, so the import can find or create them.
    const personIds = new Set();
    for (const spec of TABLES) {
      for (const row of tables[spec.table]) {
        for (const col of spec.people || []) if (row[col]) personIds.add(row[col]);
      }
    }
    for (const task of tables.tasks) {
      for (const id of collaboratorsOf(task.data)) personIds.add(id);
    }
    personIds.delete(userId);
    const people = personIds.size
      ? await select(conn, 'SELECT id, name, email FROM users WHERE id IN (?)', [[...personIds]])
      : [];

    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      account: {
        id: account.id,
        ...Object.fromEntries([...ACCOUNT_FIELDS, ...PASSWORD_FIELDS].map((f) => [f, account[f] ?? null])),
      },
      people,
      tables,
    };
  } finally {
    conn.release();
  }
}

// Row counts per table, for the confirmation screen.
export function summarize(payload) {
  return Object.fromEntries(Object.entries(payload?.tables || {}).map(([t, rows]) => [t, Array.isArray(rows) ? rows.length : 0]));
}

// ---------- import ----------

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function collaboratorsOf(data) {
  const list = parseJsonValue(data, {})?.[TASK_COLLABORATORS_KEY];
  return Array.isArray(list) ? list.map(Number) : [];
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || payload.format !== EXPORT_FORMAT) {
    return 'This is not a MyTrack export file.';
  }
  if (payload.version > EXPORT_VERSION) return 'This file was made by a newer MyTrack. Update this app first.';
  if (!payload.tables || typeof payload.tables !== 'object') return 'The export file has no data in it.';
  return null;
}

// Deletes everything the user owns that an import would bring in.
async function deleteUserData(conn, userId) {
  const boards = `SELECT id FROM task_boards WHERE owner_id = ${Number(userId)}`;
  const steps = [
    `DELETE FROM task_comments WHERE board_id IN (${boards})`,
    `DELETE FROM task_activity WHERE board_id IN (${boards})`,
    `DELETE FROM tasks WHERE board_id IN (${boards})`,
    `DELETE FROM task_members WHERE board_id IN (${boards})`,
    `DELETE FROM task_columns WHERE board_id IN (${boards})`,
    'DELETE FROM task_boards WHERE owner_id = ?',
    'DELETE FROM track_entries WHERE track_id IN (SELECT id FROM tracks WHERE user_id = ?)',
    'DELETE FROM track_columns WHERE track_id IN (SELECT id FROM tracks WHERE user_id = ?)',
    'DELETE FROM tracks WHERE user_id = ?',
    'DELETE FROM code_versions WHERE snippet_id IN (SELECT id FROM code_snippets WHERE user_id = ?)',
    'DELETE FROM code_snippets WHERE user_id = ?',
    'DELETE FROM notes WHERE user_id = ?',
    'DELETE FROM calendar_activities WHERE user_id = ?',
    'DELETE FROM calendar_leaves WHERE user_id = ?',
    'DELETE FROM user_devices WHERE user_id = ?',
    'DELETE FROM test_feedback WHERE project_id IN (SELECT id FROM test_projects WHERE user_id = ?)',
    'DELETE FROM test_projects WHERE user_id = ?',
    'DELETE FROM user_activity WHERE user_id = ?',
  ];
  for (const sql of steps) {
    try {
      await conn.query(sql, sql.includes('?') ? [userId] : []);
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }
  }
}

async function tableColumns(conn) {
  const rows = await select(
    conn,
    'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE()'
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.t)) map.set(r.t, new Set());
    map.get(r.t).add(r.c);
  }
  return map;
}

// Old user id (from the file) → user id here. The exporting account maps to
// the signed-in user; others by email, created when missing.
async function mapPeople(conn, payload, user, stats) {
  const map = new Map();
  if (payload.account?.id) map.set(Number(payload.account.id), user.id);
  for (const person of Array.isArray(payload.people) ? payload.people : []) {
    const email = String(person.email || '').trim().toLowerCase();
    if (!email) continue;
    if (email === String(user.email).toLowerCase()) {
      map.set(Number(person.id), user.id);
      continue;
    }
    const [existing] = await select(conn, 'SELECT id FROM users WHERE LOWER(email) = ?', [email]);
    if (existing) {
      map.set(Number(person.id), existing.id);
      continue;
    }
    // Nobody knows this password — the admin sets one from the Users page.
    const [res] = await conn.query('INSERT INTO users (name, email, password, created_by) VALUES (?, ?, ?, ?)', [
      String(person.name || email).slice(0, 255),
      email,
      await hashPassword(randomBytes(24).toString('base64url')),
      user.id,
    ]);
    map.set(Number(person.id), res.insertId);
    stats.peopleCreated.push(email);
  }
  return map;
}

const toDb = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

// User ids inside JSON columns.
function remapJson(table, row, person) {
  const mapId = (id) => person.get(Number(id)) ?? null;
  const mapList = (list) => (Array.isArray(list) ? list.map(mapId).filter((id) => id !== null) : list);
  if (table === 'tasks' && row.data) {
    const data = parseJsonValue(row.data, null);
    if (data && Array.isArray(data[TASK_COLLABORATORS_KEY])) {
      data[TASK_COLLABORATORS_KEY] = mapList(data[TASK_COLLABORATORS_KEY]);
      row.data = JSON.stringify(data);
    }
  }
  if (table === 'task_activity' && row.changes) {
    const changes = parseJsonValue(row.changes, null);
    if (Array.isArray(changes)) {
      for (const c of changes) {
        if (c.key === 'assignee_id') {
          c.old = c.old == null ? c.old : mapId(c.old);
          c.new = c.new == null ? c.new : mapId(c.new);
        } else if (c.key === `data.${TASK_COLLABORATORS_KEY}`) {
          c.old = mapList(c.old);
          c.new = mapList(c.new);
        }
      }
      row.changes = JSON.stringify(changes);
    }
  }
  if (table === 'task_comments' && row.mentions) {
    const mentions = parseJsonValue(row.mentions, null);
    if (Array.isArray(mentions)) {
      row.mentions = JSON.stringify(mentions.map((m) => ({ ...m, id: mapId(m.id) })).filter((m) => m.id !== null));
    }
  }
}

// mode: 'replace' (wipe this account's data first) or 'merge' (add copies).
// usePassword: also take the password and privacy settings from the file.
export async function importUserData(user, payload, { mode = 'merge', usePassword = false } = {}) {
  const problem = validatePayload(payload);
  if (problem) throw new ImportError(problem);

  const stats = { added: {}, skipped: {}, peopleCreated: [] };
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const columns = await tableColumns(conn);
    if (mode === 'replace') await deleteUserData(conn, user.id);
    const person = await mapPeople(conn, payload, user, stats);
    const ids = {}; // table → Map(old id → new id)
    const selfLinks = []; // [table, column, newId, oldTargetId]

    for (const spec of TABLES) {
      const rows = Array.isArray(payload.tables[spec.table]) ? payload.tables[spec.table] : [];
      const target = columns.get(spec.table);
      ids[spec.table] = new Map();
      if (!target || rows.length === 0) {
        if (rows.length) stats.skipped[spec.table] = rows.length;
        continue;
      }
      let added = 0;
      let skipped = 0;
      for (const source of rows) {
        const row = { ...source };
        const oldId = row.id;
        delete row.id;
        // An imported row is a new, independent copy — it must not carry the
        // source's sync identity, or re-importing (or importing a row that was
        // already synced to this database) collides with the uq_*_sync_id
        // unique index. Dropped here, it defaults to NULL and the sync layer
        // assigns a fresh id later.
        delete row.sync_id;
        delete row.sync_at;
        if (spec.owner) row[spec.owner] = user.id;
        let orphan = false;
        for (const [col, parentTable] of Object.entries(spec.parents || {})) {
          if (row[col] === null || row[col] === undefined) continue;
          const mapped = ids[parentTable]?.get(row[col]);
          // A comment's task may be gone; a missing board or track is fatal for the row.
          if (mapped === undefined && col === Object.keys(spec.parents)[0]) orphan = true;
          row[col] = mapped ?? null;
        }
        if (orphan) {
          skipped += 1;
          continue;
        }
        for (const col of spec.people || []) {
          if (row[col] !== null && row[col] !== undefined) row[col] = person.get(Number(row[col])) ?? null;
        }
        if (spec.self && row[spec.self] !== null && row[spec.self] !== undefined) {
          selfLinks.push([spec.table, spec.self, null, row[spec.self], oldId]);
          row[spec.self] = null;
        }
        if (spec.uuid && row[spec.uuid]) {
          const [taken] = await select(conn, `SELECT 1 AS x FROM \`${spec.table}\` WHERE \`${spec.uuid}\` = ? LIMIT 1`, [row[spec.uuid]]);
          if (taken) row[spec.uuid] = randomUUID();
        }
        remapJson(spec.table, row, person);

        const keys = Object.keys(row).filter((k) => target.has(k));
        const [res] = await conn.query(
          `INSERT ${spec.ignoreDuplicates ? 'IGNORE ' : ''}INTO \`${spec.table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (?)`,
          [keys.map((k) => toDb(row[k]))]
        );
        if (res.affectedRows === 0) {
          skipped += 1;
          continue;
        }
        ids[spec.table].set(oldId, res.insertId);
        added += 1;
      }
      stats.added[spec.table] = added;
      if (skipped) stats.skipped[spec.table] = skipped;
    }

    // Parent tracks / notes and reverted log entries, now that all rows exist.
    for (const [table, col, , oldTarget, oldId] of selfLinks) {
      const newId = ids[table].get(oldId);
      const newTarget = ids[table].get(oldTarget);
      if (newId && newTarget) await conn.query(`UPDATE \`${table}\` SET \`${col}\` = ? WHERE id = ?`, [newTarget, newId]);
    }

    if (usePassword && payload.account?.password) {
      const userCols = columns.get('users') || new Set();
      const fields = [...PASSWORD_FIELDS, ...ACCOUNT_FIELDS.filter((f) => f !== 'email')].filter(
        (f) => userCols.has(f) && payload.account[f] !== undefined
      );
      if (fields.length) {
        await conn.query(`UPDATE users SET ${fields.map((f) => `\`${f}\` = ?`).join(', ')} WHERE id = ?`, [
          ...fields.map((f) => toDb(payload.account[f])),
          user.id,
        ]);
      }
      stats.passwordCopied = true;
    }

    await conn.commit();
    return stats;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export class ImportError extends Error {}
