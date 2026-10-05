import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import {
  getBoardAccess,
  boardStatuses,
  boardColumns,
  boardPeople,
  sanitizeTaskInput,
  sanitizeColumnDef,
  diffTask,
  logActivity,
} from '@/lib/taskServer';
import { MAX_IMPORT_ROWS, PRIORITIES, taskFieldTypeMeta } from '@/lib/taskConfig';

// Bulk create from a parsed spreadsheet. The browser does the reading and
// column matching; every row is validated again here, and either all rows
// go in or none do. Each task gets its own "created" log entry, so any one
// of them can still be reverted from the activity log.
//
// `newColumns` ([{ ref, label, field_type, options }], admin only) are board
// columns to create from the file's extra headers; task data refers to them
// by `ref` until they get their real field keys here.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canAdd) return NextResponse.json({ error: "You don't have permission to add tasks on this board." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const rows = Array.isArray(body.tasks) ? body.tasks : [];
  if (rows.length === 0) return NextResponse.json({ error: 'There are no tasks to import.' }, { status: 400 });
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `Import at most ${MAX_IMPORT_ROWS} tasks at a time.` }, { status: 400 });
  }
  const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : 'a file';

  const { board } = access;
  const [existing, people] = await Promise.all([boardColumns(board.id), boardPeople(board)]);
  const statuses = boardStatuses(board);

  const newDefs = Array.isArray(body.newColumns) ? body.newColumns.slice(0, 100) : [];
  if (newDefs.length > 0 && !access.isAdmin) {
    return NextResponse.json({ error: 'Only the board admin can add columns.' }, { status: 403 });
  }
  const created = []; // { ref, label, fieldType, options, key }
  const columns = existing.slice();
  for (const def of newDefs) {
    const col = sanitizeColumnDef(def, columns);
    if (col.error) return NextResponse.json({ error: `Column "${def?.label ?? ''}": ${col.error}` }, { status: 400 });
    created.push({ ...col, ref: String(def.ref) });
    columns.push({ field_key: col.key, field_type: col.fieldType, options: col.options, label: col.label });
  }
  const keyForRef = new Map(created.map((c) => [c.ref, c.key]));

  const tasks = [];
  for (const [i, raw] of rows.entries()) {
    const row = { ...(raw || {}) };
    // A value that doesn't fit this board falls back to the default instead
    // of failing the whole import.
    if (!statuses.some((st) => st.name === row.status)) delete row.status;
    if (!PRIORITIES.some((p) => p.name === row.priority)) delete row.priority;
    if (row.assignee_id != null && !people.some((p) => p.id === Number(row.assignee_id))) row.assignee_id = null;
    if (row.due_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.due_date))) row.due_date = null;
    if (typeof row.title !== 'string' || !row.title.trim()) row.title = `Untitled task (row ${i + 1})`;
    if (row.data && typeof row.data === 'object') {
      row.data = Object.fromEntries(Object.entries(row.data).map(([k, v]) => [keyForRef.get(k) || k, v]));
    }
    const { values, error } = sanitizeTaskInput(row, { statuses, columns, people, partial: false });
    if (error) return NextResponse.json({ error: `Row ${i + 1}: ${error}` }, { status: 400 });
    tasks.push({
      title: values.title,
      description: values.description || '',
      status: values.status,
      priority: values.priority,
      assignee_id: values.assignee_id ?? null,
      due_date: values.due_date ?? null,
      data: values.data || {},
    });
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const [i, col] of created.entries()) {
      await conn.execute(
        'INSERT INTO task_columns (board_id, label, field_key, field_type, options, position) VALUES (?, ?, ?, ?, ?, ?)',
        [board.id, col.label, col.key, col.fieldType, col.options, existing.length + i]
      );
      await logActivity(conn, {
        boardId: board.id,
        user,
        action: 'column_add',
        summary: `Added the column "${col.label}" (${taskFieldTypeMeta(col.fieldType).label}) from ${fileName}`,
      });
    }
    for (const task of tasks) {
      const [res] = await conn.execute(
        `INSERT INTO tasks (uuid, board_id, title, description, status, priority, assignee_id, due_date, data, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          board.id,
          task.title,
          task.description || null,
          task.status,
          task.priority,
          task.assignee_id,
          task.due_date,
          JSON.stringify(task.data),
          user.id,
          user.id,
        ]
      );
      await logActivity(conn, {
        boardId: board.id,
        taskId: res.insertId,
        user,
        action: 'task_create',
        summary: `Created task "${task.title}" (imported)`,
        changes: diffTask({ data: {} }, task, columns, people),
      });
    }
    await logActivity(conn, {
      boardId: board.id,
      user,
      action: 'task_import',
      summary: `Imported ${tasks.length} task${tasks.length === 1 ? '' : 's'} from ${fileName}`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true, count: tasks.length });
});
