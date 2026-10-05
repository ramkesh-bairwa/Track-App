// Server-only helpers for the task assigner: access checks, visibility,
// validation, diffing and the activity log. Every route under
// /api/task-boards goes through getBoardAccess() first.
import { query } from './db';
import { slugifyKey } from './fieldTypes';
import { DEFAULT_STATUSES, PRIORITIES, BUILTIN_TASK_FIELDS, TASK_FIELD_TYPES, MAX_TASK_FILE_BYTES } from './taskConfig';

// Every board the user can open: ones they administer plus ones they're a member of.
export async function listBoardsFor(userId) {
  return query(
    `SELECT b.id, b.uuid, b.name, b.description, b.visibility, b.owner_id, b.created_at,
            o.name AS owner_name,
            (b.owner_id = ?) AS is_admin,
            (SELECT COUNT(*) FROM task_members m WHERE m.board_id = b.id) + 1 AS member_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id AND t.deleted_at IS NULL) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id AND t.deleted_at IS NULL AND t.assignee_id = ?) AS my_task_count
       FROM task_boards b
       JOIN users o ON o.id = b.owner_id
      WHERE b.owner_id = ? OR b.id IN (SELECT board_id FROM task_members WHERE user_id = ?)
      ORDER BY b.created_at DESC`,
    [userId, userId, userId, userId]
  );
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function boardStatuses(board) {
  const list = parseJson(board.statuses, null);
  return Array.isArray(list) && list.length > 0 ? list : DEFAULT_STATUSES;
}

// → { board, isAdmin, canAdd, canEdit, canDelete } for the signed-in user,
// or null when they are neither the board's admin nor a member.
export async function getBoardAccess(boardUuid, user) {
  if (!user) return null;
  const rows = await query('SELECT * FROM task_boards WHERE uuid = ?', [boardUuid]);
  const board = rows[0];
  if (!board) return null;
  if (board.owner_id === user.id) {
    return { board, isAdmin: true, canAdd: true, canEdit: true, canDelete: true };
  }
  const members = await query('SELECT * FROM task_members WHERE board_id = ? AND user_id = ?', [board.id, user.id]);
  const m = members[0];
  if (!m) return null;
  return {
    board,
    isAdmin: false,
    canAdd: Boolean(m.can_add),
    canEdit: Boolean(m.can_edit),
    canDelete: Boolean(m.can_delete),
  };
}

// On a private board a member only sees tasks assigned to or created by them.
export function canSeeTask(access, task, userId) {
  if (access.isAdmin || access.board.visibility === 'public') return true;
  return task.assignee_id === userId || task.created_by === userId;
}

function visibilityClause(access, userId, alias = 't') {
  if (access.isAdmin || access.board.visibility === 'public') return { sql: '', params: [] };
  return { sql: ` AND (${alias}.assignee_id = ? OR ${alias}.created_by = ?)`, params: [userId, userId] };
}

export function normalizeTask(row) {
  return {
    ...row,
    data: parseJson(row.data, {}) || {},
    due_date: formatDate(row.due_date),
  };
}

function formatDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // DATE columns come back as local-midnight Date objects.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function boardPeople(board) {
  const rows = await query(
    `SELECT u.id, u.name, u.email, u.avatar, 1 AS is_admin, 1 AS can_add, 1 AS can_edit, 1 AS can_delete
       FROM users u WHERE u.id = ?
     UNION ALL
     SELECT u.id, u.name, u.email, u.avatar, 0 AS is_admin, m.can_add, m.can_edit, m.can_delete
       FROM task_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ?`,
    [board.owner_id, board.id]
  );
  return rows.map((r) => ({
    ...r,
    is_admin: Boolean(r.is_admin),
    can_add: Boolean(r.can_add),
    can_edit: Boolean(r.can_edit),
    can_delete: Boolean(r.can_delete),
  }));
}

export async function boardColumns(boardId) {
  return query('SELECT * FROM task_columns WHERE board_id = ? ORDER BY position ASC, id ASC', [boardId]);
}

export async function visibleTasks(access, userId) {
  const vis = visibilityClause(access, userId);
  const rows = await query(
    `SELECT t.* FROM tasks t WHERE t.board_id = ? AND t.deleted_at IS NULL${vis.sql} ORDER BY t.position ASC, t.id DESC`,
    [access.board.id, ...vis.params]
  );
  return rows.map(normalizeTask);
}

