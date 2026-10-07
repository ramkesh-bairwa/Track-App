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
  diffTask,
  logActivity,
} from '@/lib/taskServer';

export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canAdd) return NextResponse.json({ error: "You don't have permission to add tasks on this board." }, { status: 403 });

  const { board } = access;
  const [columns, people] = await Promise.all([boardColumns(board.id), boardPeople(board)]);
  const body = await request.json().catch(() => ({}));
  const { values, error } = sanitizeTaskInput(body, { statuses: boardStatuses(board), columns, people, partial: false });
  if (error) return NextResponse.json({ error }, { status: 400 });

  const task = {
    title: values.title,
    description: values.description || '',
    status: values.status,
    priority: values.priority,
    assignee_id: values.assignee_id ?? null,
    due_date: values.due_date ?? null,
    data: values.data || {},
  };

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const uuid = randomUUID();
    const [res] = await conn.execute(
      `INSERT INTO tasks (uuid, board_id, title, description, status, priority, assignee_id, due_date, data, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid,
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
    // A creation logs every filled-in field as "(empty) → value".
    const changes = diffTask({ data: {} }, task, columns, people);
    const activityId = await logActivity(conn, {
      boardId: board.id,
      taskId: res.insertId,
      user,
      action: 'task_create',
      summary: `Created task "${task.title}"`,
      changes,
    });
    await conn.commit();
    return NextResponse.json({ ok: true, id: res.insertId, uuid, activity_id: activityId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});
