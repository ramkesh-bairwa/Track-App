// Two-way sync between two MyTrack installs (e.g. the website and the desktop
// app). Both sides run this same code.
//
// Every synced row has a global `sync_id` and a `sync_at` the database bumps
// on every change; deletes leave a row in sync_tombstones (see schema.sql).
// A sync is: pull the other side's changes since last time and merge them
// here, then push ours there. Rows are matched by sync_id (users by email,
// some tables by their natural unique key); when both sides changed the same
// row, the newer change wins.
//
// Local numeric ids differ between installs, so every reference to another
// row (task.board_id, comment.user_id, "c:12" column keys…) travels as that
// row's sync_id and is turned back into a local id on arrival.
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { rowInScope, trimUser, canWrite, cleanIncomingUser } from './syncScope';

// Parents before children. refs: column → table it points to.
// natural: a unique key that identifies the same thing on both sides.
// json: columns holding ids inside JSON (see TRANSLATORS).
export const SYNC_TABLES = [
  { name: 'users', natural: ['email'], refs: { created_by: 'users' } },
  { name: 'tracks', natural: ['uuid'], refs: { user_id: 'users', parent_id: 'tracks' } },
  { name: 'track_columns', refs: { track_id: 'tracks' } },
  { name: 'track_entries', natural: ['uuid'], refs: { track_id: 'tracks' } },
  {
    name: 'track_activity',
    refs: { track_id: 'tracks', entry_id: 'track_entries', user_id: 'users', owner_id: 'users', revert_of: 'track_activity', reverted_by: 'users', note_by: 'users' },
  },
  { name: 'notes', natural: ['uuid'], refs: { user_id: 'users', parent_id: 'notes' } },
  { name: 'task_boards', natural: ['uuid'], refs: { owner_id: 'users' }, json: { column_order: 'columnKeys', hidden_columns: 'columnKeys' } },
  { name: 'task_columns', refs: { board_id: 'task_boards' } },
  { name: 'task_members', natural: ['board_id', 'user_id'], refs: { board_id: 'task_boards', user_id: 'users' } },
  { name: 'tasks', natural: ['uuid'], refs: { board_id: 'task_boards', assignee_id: 'users', created_by: 'users', updated_by: 'users' }, json: { data: 'taskData' } },
  {
    name: 'task_activity',
    refs: { board_id: 'task_boards', task_id: 'tasks', user_id: 'users', revert_of: 'task_activity', reverted_by: 'users', note_by: 'users' },
    json: { changes: 'activityChanges' },
  },
  { name: 'task_comments', refs: { board_id: 'task_boards', activity_id: 'task_activity', task_id: 'tasks', user_id: 'users' }, json: { mentions: 'mentions' } },
  { name: 'code_snippets', natural: ['uuid'], refs: { user_id: 'users' } },
  { name: 'code_versions', refs: { snippet_id: 'code_snippets' } },
  { name: 'calendar_leaves', refs: { user_id: 'users' } },
  { name: 'calendar_activities', refs: { user_id: 'users' } },
  { name: 'login_events', natural: ['uuid'], refs: { user_id: 'users' } },
  { name: 'user_activity', natural: ['user_id', 'history_key'], refs: { user_id: 'users' } },
  { name: 'user_devices', natural: ['user_id', 'imei'], refs: { user_id: 'users' } },
  { name: 'notifications', refs: { user_id: 'users', actor_id: 'users' } },
  { name: 'test_projects', natural: ['uuid'], refs: { user_id: 'users' } },
  { name: 'test_feedback', refs: { project_id: 'test_projects' } },
  { name: 'system_events', natural: ['uuid'] },
];
const BY_NAME = new Map(SYNC_TABLES.map((t) => [t.name, t]));

// ---------- connection ----------
// Its own connection: dates as plain strings in UTC, so they travel between
// machines in different time zones unchanged and compare as text.
async function connect() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'my_track',
    dateStrings: true,
    supportBigNumbers: true,
    charset: 'utf8mb4',
  });
  await conn.query("SET time_zone = '+00:00'");
  return conn;
}

const nowUtc = async (conn) => (await conn.query("SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f') AS t"))[0][0].t.slice(0, 23);

// ---------- id ↔ sync_id ----------
class IdMap {
  constructor(conn) {
    this.conn = conn;
    this.toSync = new Map(); // table → Map(id → sync_id)
    this.toLocal = new Map(); // table → Map(sync_id → id)
  }

  async load(table) {
    if (this.toSync.has(table)) return;
    const [rows] = await this.conn.query(`SELECT id, sync_id FROM \`${table}\``);
    this.toSync.set(table, new Map(rows.map((r) => [Number(r.id), r.sync_id])));
    this.toLocal.set(table, new Map(rows.map((r) => [r.sync_id, Number(r.id)])));
  }