// The whole board payload the board page renders from.
export async function loadBoardPayload(access, user) {
  const { board } = access;
  const [columns, people, tasks] = await Promise.all([
    boardColumns(board.id),
    boardPeople(board),
    visibleTasks(access, user.id),
  ]);
  return {
    board: {
      id: board.id,
      uuid: board.uuid,
      name: board.name,
      description: board.description,
      visibility: board.visibility,
      owner_id: board.owner_id,
      statuses: boardStatuses(board),
      column_order: parseJson(board.column_order, null),
      hidden_columns: parseJson(board.hidden_columns, []),
      show_serial: Boolean(board.show_serial),
      created_at: board.created_at,
    },
    access: {
      isAdmin: access.isAdmin,
      canAdd: access.canAdd,
      canEdit: access.canEdit,
      canDelete: access.canDelete,
    },
    columns,
    people,
    tasks,
  };
}

export async function listActivity(access, userId, { taskId = null, limit = 200 } = {}) {
  const vis = visibilityClause(access, userId);
  const params = [access.board.id];
  let where = 'a.board_id = ?';
  if (taskId) {
    where += ' AND a.task_id = ?';
    params.push(taskId);
  }
  // Board-level entries (task_id NULL) are visible to every member; task
  // entries follow the same visibility as the task itself.
  if (vis.sql) {
    where += ` AND (a.task_id IS NULL OR (1=1${vis.sql}))`;
    params.push(...vis.params);
  }
  const rows = await query(
    `SELECT a.*, t.title AS task_title, u.name AS current_user_name, ru.name AS reverted_by_name
       FROM task_activity a
       LEFT JOIN tasks t ON t.id = a.task_id
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN users ru ON ru.id = a.reverted_by
      WHERE ${where}
      ORDER BY a.id DESC
      LIMIT ${Math.min(500, Math.max(1, Number(limit) || 200))}`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    task_id: r.task_id,
    task_title: r.task_title,
    user_id: r.user_id,
    user_name: r.current_user_name || r.user_name || 'Deleted user',
    action: r.action,
    summary: r.summary,
    // Raw old/new values stay server-side (they can hold whole files); the
    // log only needs the display text captured when the change happened.
    changes: (parseJson(r.changes, []) || []).map((c) => ({
      key: c.key,
      label: c.label,
      oldText: c.oldText,
      newText: c.newText,
    })),
    revert_of: r.revert_of,
    reverted_at: r.reverted_at,
    reverted_by_name: r.reverted_by_name,
    revertible: REVERTIBLE_ACTIONS.has(r.action) && !r.reverted_at,
    created_at: r.created_at,
  }));
}

export const REVERTIBLE_ACTIONS = new Set(['task_create', 'task_update', 'task_delete', 'task_restore']);

export async function logActivity(conn, { boardId, taskId = null, user, action, summary, changes = null, revertOf = null }) {
  const sql =
    'INSERT INTO task_activity (board_id, task_id, user_id, user_name, action, summary, changes, revert_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  const params = [
    boardId,
    taskId,
    user.id,
    user.name,
    action,
    summary.slice(0, 500),
    changes ? JSON.stringify(changes) : null,
    revertOf,
  ];
  if (conn) await conn.execute(sql, params);
  else await query(sql, params);
}

// ---------- values, validation & diffs ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATA_URL_RE = /^data:[^,]*,/;

function sanitizeFile(value) {
  if (!value || typeof value !== 'object') return null;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 255) : '';
  const data = typeof value.data === 'string' ? value.data : '';
  if (!name || !DATA_URL_RE.test(data)) return null;
  // base64 is ~4/3 the size of the file it encodes
  if (data.length > MAX_TASK_FILE_BYTES * 1.4 + 200) throw new Error(`"${name}" is too large. Files must be under 2MB.`);
  return {
    name,
    type: typeof value.type === 'string' ? value.type.slice(0, 100) : '',
    size: Number(value.size) || 0,
    data,
  };
}

export function sanitizeColumnValue(column, value) {
  if (value === undefined) return undefined;
  switch (column.field_type) {
    case 'checkbox':
      return Boolean(value);
    case 'number': {
      if (value === '' || value === null) return '';
      const n = Number(value);
      return Number.isFinite(n) ? n : '';
    }
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value) ? value : '';
    case 'file':
      return sanitizeFile(value);
    case 'select': {
      const options = (column.options || '').split(',').map((o) => o.trim()).filter(Boolean);
      return options.includes(value) ? value : '';
    }
    default:
      return typeof value === 'string' ? value.slice(0, 5000) : value == null ? '' : String(value).slice(0, 5000);
  }
}

