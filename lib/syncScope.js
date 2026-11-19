// One user's slice of the database, for syncing with that user's desktop app
// (lib/agent.js). The full two-way sync (lib/sync.js without a scope) copies
// everything between two installs an admin owns; a linked desktop app only
// ever sees — and may only change — its own user's things:
//
//   their account, tracks (+ columns, records, history), notes, saved code,
//   calendar, login history, activity, phones, notifications, testing
//   projects, and the task boards they own or are a member of (+ everything
//   on them). Other people on those boards come along as name + email only.
//
// Rows are checked by who owns them *here* — a device can't take over
// someone else's row by sending a different user_id.

// What never leaves the server for someone else's account.
const SECRET_USER_COLUMNS = ['password', 'action_password', 'app_lock_password', 'google_refresh_token', 'google_email'];

// Tables owned directly through a user column.
const OWNER_COLUMN = {
  tracks: 'user_id',
  notes: 'user_id',
  code_snippets: 'user_id',
  calendar_leaves: 'user_id',
  calendar_activities: 'user_id',
  login_events: 'user_id',
  user_activity: 'user_id',
  user_devices: 'user_id',
  notifications: 'user_id',
  test_projects: 'user_id',
  track_activity: 'owner_id',
};
// Tables owned through a parent: column → parent table.
const PARENT = {
  track_columns: ['track_id', 'tracks'],
  track_entries: ['track_id', 'tracks'],
  code_versions: ['snippet_id', 'code_snippets'],
  test_feedback: ['project_id', 'test_projects'],
  task_columns: ['board_id', 'task_boards'],
  task_members: ['board_id', 'task_boards'],
  tasks: ['board_id', 'task_boards'],
  task_activity: ['board_id', 'task_boards'],
  task_comments: ['board_id', 'task_boards'],
};

async function ids(conn, sql, values) {
  const [rows] = await conn.query(sql, values);
  return new Set(rows.map((r) => Number(r.id)));
}

// The ids this user may see, per table that others hang off.
export async function computeScope(conn, userId, { systemEvents = false } = {}) {
  const u = Number(userId);
  const boards = await ids(
    conn,
    'SELECT id FROM task_boards WHERE owner_id = ? UNION SELECT board_id AS id FROM task_members WHERE user_id = ?',
    [u, u]
  );
  const scope = {
    userId: u,
    systemEvents,
    parents: {
      tracks: await ids(conn, 'SELECT id FROM tracks WHERE user_id = ?', [u]),
      code_snippets: await ids(conn, 'SELECT id FROM code_snippets WHERE user_id = ?', [u]),
      test_projects: await ids(conn, 'SELECT id FROM test_projects WHERE user_id = ?', [u]),
      task_boards: boards,
    },
    people: new Set([u]),
  };
  // Everyone the boards / notifications mention (name + email only).
  if (boards.size) {
    const list = [...boards];
    for (const sql of [
      'SELECT owner_id AS id FROM task_boards WHERE id IN (?)',
      'SELECT user_id AS id FROM task_members WHERE board_id IN (?)',
      'SELECT assignee_id AS id FROM tasks WHERE board_id IN (?) UNION SELECT created_by FROM tasks WHERE board_id IN (?) UNION SELECT updated_by FROM tasks WHERE board_id IN (?)',
      'SELECT user_id AS id FROM task_comments WHERE board_id IN (?)',
      'SELECT user_id AS id FROM task_activity WHERE board_id IN (?)',
    ]) {
      const n = (sql.match(/\?/g) || []).length;
      for (const id of await ids(conn, sql, Array(n).fill(list))) if (id) scope.people.add(id);
    }
  }
  for (const id of await ids(conn, 'SELECT actor_id AS id FROM notifications WHERE user_id = ? AND actor_id IS NOT NULL', [u])) scope.people.add(id);
  return scope;
}

// Sending side: is this (local-id) row part of the user's slice?
export function rowInScope(table, row, scope) {
  if (table === 'users') return scope.people.has(Number(row.id));
  if (table === 'system_events') return scope.systemEvents;
  if (table === 'task_boards') return scope.parents.task_boards.has(Number(row.id));
  if (OWNER_COLUMN[table]) return Number(row[OWNER_COLUMN[table]]) === scope.userId;
  if (PARENT[table]) {
    const [col, parent] = PARENT[table];
    return scope.parents[parent].has(Number(row[col]));
  }
  return false;
}

// Someone else's account goes out as name / email / avatar only.
export function trimUser(row, scope) {
  if (Number(row.id) === scope.userId) return row;
  const r = { ...row };
  for (const c of SECRET_USER_COLUMNS) if (c in r) r[c] = c === 'password' ? '!' : null;
  r.is_admin = 0;
  return r;
}

// ---------- receiving side (the server, from a device) ----------

async function ownerOf(conn, table, id) {
  if (id == null) return null;
  if (table === 'task_boards') {
    const [[b]] = await conn.query('SELECT owner_id FROM task_boards WHERE id = ?', [id]);
    return b ? Number(b.owner_id) : null;
  }
  const col = OWNER_COLUMN[table];
  const [[r]] = await conn.query(`SELECT \`${col}\` AS o FROM \`${table}\` WHERE id = ?`, [id]);
  return r ? Number(r.o) : null;
}

async function onBoard(conn, boardId, userId) {
  if (boardId == null) return false;
  const [[b]] = await conn.query(
    'SELECT 1 AS ok FROM task_boards WHERE id = ? AND (owner_id = ? OR id IN (SELECT board_id FROM task_members WHERE user_id = ?))',
    [boardId, userId, userId]
  );
  return Boolean(b);
}

// May the device's user write this row? `row` has local ids; `existing` is
// the row already here (or null for a new one).
export async function canWrite(conn, table, row, existing, scope) {
  const u = scope.userId;
  if (table === 'users') return existing ? Number(existing.id) === u : false;
  if (table === 'system_events') return true;
  if (table === 'task_boards') {
    if (existing) return onBoard(conn, existing.id, u);
    return Number(row.owner_id) === u;
  }
  if (OWNER_COLUMN[table]) {
    const col = OWNER_COLUMN[table];
    if (existing && Number(existing[col]) !== u) return false;
    return !(col in row) || Number(row[col]) === u;
  }
  if (PARENT[table]) {
    const [col, parent] = PARENT[table];
    const check = async (pid) => (parent === 'task_boards' ? onBoard(conn, pid, u) : (await ownerOf(conn, parent, pid)) === u);
    if (existing && !(await check(existing[col]))) return false;
    return !(col in row) || check(row[col]);
  }
  return false;
}

// A device never changes who is an admin, or who created an account.
export function cleanIncomingUser(row) {
  const r = { ...row };
  delete r.is_admin;
  delete r.created_by;
  delete r.email;
  return r;
}

export const ownedColumn = (table) => OWNER_COLUMN[table] || (PARENT[table] ? PARENT[table][0] : table === 'task_boards' ? 'owner_id' : null);