  add(table, id, syncId) {
    this.toSync.get(table)?.set(Number(id), syncId);
    this.toLocal.get(table)?.set(syncId, Number(id));
  }

  remove(table, syncId) {
    const id = this.toLocal.get(table)?.get(syncId);
    this.toLocal.get(table)?.delete(syncId);
    if (id != null) this.toSync.get(table)?.delete(id);
  }

  syncOf(table, id) {
    if (id === null || id === undefined || id === '') return null;
    return this.toSync.get(table)?.get(Number(id)) ?? null;
  }

  localOf(table, syncId) {
    if (!syncId) return null;
    return this.toLocal.get(table)?.get(syncId) ?? null;
  }
}

// ---------- ids inside JSON columns ----------
// out: local ids → sync ids (sending). in: sync ids → local ids (arriving);
// `missing()` marks a reference that can't be resolved yet, so the column
// is fixed up after everything else has arrived.
function parse(text) {
  try {
    return typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return undefined;
  }
}

const TRANSLATORS = {
  // ["title", "c:12", …] on task boards: c:<task_columns.id>
  columnKeys: {
    tables: ['task_columns'],
    convert(value, map, dir, missing) {
      const list = parse(value);
      if (!Array.isArray(list)) return value;
      return JSON.stringify(
        list
          .map((k) => {
            if (typeof k !== 'string' || !k.startsWith('c:')) return k;
            const v = k.slice(2);
            const got = dir === 'out' ? map.syncOf('task_columns', v) : map.localOf('task_columns', v);
            if (got == null) {
              if (dir === 'in') missing();
              return null;
            }
            return `c:${got}`;
          })
          .filter((k) => k !== null)
      );
    },
  },
  // tasks.data._collaborators: [user id, …]
  taskData: {
    tables: ['users'],
    convert(value, map, dir, missing) {
      const data = parse(value);
      if (!data || typeof data !== 'object' || !Array.isArray(data._collaborators)) return value;
      data._collaborators = data._collaborators
        .map((id) => {
          const got = dir === 'out' ? map.syncOf('users', id) : map.localOf('users', id);
          if (got == null && dir === 'in') missing();
          return got;
        })
        .filter((v) => v != null);
      return JSON.stringify(data);
    },
  },
  // task_activity.changes: raw old/new values for assignee / collaborators
  // (used by Revert) are user ids.
  activityChanges: {
    tables: ['users'],
    convert(value, map, dir) {
      const list = parse(value);
      if (!Array.isArray(list)) return value;
      const one = (id) => (dir === 'out' ? map.syncOf('users', id) : map.localOf('users', id));
      for (const c of list) {
        if (!c || typeof c !== 'object') continue;
        if (c.key === 'assignee_id') {
          if ('old' in c) c.old = c.old == null ? null : one(c.old);
          if ('new' in c) c.new = c.new == null ? null : one(c.new);
        } else if (c.key === 'data._collaborators') {
          for (const side of ['old', 'new']) if (Array.isArray(c[side])) c[side] = c[side].map(one).filter((v) => v != null);
        }
      }
      return JSON.stringify(list);
    },
  },
  // task_comments.mentions: [{ id, name }]
  mentions: {
    tables: ['users'],
    convert(value, map, dir) {
      const list = parse(value);
      if (!Array.isArray(list)) return value;
      return JSON.stringify(
        list.map((m) => ({ ...m, id: dir === 'out' ? map.syncOf('users', m.id) : map.localOf('users', m.id) })).filter((m) => m.id != null)
      );
    },
  },
};

