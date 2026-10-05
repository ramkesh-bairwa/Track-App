import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { taskFieldTypeMeta } from '@/lib/taskConfig';
import { getBoardAccess, boardColumns, sanitizeColumnDef, logActivity } from '@/lib/taskServer';

export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only the board admin can add columns.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const columns = await boardColumns(access.board.id);
  const { label, fieldType, options, key, error } = sanitizeColumnDef(body, columns);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const res = await query(
    'INSERT INTO task_columns (board_id, label, field_key, field_type, options, position) VALUES (?, ?, ?, ?, ?, ?)',
    [access.board.id, label, key, fieldType, options, columns.length]
  );
  await logActivity(null, {
    boardId: access.board.id,
    user,
    action: 'column_add',
    summary: `Added the column "${label}" (${taskFieldTypeMeta(fieldType).label})`,
  });
  return NextResponse.json({ ok: true, id: res.insertId });
});
