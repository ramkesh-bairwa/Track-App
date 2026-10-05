import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { taskFieldTypeMeta } from '@/lib/taskConfig';
import { getBoardAccess, logActivity } from '@/lib/taskServer';

async function loadColumn(params, user) {
  const access = await getBoardAccess(params.id, user);
  if (!access) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (!access.isAdmin) {
    return { error: NextResponse.json({ error: 'Only the board admin can change columns.' }, { status: 403 }) };
  }
  const rows = await query('SELECT * FROM task_columns WHERE id = ? AND board_id = ?', [params.columnId, access.board.id]);
  if (!rows[0]) return { error: NextResponse.json({ error: 'Column not found' }, { status: 404 }) };
  return { access, column: rows[0] };
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { access, column, error } = await loadColumn(params, user);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const changes = [];
  const fields = [];
  const values = [];
  if (typeof body.label === 'string') {
    const label = body.label.trim().slice(0, 255);
    if (!label) return NextResponse.json({ error: 'The column needs a name.' }, { status: 400 });
    if (label !== column.label) {
      fields.push('label = ?');
      values.push(label);
      changes.push({ key: 'label', label: 'Column name', oldText: column.label, newText: label });
    }
  }
  if (typeof body.options === 'string' && taskFieldTypeMeta(column.field_type).supportsOptions) {
    const options = body.options.slice(0, 2000);
    if (options !== (column.options || '')) {
      fields.push('options = ?');
      values.push(options);
      changes.push({ key: 'options', label: 'Options', oldText: column.options || '', newText: options });
    }
  }
  if (fields.length === 0) return NextResponse.json({ ok: true });
  values.push(column.id);
  await query(`UPDATE task_columns SET ${fields.join(', ')} WHERE id = ?`, values);
  await logActivity(null, {
    boardId: access.board.id,
    user,
    action: 'column_update',
    summary: `Edited the column "${column.label}"`,
    changes,
  });
  return NextResponse.json({ ok: true });
});

// Removing a column hides it; the values stay inside each task's data, so
// nothing already entered is destroyed.
export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { access, column, error } = await loadColumn(params, user);
  if (error) return error;
  await query('DELETE FROM task_columns WHERE id = ?', [column.id]);
  await logActivity(null, {
    boardId: access.board.id,
    user,
    action: 'column_remove',
    summary: `Removed the column "${column.label}"`,
  });
  return NextResponse.json({ ok: true });
});