// ---------- reading changes (the sending side) ----------
// { now, tables: { name: [row…] }, tombstones: [{ table_name, sync_id, deleted_at }] }
// Each row has no local `id`; references are sync ids.
// scope (lib/syncScope.js): only that user's slice, other accounts trimmed.
export async function exportChanges(since, { skip = new Set(), scope = null } = {}) {
  const conn = await connect();
  try {
    const now = await nowUtc(conn);
    const map = new IdMap(conn);
    const tables = {};
    for (const t of SYNC_TABLES) {
      const [rows] = since
        ? await conn.query(`SELECT * FROM \`${t.name}\` WHERE sync_at > ? AND sync_at <= ? ORDER BY id`, [since, now])
        : await conn.query(`SELECT * FROM \`${t.name}\` WHERE sync_at <= ? ORDER BY id`, [now]);
      if (rows.length === 0) continue;
      const needed = new Set([...Object.values(t.refs || {}), ...Object.values(t.json || {}).flatMap((k) => TRANSLATORS[k].tables)]);
      for (const table of needed) await map.load(table);
      const out = [];
      for (const row of rows) {
        if (skip.has(`${t.name}:${row.sync_id}:${row.sync_at}`)) continue;
        if (scope && !rowInScope(t.name, row, scope)) continue;
        const r = scope && t.name === 'users' ? trimUser(row, scope) : { ...row };
        delete r.id;
        for (const [col, target] of Object.entries(t.refs || {})) r[col] = map.syncOf(target, row[col]);
        for (const [col, kind] of Object.entries(t.json || {})) r[col] = TRANSLATORS[kind].convert(row[col], map, 'out', () => {});
        out.push(r);
      }
      if (out.length) tables[t.name] = out;
    }
    const [tombs] = since
      ? await conn.query('SELECT table_name, sync_id, deleted_at FROM sync_tombstones WHERE deleted_at > ? AND deleted_at <= ? ORDER BY id', [since, now])
      : await conn.query('SELECT table_name, sync_id, deleted_at FROM sync_tombstones WHERE deleted_at <= ? ORDER BY id', [now]);
    const tombstones = tombs.filter((x) => BY_NAME.has(x.table_name) && !skip.has(`tomb:${x.table_name}:${x.sync_id}`));
    return { now, tables, tombstones };
  } finally {
    await conn.end();
  }
}

