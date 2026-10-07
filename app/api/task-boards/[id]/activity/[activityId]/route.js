import { NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { getBoardAccess, canSeeTask, normalizeTask, logActivity } from '@/lib/taskServer';

const MAX_NOTE = 1000;

// Add, edit or clear the note on one log entry. The entry's own record never
// changes — every note change is logged as a new 'log_note' entry with the
// old → new text, so notes are just as trackable as task edits.
// Anyone who can see the entry may add a note; only the note's author or the
// board admin may change or clear an existing one.
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { board } = access;

  const rows = await query('SELECT * FROM task_activity WHERE id = ? AND board_id = ?', [params.activityId, board.id]);
  const entry = rows[0];
  if (!entry) return NextResponse.json({ error: 'That log entry was not found.' }, { status: 404 });
  if (entry.task_id) {
    const taskRows = await query('SELECT * FROM tasks WHERE id = ? AND board_id = ?', [entry.task_id, board.id]);
    if (taskRows[0] && !canSeeTask(access, normalizeTask(taskRows[0]), user.id)) {
      return NextResponse.json({ error: 'That log entry was not found.' }, { status: 404 });
    }
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body.note !== 'string') return NextResponse.json({ error: 'Send the note text.' }, { status: 400 });
  const note = body.note.trim().slice(0, MAX_NOTE);
  const before = entry.note || '';
  if (note === before) return NextResponse.json({ ok: true });
  if (before && entry.note_by !== user.id && !access.isAdmin) {
    return NextResponse.json({ error: 'Only the person who wrote this note, or the board admin, can change it.' }, { status: 403 });
  }

  const verb = !before ? 'Added a note to' : !note ? 'Removed the note from' : 'Edited the note on';
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE task_activity SET note = ?, note_by = ?, note_at = NOW() WHERE id = ?', [
      note || null,
      note ? user.id : null,
      entry.id,
    ]);
    await logActivity(conn, {
      boardId: board.id,
      taskId: entry.task_id,
      user,
      action: 'log_note',
      summary: `${verb} log #${entry.id}`,
      changes: [{ key: 'note', label: `Note on #${entry.id}`, oldText: before, newText: note }],
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
