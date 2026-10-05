import { NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import {
  getBoardAccess,
  parseJson,
  normalizeTask,
  boardStatuses,
  boardColumns,
  boardPeople,
  applyValues,
  diffTask,
  writeTask,
  logActivity,
  REVERTIBLE_ACTIONS,
} from '@/lib/taskServer';

// Admin only. Undoes one logged task change and logs the undo itself, so the
// revert is just as visible in the history as the change it reverses.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only the board admin can revert changes.' }, { status: 403 });

  const { board } = access;
  const rows = await query('SELECT * FROM task_activity WHERE id = ? AND board_id = ?', [params.activityId, board.id]);
  const entry = rows[0];
  if (!entry) return NextResponse.json({ error: 'That log entry was not found.' }, { status: 404 });
  if (!REVERTIBLE_ACTIONS.has(entry.action)) {
    return NextResponse.json({ error: 'Board setting changes can’t be reverted from the log — change them back in Settings.' }, { status: 400 });
  }
  if (entry.reverted_at) return NextResponse.json({ error: 'This change was already reverted.' }, { status: 400 });

  const taskRows = await query('SELECT * FROM tasks WHERE id = ? AND board_id = ?', [entry.task_id, board.id]);
  if (!taskRows[0]) return NextResponse.json({ error: 'The task no longer exists.' }, { status: 404 });
  const task = normalizeTask(taskRows[0]);
  const isDeleted = Boolean(taskRows[0].deleted_at);

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const base = { boardId: board.id, taskId: task.id, user, revertOf: entry.id };

    if (entry.action === 'task_create' || entry.action === 'task_restore') {
      if (isDeleted) throw new RevertError('The task is already deleted.');
      await conn.execute('UPDATE tasks SET deleted_at = NOW(), updated_by = ? WHERE id = ?', [user.id, task.id]);
      await logActivity(conn, {
        ...base,
        action: 'task_delete',
        summary: `Reverted #${entry.id}: removed task "${task.title}"`,
      });
    } else if (entry.action === 'task_delete') {
      if (!isDeleted) throw new RevertError('The task is not deleted.');
      await conn.execute('UPDATE tasks SET deleted_at = NULL, updated_by = ? WHERE id = ?', [user.id, task.id]);
      await logActivity(conn, {
        ...base,
        action: 'task_restore',
        summary: `Reverted #${entry.id}: restored task "${task.title}"`,
      });
    } else {
      if (isDeleted) throw new RevertError('The task is deleted — revert its deletion first.');
      const [columns, people] = await Promise.all([boardColumns(board.id), boardPeople(board)]);
      const statuses = boardStatuses(board);
      const values = { data: {} };
      for (const change of parseJson(entry.changes, []) || []) {
        if (change.key.startsWith('data.')) values.data[change.key.slice(5)] = change.old;
        else values[change.key] = change.old;
      }
      if (values.status && !statuses.some((s) => s.name === values.status)) {
        throw new RevertError(`The status "${values.status}" no longer exists on this board.`);
      }
      if (values.title === null || values.title === '') delete values.title;
      const next = applyValues(task, values);
      const changes = diffTask(task, next, columns, people);
      if (changes.length === 0) throw new RevertError('Nothing to revert — the task already has those values.');
      await writeTask(conn, task.id, next, user.id);
      await logActivity(conn, {
        ...base,
        action: 'task_update',
        summary: `Reverted #${entry.id} on "${next.title}"`,
        changes,
      });
    }

    await conn.execute('UPDATE task_activity SET reverted_by = ?, reverted_at = NOW() WHERE id = ?', [user.id, entry.id]);
    await conn.commit();
    return NextResponse.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    if (err instanceof RevertError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  } finally {
    conn.release();
  }
});

class RevertError extends Error {}
