import { createHash, randomUUID } from 'crypto';

// Moves one user's data between MyTrack installs (e.g. local → live) as a
// single JSON file. Export reads only the signed-in user's rows; import
// writes them under the signed-in user on the other side, giving every row a
// new id and re-linking parents/children through those new ids.
//
// Import matches each item in the file with the copy already here (same
// uuid — i.e. it came from an earlier import/export — or, for tables without
// one, the same natural key):
//   • no copy here            → added
//   • copy here, same content → unchanged
//   • copy here, differs      → updated to the file's version, unless
//                               `update` is off ("not updated") or the copy
//                               here was edited more recently ("kept")
// Rows that aren't in the file are never touched, and importing the same file
// twice changes nothing the second time.

export const FORMAT = 'mytrack-data';
export const FORMAT_VERSION = 1;

// Return DATE/DATETIME/TIMESTAMP columns as the strings MySQL stored, so a
// date never shifts by the server's timezone on the way through JSON.
const typeCast = (field, next) =>
  ['DATE', 'NEWDATE', 'DATETIME', 'TIMESTAMP'].includes(field.type) ? field.string() : next();

async function select(conn, sql, values = []) {
  const [rows] = await conn.query({ sql, values, typeCast });
  return rows;
}

async function insert(conn, table, row) {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const [res] = await conn.query(
    `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => row[c])
  );
  return res.insertId;
}

async function update(conn, table, where, row) {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const keys = Object.keys(where);
  await conn.query(
    `UPDATE \`${table}\` SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE ${keys.map((k) => `\`${k}\` = ?`).join(' AND ')}`,
    [...cols.map((c) => row[c]), ...keys.map((k) => where[k])]
  );
}

const placeholders = (list) => list.map(() => '?').join(', ');
const json = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
const str = (v, max) => (v == null ? null : String(v).slice(0, max));
const int = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const flag = (v) => (v ? 1 : 0);
const list = (v) => (Array.isArray(v) ? v : []);

const norm = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
// Would writing `next` change anything in `current`? (timestamps aren't content)
const differs = (current, next) =>
  Object.keys(next).some((k) => next[k] !== undefined && !/_at$/.test(k) && norm(current[k]) !== norm(next[k]));
// Both are 'YYYY-MM-DD HH:MM:SS' strings, so they compare as text.
const newerHere = (fileTs, hereTs) => Boolean(fileTs && hereTs && String(hereTs) > String(fileTs));

const counter = () => ({ added: 0, updated: 0, unchanged: 0, kept: 0, skipped: 0 });

// Add, update or leave one row that has a copy here (`current`) or not.
async function upsert(conn, c, { table, current, values, insertValues, fileUpdatedAt, opts }) {
  if (!current) {
    const id = await insert(conn, table, insertValues);
    c.added += 1;
    return id;
  }
  if (!differs(current, values)) c.unchanged += 1;
  else if (!opts.update) c.skipped += 1; // "add new only"
  else if (newerHere(fileUpdatedAt, current.updated_at)) c.kept += 1;
  else {
    await update(conn, table, { id: current.id }, values);
    c.updated += 1;
  }
  return current.id;
}

// A row keeps the file's uuid unless another account here already has it
// (same install, e.g. copying between two users). Then it gets a uuid derived
// from the original + this user, so importing the file again still finds it.
function derivedUuid(uuid, userId) {
  const h = createHash('sha1').update(`${uuid}:${userId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// The uuids this user's copy of a row could have.
const candidates = (uuid, userId) => (uuid ? [uuid, derivedUuid(uuid, userId)] : []);

async function freeUuid(conn, table, uuid, userId) {
  if (!uuid) return randomUUID();
  for (const u of candidates(uuid, userId)) {
    const rows = await select(conn, `SELECT 1 FROM \`${table}\` WHERE uuid = ? LIMIT 1`, [u]);
    if (!rows.length) return u;
  }
  return randomUUID();
}

// uuid → this user's existing copy, if any.
const findMine = (mine, uuid, userId) => candidates(uuid, userId).map((u) => mine.get(u)).find(Boolean);
const byUuid = (rows) => new Map(rows.map((r) => [r.uuid, r]));

// Parents before children; rows whose parent isn't in the file become top-level.
function parentsFirst(rows) {
  const ids = new Set(rows.map((r) => r.id));
  const done = new Set();
  const out = [];
  let pending = rows;
  while (pending.length) {
    const next = [];
    for (const r of pending) {
      if (r.parent_id == null || !ids.has(r.parent_id) || done.has(r.parent_id)) {
        out.push(r);
        done.add(r.id);
      } else next.push(r);
    }
    if (next.length === pending.length) {
      out.push(...next.map((r) => ({ ...r, parent_id: null }))); // cycle guard
      break;
    }
    pending = next;
  }
  return out;
}

// Moving `id` under `parentId` must not put it inside its own subtree.
async function safeParent(conn, table, id, parentId) {
  let at = parentId;
  for (let hops = 0; at != null && hops < 1000; hops += 1) {
    if (at === id) return undefined; // leave the parent as it is
    at = (await select(conn, `SELECT parent_id FROM \`${table}\` WHERE id = ?`, [at]))[0]?.parent_id ?? null;
  }
  return parentId;
}

// ---------------------------------------------------------------- modules

const notes = {
  label: 'Notes',
  async count(conn, userId) {
    return (await select(conn, 'SELECT COUNT(*) AS n FROM notes WHERE user_id = ?', [userId]))[0].n;
  },
  async export(conn, userId) {
    return select(
      conn,
      `SELECT id, parent_id, uuid, title, content, style, position, created_at, updated_at
       FROM notes WHERE user_id = ? ORDER BY id`,
      [userId]
    );
  },
  async import(conn, userId, rows, opts) {
    const c = counter();
    const mine = byUuid(await select(conn, 'SELECT * FROM notes WHERE user_id = ?', [userId]));
    const idMap = new Map();
    for (const r of parentsFirst(list(rows))) {
      const current = findMine(mine, r.uuid, userId);
      const parentId = r.parent_id != null ? idMap.get(r.parent_id) ?? null : null;
      const values = {
        parent_id: current ? await safeParent(conn, 'notes', current.id, parentId) : parentId,
        title: str(r.title, 255) || 'Untitled',
        content: r.content ?? null,
        style: json(r.style),
        position: int(r.position),
        updated_at: r.updated_at || undefined,
      };
      const id = await upsert(conn, c, {
        table: 'notes',
        current,
        values,
        insertValues: { ...values, user_id: userId, uuid: await freeUuid(conn, 'notes', r.uuid, userId), created_at: r.created_at || undefined },
        fileUpdatedAt: r.updated_at,
        opts,
      });
      idMap.set(r.id, id);
    }
    return c;
  },
};

const trackColumnValues = (col) => ({
  label: str(col.label, 255) || 'Field',
  field_type: str(col.field_type, 50) || 'text',
  options: col.options ?? null,
  field_length: str(col.field_length, 20),
  is_auto_increment: flag(col.is_auto_increment),
  is_filterable: flag(col.is_filterable),
  is_searchable: flag(col.is_searchable),
  position: int(col.position),
});

const tracks = {
  label: 'Tracks (records)',
  async count(conn, userId) {
    return (await select(conn, 'SELECT COUNT(*) AS n FROM tracks WHERE user_id = ?', [userId]))[0].n;
  },
  async export(conn, userId) {
    const t = await select(
      conn,
      `SELECT id, parent_id, uuid, name, description, icon, icon_type, color, page_size, position, view_type, created_at
       FROM tracks WHERE user_id = ? ORDER BY id`,
      [userId]
    );
    if (!t.length) return { tracks: [], columns: [], entries: [] };
    const ids = t.map((r) => r.id);
    const columns = await select(conn, `SELECT * FROM track_columns WHERE track_id IN (${placeholders(ids)}) ORDER BY id`, ids);
    const entries = await select(
      conn,
      `SELECT track_id, uuid, data, position, is_locked, created_at, updated_at
       FROM track_entries WHERE track_id IN (${placeholders(ids)}) ORDER BY id`,
      ids
    );
    return { tracks: t, columns, entries };
  },
  async import(conn, userId, data, opts) {
    const c = counter();
    const ec = counter();
    const mine = byUuid(await select(conn, 'SELECT * FROM tracks WHERE user_id = ?', [userId]));
    const idMap = new Map();
    for (const r of parentsFirst(list(data?.tracks))) {
      const current = findMine(mine, r.uuid, userId);
      const parentId = r.parent_id != null ? idMap.get(r.parent_id) ?? null : null;
      const values = {
        parent_id: current ? await safeParent(conn, 'tracks', current.id, parentId) : parentId,
        name: str(r.name, 255) || 'Untitled',
        description: str(r.description, 500),
        icon: r.icon ?? null,
        icon_type: str(r.icon_type, 10) || 'tag',
        color: str(r.color, 20) || undefined,
        page_size: int(r.page_size, 25),
        position: int(r.position),
        view_type: str(r.view_type, 10) || 'table',
      };
      const id = await upsert(conn, c, {
        table: 'tracks',
        current,
        values,
        insertValues: { ...values, user_id: userId, uuid: await freeUuid(conn, 'tracks', r.uuid, userId), created_at: r.created_at || undefined },
        opts,
      });
      idMap.set(r.id, id);
    }

    // Columns are matched by field_key within their track.
    const targetIds = [...new Set(idMap.values())];
    const cols = new Map(
      (targetIds.length ? await select(conn, `SELECT * FROM track_columns WHERE track_id IN (${placeholders(targetIds)})`, targetIds) : []).map(
        (r) => [`${r.track_id}:${r.field_key}`, r]
      )
    );
    const colCount = counter();
    for (const col of list(data?.columns)) {
      const trackId = idMap.get(col.track_id);
      if (!trackId || !col.field_key) continue;
      const key = `${trackId}:${col.field_key}`;
      const current = cols.get(key);
      const values = trackColumnValues(col);
      if (current && Number(col.next_auto_value) > Number(current.next_auto_value)) values.next_auto_value = int(col.next_auto_value, 1);
      const id = await upsert(conn, colCount, {
        table: 'track_columns',
        current,
        values,
        insertValues: { ...values, track_id: trackId, field_key: str(col.field_key, 255), next_auto_value: int(col.next_auto_value, 1), created_at: col.created_at || undefined },
        opts,
      });
      if (!current) cols.set(key, { id, track_id: trackId, field_key: col.field_key });
    }

    // Entries: matched by uuid among this user's records.
    const entries = targetIds.length
      ? await select(conn, `SELECT * FROM track_entries WHERE track_id IN (SELECT id FROM tracks WHERE user_id = ?)`, [userId])
      : [];
    const mineEntries = byUuid(entries.filter((e) => e.uuid));
    for (const e of list(data?.entries)) {
      const trackId = idMap.get(e.track_id);
      if (!trackId) continue;
      const body = json(e.data) || '{}';
      if (!e.uuid) {
        // No uuid to match on (very old rows): add unless an identical record is already there.
        if (entries.some((x) => x.track_id === trackId && norm(x.data) === body)) ec.unchanged += 1;
        else {
          await insert(conn, 'track_entries', { track_id: trackId, uuid: randomUUID(), data: body, position: int(e.position), is_locked: flag(e.is_locked) });
          ec.added += 1;
        }
        continue;
      }
      const current = findMine(mineEntries, e.uuid, userId);
      const values = { track_id: trackId, data: body, position: int(e.position), is_locked: flag(e.is_locked), updated_at: e.updated_at || undefined };
      await upsert(conn, ec, {
        table: 'track_entries',
        current,
        values,
        insertValues: { ...values, uuid: await freeUuid(conn, 'track_entries', e.uuid, userId), created_at: e.created_at || undefined },
        fileUpdatedAt: e.updated_at,
        opts,
      });
    }
    return { ...c, detail: `records: ${summarize(ec)}` };
  },
};

// Board settings keep custom columns as "c:<column id>"; point them at the new ids.
const remapColumnKeys = (raw, colMap) => {
  if (raw == null) return null;
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  return JSON.stringify(
    arr
      .map((k) => (typeof k === 'string' && k.startsWith('c:') ? (colMap.has(Number(k.slice(2))) ? `c:${colMap.get(Number(k.slice(2)))}` : null) : k))
      .filter(Boolean)
  );
};

const tasks = {
  label: 'Task boards',
  async count(conn, userId) {
    return (await select(conn, 'SELECT COUNT(*) AS n FROM task_boards WHERE owner_id = ?', [userId]))[0].n;
  },
  async export(conn, userId) {
    const boards = await select(
      conn,
      `SELECT id, uuid, name, description, visibility, statuses, column_order, show_serial, hidden_columns, created_at, updated_at
       FROM task_boards WHERE owner_id = ? ORDER BY id`,
      [userId]
    );
    if (!boards.length) return { boards: [], columns: [], tasks: [] };
    const ids = boards.map((b) => b.id);
    const columns = await select(
      conn,
      `SELECT id, board_id, label, field_key, field_type, options, position, created_at
       FROM task_columns WHERE board_id IN (${placeholders(ids)}) ORDER BY id`,
      ids
    );
    const rows = await select(
      conn,
      `SELECT t.board_id, t.uuid, t.title, t.description, t.status, t.priority, u.email AS assignee_email,
              t.due_date, t.data, t.position, t.created_at, t.updated_at
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.board_id IN (${placeholders(ids)}) AND t.deleted_at IS NULL ORDER BY t.id`,
      ids
    );
    return { boards, columns, tasks: rows };
  },
  async import(conn, userId, data, opts) {
    const c = counter();
    const tc = counter();
    const [me] = await select(conn, 'SELECT email FROM users WHERE id = ?', [userId]);
    const mine = byUuid(await select(conn, 'SELECT * FROM task_boards WHERE owner_id = ?', [userId]));
    const boardMap = new Map();
    const boardRows = [];
    for (const b of list(data?.boards)) {
      const current = findMine(mine, b.uuid, userId);
      const values = {
        name: str(b.name, 255) || 'Untitled board',
        description: str(b.description, 500),
        visibility: b.visibility === 'public' ? 'public' : 'private',
        statuses: json(b.statuses),
        show_serial: flag(b.show_serial),
        updated_at: b.updated_at || undefined,
      };
      const before = { ...c };
      const id = await upsert(conn, c, {
        table: 'task_boards',
        current,
        values,
        insertValues: { ...values, owner_id: userId, uuid: await freeUuid(conn, 'task_boards', b.uuid, userId), created_at: b.created_at || undefined },
        fileUpdatedAt: b.updated_at,
        opts,
      });
      boardMap.set(b.id, id);
      // Column layout follows the board: set it for new boards and boards just updated.
      if (c.added > before.added || c.updated > before.updated) boardRows.push({ src: b, id });
    }

    const targetIds = [...new Set(boardMap.values())];
    const cols = new Map(
      (targetIds.length ? await select(conn, `SELECT * FROM task_columns WHERE board_id IN (${placeholders(targetIds)})`, targetIds) : []).map(
        (r) => [`${r.board_id}:${r.field_key}`, r]
      )
    );
    const colMap = new Map(); // column id in the file → column id here
    const colCount = counter();
    for (const col of list(data?.columns)) {
      const boardId = boardMap.get(col.board_id);
      if (!boardId || !col.field_key) continue;
      const key = `${boardId}:${col.field_key}`;
      const current = cols.get(key);
      const values = {
        label: str(col.label, 255) || 'Field',
        field_type: str(col.field_type, 50) || 'text',
        options: col.options ?? null,
        position: int(col.position),
      };
      const id = await upsert(conn, colCount, {
        table: 'task_columns',
        current,
        values,
        insertValues: { ...values, board_id: boardId, field_key: str(col.field_key, 255), created_at: col.created_at || undefined },
        opts,
      });
      if (!current) cols.set(key, { id, board_id: boardId, field_key: col.field_key });
      colMap.set(col.id, id);
    }
    for (const { src, id } of boardRows) {
      await conn.query('UPDATE task_boards SET column_order = ?, hidden_columns = ?, updated_at = updated_at WHERE id = ?', [
        remapColumnKeys(src.column_order, colMap),
        remapColumnKeys(src.hidden_columns, colMap),
        id,
      ]);
    }

    const mineTasks = byUuid(
      targetIds.length ? await select(conn, `SELECT * FROM tasks WHERE board_id IN (${placeholders(targetIds)})`, targetIds) : []
    );
    for (const t of list(data?.tasks)) {
      const boardId = boardMap.get(t.board_id);
      if (!boardId) continue;
      const current = findMine(mineTasks, t.uuid, userId);
      if (current?.deleted_at) {
        tc.kept += 1; // deleted here on purpose — don't bring it back
        continue;
      }
      const values = {
        board_id: boardId,
        title: str(t.title, 255) || 'Untitled task',
        description: t.description ?? null,
        status: str(t.status, 50) || 'To do',
        priority: str(t.priority, 20) || 'Medium',
        due_date: t.due_date || null,
        data: json(t.data),
        position: int(t.position),
        updated_at: t.updated_at || undefined,
      };
      // Other people's accounts don't carry over; tasks assigned to you stay assigned to you.
      const assignedToMe = t.assignee_email && me && t.assignee_email.toLowerCase() === me.email.toLowerCase();
      await upsert(conn, tc, {
        table: 'tasks',
        current,
        values: current ? { ...values, ...(assignedToMe ? { assignee_id: userId } : {}), updated_by: undefined } : values,
        insertValues: {
          ...values,
          uuid: await freeUuid(conn, 'tasks', t.uuid, userId),
          assignee_id: assignedToMe ? userId : null,
          created_by: userId,
          updated_by: userId,
          created_at: t.created_at || undefined,
        },
        fileUpdatedAt: t.updated_at,
        opts,
      });
    }
    return { ...c, detail: `tasks: ${summarize(tc)}` };
  },
};

const code = {
  label: 'Saved code',
  async count(conn, userId) {
    return (await select(conn, 'SELECT COUNT(*) AS n FROM code_snippets WHERE user_id = ?', [userId]))[0].n;
  },
  async export(conn, userId) {
    const snippets = await select(
      conn,
      'SELECT id, uuid, name, language, content, created_at, updated_at FROM code_snippets WHERE user_id = ? ORDER BY id',
      [userId]
    );
    const ids = snippets.map((s) => s.id);
    const versions = ids.length
      ? await select(
          conn,
          `SELECT snippet_id, label, language, content, created_at FROM code_versions WHERE snippet_id IN (${placeholders(ids)}) ORDER BY id`,
          ids
        )
      : [];
    return { snippets, versions };
  },
  async import(conn, userId, data, opts) {
    const c = counter();
    const mine = byUuid(await select(conn, 'SELECT * FROM code_snippets WHERE user_id = ?', [userId]));
    const idMap = new Map();
    for (const s of list(data?.snippets)) {
      const current = findMine(mine, s.uuid, userId);
      const values = {
        name: str(s.name, 255) || 'Untitled',
        language: str(s.language, 40) || 'text',
        content: s.content ?? null,
        updated_at: s.updated_at || undefined,
      };
      idMap.set(
        s.id,
        await upsert(conn, c, {
          table: 'code_snippets',
          current,
          values,
          insertValues: { ...values, user_id: userId, uuid: await freeUuid(conn, 'code_snippets', s.uuid, userId), created_at: s.created_at || undefined },
          fileUpdatedAt: s.updated_at,
          opts,
        })
      );
    }
    // Saved versions are history: add the ones this snippet doesn't have yet.
    const ids = [...new Set(idMap.values())];
    const have = new Set(
      (ids.length ? await select(conn, `SELECT snippet_id, label, created_at FROM code_versions WHERE snippet_id IN (${placeholders(ids)})`, ids) : []).map(
        (v) => `${v.snippet_id}|${v.label}|${v.created_at}`
      )
    );
    for (const v of list(data?.versions)) {
      const snippetId = idMap.get(v.snippet_id);
      if (!snippetId || have.has(`${snippetId}|${v.label}|${v.created_at}`)) continue;
      await insert(conn, 'code_versions', {
        snippet_id: snippetId,
        label: str(v.label, 255),
        language: str(v.language, 40) || 'text',
        content: v.content ?? null,
        created_at: v.created_at || undefined,
      });
    }
    return c;
  },
};

// Tables without a uuid: a row is "the same item" when its natural key matches.
async function importByKey(conn, c, { table, userId, keyCols, values, opts }) {
  const where = keyCols.map((k) => `\`${k}\` <=> ?`).join(' AND ');
  const [current] = await select(conn, `SELECT * FROM \`${table}\` WHERE user_id = ? AND ${where} LIMIT 1`, [userId, ...keyCols.map((k) => values[k])]);
  return upsert(conn, c, { table, current, values, insertValues: { ...values, user_id: userId }, opts });
}

const calendar = {
  label: 'Calendar (leaves & activities)',
  async count(conn, userId) {
    const [a] = await select(conn, 'SELECT COUNT(*) AS n FROM calendar_leaves WHERE user_id = ?', [userId]);
    const [b] = await select(conn, 'SELECT COUNT(*) AS n FROM calendar_activities WHERE user_id = ?', [userId]);
    return a.n + b.n;
  },
  async export(conn, userId) {
    return {
      leaves: await select(
        conn,
        'SELECT start_date, end_date, leave_type, half_day, note, created_at FROM calendar_leaves WHERE user_id = ? ORDER BY id',
        [userId]
      ),
      activities: await select(
        conn,
        `SELECT activity_date, start_time, end_time, title, details, created_at, updated_at
         FROM calendar_activities WHERE user_id = ? ORDER BY id`,
        [userId]
      ),
    };
  },
  async import(conn, userId, data, opts) {
    const c = counter();
    for (const l of list(data?.leaves)) {
      if (!l.start_date || !l.end_date) continue;
      await importByKey(conn, c, {
        table: 'calendar_leaves',
        userId,
        keyCols: ['start_date', 'end_date', 'leave_type'],
        values: {
          start_date: l.start_date,
          end_date: l.end_date,
          leave_type: str(l.leave_type, 20) || 'casual',
          half_day: flag(l.half_day),
          note: str(l.note, 500),
          created_at: l.created_at || undefined,
        },
        opts,
      });
    }
    for (const a of list(data?.activities)) {
      if (!a.activity_date || !a.title) continue;
      await importByKey(conn, c, {
        table: 'calendar_activities',
        userId,
        keyCols: ['activity_date', 'start_time', 'title'],
        values: {
          activity_date: a.activity_date,
          start_time: a.start_time ?? null,
          end_time: a.end_time ?? null,
          title: str(a.title, 255),
          details: a.details ?? null,
          created_at: a.created_at || undefined,
          updated_at: a.updated_at || undefined,
        },
        opts,
      });
    }
    return c;
  },
};

const expenses = {
  label: 'Expenses',
  async count(conn, userId) {
    return (await select(conn, 'SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?', [userId]))[0].n;
  },
  async export(conn, userId) {
    return select(
      conn,
      'SELECT spent_on, amount, description, category, payment_method, note, created_at FROM expenses WHERE user_id = ? ORDER BY id',
      [userId]
    );
  },
  async import(conn, userId, rows, opts) {
    const c = counter();
    for (const e of list(rows)) {
      if (!e.spent_on || e.amount == null || !e.description) continue;
      await importByKey(conn, c, {
        table: 'expenses',
        userId,
        keyCols: ['spent_on', 'amount', 'description'],
        values: {
          spent_on: e.spent_on,
          amount: e.amount,
          description: str(e.description, 255),
          category: str(e.category, 20) || 'other',
          payment_method: str(e.payment_method, 20) || 'cash',
          note: str(e.note, 500),
          created_at: e.created_at || undefined,
        },
        opts,
      });
    }
    return c;
  },
};

const routine = {
  label: 'Daily routine',
  async count(conn, userId) {
    return (await select(conn, 'SELECT COUNT(*) AS n FROM routine_items WHERE user_id = ?', [userId]))[0].n;
  },
  async export(conn, userId) {
    return {
      items: await select(conn, 'SELECT id, title, time_of_day, days, created_at FROM routine_items WHERE user_id = ? ORDER BY id', [userId]),
      checks: await select(conn, 'SELECT item_id, check_date, done_at FROM routine_checks WHERE user_id = ?', [userId]),
    };
  },
  async import(conn, userId, data, opts) {
    const c = counter();
    const idMap = new Map();
    for (const it of list(data?.items)) {
      if (!it.title) continue;
      idMap.set(
        it.id,
        await importByKey(conn, c, {
          table: 'routine_items',
          userId,
          keyCols: ['title', 'time_of_day', 'days'],
          values: { title: str(it.title, 255), time_of_day: it.time_of_day ?? null, days: str(it.days, 7) || '1234567', created_at: it.created_at || undefined },
          opts,
        })
      );
    }
    for (const ch of list(data?.checks)) {
      const itemId = idMap.get(ch.item_id);
      if (!itemId || !ch.check_date) continue;
      await conn.query('INSERT IGNORE INTO routine_checks (item_id, user_id, check_date, done_at) VALUES (?, ?, ?, ?)', [
        itemId,
        userId,
        ch.check_date,
        ch.done_at || null,
      ]);
    }
    return c;
  },
};

export function summarize(c) {
  const parts = [`${c.added} added`, `${c.updated} updated`, `${c.unchanged} unchanged`];
  if (c.kept) parts.push(`${c.kept} kept (newer here)`);
  if (c.skipped) parts.push(`${c.skipped} not updated`);
  return parts.join(', ');
}

export const MODULES = { notes, tracks, tasks, code, calendar, expenses, routine };
export const MODULE_KEYS = Object.keys(MODULES);
