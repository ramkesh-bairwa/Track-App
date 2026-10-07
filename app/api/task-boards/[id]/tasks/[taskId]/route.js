import { NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import {
  getBoardAccess,
  canSeeTask,
  normalizeTask,
  boardStatuses,
  boardColumns,
  boardPeople,
  sanitizeTaskInput,
  applyValues,
  diffTask,
  writeTask,
  logActivity,
} from '@/lib/taskServer';
import { taskCollaborators } from '@/lib/taskConfig';

async function loadTask(params, user) {
  const access = await getBoardAccess(params.id, user);
  if (!access) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  const rows = await query('SELECT * FROM tasks WHERE id = ? AND board_id = ? AND deleted_at IS NULL', [
    params.taskId,
    access.board.id,
  ]);
  const task = rows[0] ? normalizeTask(rows[0]) : null;
  if (!task || !canSeeTask(access, task, user.id)) {
    return { error: NextResponse.json({ error: 'Task not found' }, { status: 404 }) };
  }
  return { access, task };
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { access, task, error } = await loadTask(params, user);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const { board } = access;
  const [columns, people] = await Promise.all([boardColumns(board.id), boardPeople(board)]);
  const result = sanitizeTaskInput(body, { statuses: boardStatuses(board), columns, people, partial: true });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

  // Without edit rights, the assignee or a collaborator may still move the task's status.
  const onlyStatus = Object.keys(result.values).every((k) => k === 'status');
  const allowed = access.canEdit || (onlyStatus && (task.assignee_id === user.id || taskCollaborators(task).includes(user.id)));
  if (!allowed) {
    return NextResponse.json({ error: "You don't have permission to edit this task." }, { status: 403 });
  }

  const next = applyValues(task, result.values);
  const changes = diffTask(task, next, columns, people);
  if (changes.length === 0) return NextResponse.json({ ok: true, unchanged: true });

  let activityId = null;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await writeTask(conn, task.id, next, user.id);
    activityId = await logActivity(conn, {
      boardId: board.id,
      taskId: task.id,
      user,
      action: 'task_update',
      summary:
        changes.length === 1
          ? `Changed ${changes[0].label.toLowerCase()} of "${next.title}"`
          : `Updated ${changes.length} fields of "${next.title}"`,
      changes,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true, activity_id: activityId });
});

// Soft delete, so the admin can bring it back from the activity log.
export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { access, task, error } = await loadTask(params, user);
  if (error) return error;
  if (!access.canDelete) {
    return NextResponse.json({ error: "You don't have permission to delete tasks on this board." }, { status: 403 });
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE tasks SET deleted_at = NOW(), updated_by = ? WHERE id = ?', [user.id, task.id]);
    await logActivity(conn, {
      boardId: access.board.id,
      taskId: task.id,
      user,
      action: 'task_delete',
      summary: `Deleted task "${task.title}"`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return NextResponse.json({ ok: true });
});