// ---------- merging changes in (the receiving side) ----------
// Returns stats plus `applied`: keys of what was written, so the caller can
// avoid sending those same rows straight back.
// scope: changes come from that user's desktop app — anything outside their
// slice is refused (counted as `refused`), and their account can't be made
// an admin or renamed to another email from there.
export async function applyChanges(payload, { scope = null } = {}) {
  const conn = await connect();
  const stats = { inserted: 0, updated: 0, unchanged: 0, deleted: 0, skipped: 0, refused: 0 };
  const applied = new Set();
  try {
    const map = new IdMap(conn);
    for (const t of SYNC_TABLES) await map.load(t.name);
    const [cols] = await conn.query(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()'
    );
    const columnsOf = new Map();
    for (const { t, c } of cols) {
      if (!columnsOf.has(t)) columnsOf.set(t, new Set());
      columnsOf.get(t).add(c);
    }
    const [nullable] = await conn.query(
      "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND IS_NULLABLE = 'YES'"
    );
    const isNullable = new Set(nullable.map((x) => `${x.t}.${x.c}`));
    const fixups = []; // references resolved after every table has arrived

    await conn.beginTransaction();
    for (const t of SYNC_TABLES) {
      const rows = payload.tables?.[t.name];
      if (!rows?.length) continue;
      const known = columnsOf.get(t.name) || new Set();
      for (const incoming of rows) {
        if (!incoming?.sync_id || !incoming.sync_at) continue;
        // Only columns this install has (the other side may be newer/older).
        const row = {};
        for (const [k, v] of Object.entries(incoming)) if (k !== 'id' && known.has(k)) row[k] = v;

        // References → local ids; unresolved ones are fixed up later.
        let skip = false;
        const pending = {};
        for (const [col, target] of Object.entries(t.refs || {})) {
          if (!(col in row) || row[col] == null) continue;
          const local = map.localOf(target, row[col]);
          if (local == null) {
            if (!isNullable.has(`${t.name}.${col}`)) {
              skip = true;
              break;
            }
            pending[col] = { target, syncId: row[col] };
            row[col] = null;
          } else {
            row[col] = local;
          }
        }
        if (skip) {
          stats.skipped += 1;
          continue;
        }
        const pendingJson = {};
        for (const [col, kind] of Object.entries(t.json || {})) {
          if (!(col in row)) continue;
          const original = row[col];
          let missing = false;
          row[col] = TRANSLATORS[kind].convert(original, map, 'in', () => (missing = true));
          if (missing) pendingJson[col] = { kind, original };
        }

        // Find the local copy: by sync id, else by natural key (then adopt
        // the incoming sync id so they're linked from now on).
        let [[local]] = await conn.query(`SELECT id, sync_id, sync_at FROM \`${t.name}\` WHERE sync_id = ?`, [row.sync_id]);
        let adopt = false;
        if (!local && t.natural && t.natural.every((c) => row[c] != null)) {
          const where = t.natural.map((c) => `\`${c}\` = ?`).join(' AND ');
          [[local]] = await conn.query(`SELECT id, sync_id, sync_at FROM \`${t.name}\` WHERE ${where}`, t.natural.map((c) => row[c]));
          adopt = Boolean(local);
        }
        if (scope) {
          const [[existing]] = local ? await conn.query(`SELECT * FROM \`${t.name}\` WHERE id = ?`, [local.id]) : [[null]];
          if (!(await canWrite(conn, t.name, row, existing || null, scope))) {
            stats.refused += 1;
            continue;
          }
          if (t.name === 'users') {
            for (const k of Object.keys(row)) delete row[k];
            Object.assign(row, cleanIncomingUser(incoming));
            for (const k of Object.keys(row)) if (!known.has(k) || k === 'id') delete row[k];
          }
        }
        if (adopt) {
          await conn.query(`UPDATE \`${t.name}\` SET sync_id = ?, sync_at = sync_at WHERE id = ?`, [row.sync_id, local.id]);
          map.remove(t.name, local.sync_id);
          map.add(t.name, local.id, row.sync_id);
        }

        let localId;
        const names = Object.keys(row);
        if (!local) {
          // Deleted here after this version was made → stays deleted.
          const [[tomb]] = await conn.query(
            'SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND sync_id = ? ORDER BY deleted_at DESC LIMIT 1',
            [t.name, row.sync_id]
          );
          if (tomb && tomb.deleted_at >= row.sync_at) {
            stats.skipped += 1;
            continue;
          }
          const [res] = await conn.query(
            `INSERT INTO \`${t.name}\` (${names.map((n) => `\`${n}\``).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
            names.map((n) => row[n])
          );
          localId = res.insertId;
          map.add(t.name, localId, row.sync_id);
          stats.inserted += 1;
        } else if (row.sync_at > local.sync_at) {
          const sets = names.filter((n) => n !== 'sync_id');
          await conn.query(`UPDATE \`${t.name}\` SET ${sets.map((n) => `\`${n}\` = ?`).join(', ')} WHERE id = ?`, [...sets.map((n) => row[n]), local.id]);
          localId = local.id;
          stats.updated += 1;
        } else {
          stats.unchanged += 1;
          continue;
        }
        applied.add(`${t.name}:${row.sync_id}:${row.sync_at}`);
        if (Object.keys(pending).length || Object.keys(pendingJson).length) fixups.push({ table: t.name, id: localId, pending, pendingJson });
      }
    }

    // Second pass: references to rows that arrived later in this sync.
    for (const f of fixups) {
      const sets = [];
      const values = [];
      for (const [col, { target, syncId }] of Object.entries(f.pending)) {
        const local = map.localOf(target, syncId);
        if (local != null) {
          sets.push(`\`${col}\` = ?`);
          values.push(local);
        }
      }
      for (const [col, { kind, original }] of Object.entries(f.pendingJson)) {
        sets.push(`\`${col}\` = ?`);
        values.push(TRANSLATORS[kind].convert(original, map, 'in', () => {}));
      }
      if (sets.length) await conn.query(`UPDATE \`${f.table}\` SET ${sets.join(', ')}, sync_at = sync_at WHERE id = ?`, [...values, f.id]);
    }

    // Deletes, children first. A row changed here after the other side
    // deleted it is kept (the newer change wins).
    const order = new Map(SYNC_TABLES.map((t, i) => [t.name, i]));
    const tombs = (payload.tombstones || []).filter((x) => order.has(x.table_name)).sort((a, b) => order.get(b.table_name) - order.get(a.table_name));
    for (const tomb of tombs) {
      const [[local]] = await conn.query(`SELECT * FROM \`${tomb.table_name}\` WHERE sync_id = ?`, [tomb.sync_id]);
      if (!local || tomb.deleted_at <= local.sync_at) continue;
      if (scope && (tomb.table_name === 'users' || !(await canWrite(conn, tomb.table_name, {}, local, scope)))) {
        stats.refused += 1;
        continue;
      }
      await conn.query(`DELETE FROM \`${tomb.table_name}\` WHERE id = ?`, [local.id]);
      map.remove(tomb.table_name, tomb.sync_id);
      applied.add(`tomb:${tomb.table_name}:${tomb.sync_id}`);
      stats.deleted += 1;
    }
    await conn.commit();
    return { stats, applied };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end();
  }
}

// ---------- keys ----------
export const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
export const newKey = () => `mts_${crypto.randomBytes(32).toString('base64url')}`;

// ---------- this install's sync settings ----------
export async function getState(conn, keys) {
  const [rows] = await conn.query(`SELECT k, v FROM sync_state WHERE k IN (${keys.map(() => '?').join(',')})`, keys);
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

export async function setState(conn, values) {
  for (const [k, v] of Object.entries(values)) {
    await conn.query('INSERT INTO sync_state (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, v == null ? null : String(v)]);
  }
}

export { connect as syncConnection };