// Validates a create/update body against the board. Returns { values } with
// only the fields present in the body, or { error }.
export function sanitizeTaskInput(body, { statuses, columns, people, partial }) {
  const values = {};
  if (body.title !== undefined || !partial) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return { error: 'A task needs a title.' };
    values.title = title.slice(0, 255);
  }
  if (body.description !== undefined) {
    values.description = typeof body.description === 'string' ? body.description.slice(0, 20000) : '';
  }
  if (body.status !== undefined || !partial) {
    const status = body.status ?? statuses[0].name;
    if (!statuses.some((s) => s.name === status)) return { error: `"${status}" is not a status on this board.` };
    values.status = status;
  }
  if (body.priority !== undefined || !partial) {
    const priority = body.priority ?? 'Medium';
    if (!PRIORITIES.some((p) => p.name === priority)) return { error: 'Unknown priority.' };
    values.priority = priority;
  }
  if (body.assignee_id !== undefined) {
    if (body.assignee_id === null || body.assignee_id === '') {
      values.assignee_id = null;
    } else {
      const id = Number(body.assignee_id);
      if (!people.some((p) => p.id === id)) return { error: 'Tasks can only be assigned to members of this board.' };
      values.assignee_id = id;
    }
  }
  if (body.due_date !== undefined) {
    if (body.due_date === null || body.due_date === '') values.due_date = null;
    else if (typeof body.due_date === 'string' && DATE_RE.test(body.due_date)) values.due_date = body.due_date;
    else return { error: 'Due date must be a valid date.' };
  }
  if (body.data !== undefined) {
    if (!body.data || typeof body.data !== 'object') return { error: 'Invalid task fields.' };
    const data = {};
    try {
      for (const col of columns) {
        if (!(col.field_key in body.data)) continue;
        data[col.field_key] = sanitizeColumnValue(col, body.data[col.field_key]);
      }
    } catch (err) {
      return { error: err.message };
    }
    values.data = data;
  }
  return { values };
}

function isBlank(v) {
  return v === '' || v === null || v === undefined || v === false;
}

function displayText(field, value, people) {
  if (value === null || value === undefined || value === '') return '';
  if (field.key === 'assignee_id') {
    return people.find((p) => p.id === Number(value))?.name || `User #${value}`;
  }
  if (field.type === 'file') return value?.name || '';
  if (field.type === 'checkbox') return value ? 'Yes' : 'No';
  const text = String(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function sameValue(a, b, type) {
  if (type === 'file') return (a?.data || null) === (b?.data || null) && (a?.name || null) === (b?.name || null);
  if (isBlank(a) && isBlank(b)) return type === 'checkbox' ? Boolean(a) === Boolean(b) : true;
  return String(a) === String(b);
}

export function taskFields(columns) {
  return [
    ...BUILTIN_TASK_FIELDS.map((f) => ({ ...f, type: f.key === 'due_date' ? 'date' : 'builtin' })),
    ...columns.map((c) => ({ key: `data.${c.field_key}`, label: c.label, type: c.field_type })),
  ];
}

export function fieldValue(task, key) {
  if (key.startsWith('data.')) return (task.data || {})[key.slice(5)];
  return task[key];
}

// The list of { key, label, old, new, oldText, newText } between two task states.
export function diffTask(before, after, columns, people) {
  const changes = [];
  for (const field of taskFields(columns)) {
    const oldV = fieldValue(before, field.key);
    const newV = fieldValue(after, field.key);
    if (sameValue(oldV, newV, field.type)) continue;
    changes.push({
      key: field.key,
      label: field.label,
      old: oldV ?? null,
      new: newV ?? null,
      oldText: displayText(field, oldV, people),
      newText: displayText(field, newV, people),
    });
  }
  return changes;
}

// Applies sanitized values onto a task snapshot (without touching the DB).
export function applyValues(task, values) {
  const next = { ...task, data: { ...(task.data || {}) } };
  for (const [k, v] of Object.entries(values)) {
    if (k === 'data') Object.assign(next.data, v);
    else next[k] = v;
  }
  return next;
}

export async function writeTask(conn, taskId, task, userId) {
  await conn.execute(
    `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, assignee_id = ?, due_date = ?, data = ?, updated_by = ?
      WHERE id = ?`,
    [
      task.title,
      task.description || null,
      task.status,
      task.priority,
      task.assignee_id ?? null,
      task.due_date || null,
      JSON.stringify(task.data || {}),
      userId,
      taskId,
    ]
  );
}

export function uniqueFieldKey(label, columns) {
  return slugifyKey(label, columns.map((c) => c.field_key));
}

export function isValidFieldType(id) {
  return TASK_FIELD_TYPES.some((t) => t.id === id);
}

// Validates a { label, field_type, options } column definition → the row to
// insert, or { error }.
export function sanitizeColumnDef(body, columns) {
  const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 255) : '';
  const fieldType = body?.field_type;
  if (!label) return { error: 'Give the column a name.' };
  if (!isValidFieldType(fieldType)) return { error: 'Unknown column type.' };
  const meta = TASK_FIELD_TYPES.find((t) => t.id === fieldType);
  const options = meta.supportsOptions && typeof body.options === 'string' ? body.options.slice(0, 2000) : null;
  return { label, fieldType, options, key: uniqueFieldKey(label, columns) };
}
