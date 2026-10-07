import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { getBoardAccess, canSeeTask, normalizeTask, logActivity } from '@/lib/taskServer';

// Logs "viewed task" when someone opens a task — at most once per person per
// task every 10 minutes, so reopening it doesn't flood the history.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await query('SELECT * FROM tasks WHERE id = ? AND board_id = ? AND deleted_at IS NULL', [
    params.taskId,
    access.board.id,
  ]);
  const task = rows[0] ? normalizeTask(rows[0]) : null;
  if (!task || !canSeeTask(access, task, user.id)) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const recent = await query(
    `SELECT id FROM task_activity
      WHERE task_id = ? AND user_id = ? AND action = 'task_view' AND created_at > NOW() - INTERVAL 10 MINUTE
      LIMIT 1`,
    [task.id, user.id]
  );
  if (recent.length === 0) {
    await logActivity(null, {
      boardId: access.board.id,
      taskId: task.id,
      user,
      action: 'task_view',
      summary: `Viewed task "${task.title}"`,
    });
  }
  return NextResponse.json({ ok: true });
});
