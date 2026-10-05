import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { DEFAULT_STATUSES } from '@/lib/taskConfig';
import { logActivity, listBoardsFor, sanitizeColumnDef } from '@/lib/taskServer';

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ boards: await listBoardsFor(user.id) });
});

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
  const visibility = body.visibility === 'public' ? 'public' : 'private';
  const showSerial = body.show_serial ? 1 : 0;
  if (!name) return NextResponse.json({ error: 'Give the board a name.' }, { status: 400 });

  // `columns` present → the creator chose custom columns; otherwise the
  // board gets the default attachment column.
  let columnDefs = [{ label: 'Attachment', key: 'attachment', fieldType: 'file', options: null }];
  if (Array.isArray(body.columns)) {
    columnDefs = [];
    for (const def of body.columns.slice(0, 50)) {
      const col = sanitizeColumnDef(def, columnDefs.map((c) => ({ field_key: c.key })));
      if (col.error) return NextResponse.json({ error: col.error }, { status: 400 });
      columnDefs.push(col);
    }
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const uuid = randomUUID();
    const [res] = await conn.execute(
      'INSERT INTO task_boards (uuid, owner_id, name, description, visibility, statuses, show_serial) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid, user.id, name, description || null, visibility, JSON.stringify(DEFAULT_STATUSES), showSerial]
    );
    const boardId = res.insertId;
    for (const [i, col] of columnDefs.entries()) {
      await conn.execute(
        'INSERT INTO task_columns (board_id, label, field_key, field_type, options, position) VALUES (?, ?, ?, ?, ?, ?)',
        [boardId, col.label, col.key, col.fieldType, col.options, i]
      );
    }
    await logActivity(conn, {
      boardId,
      user,
      action: 'board_create',
      summary: `Created the board "${name}" (${visibility})`,
    });
    await conn.commit();
    return NextResponse.json({ ok: true, uuid });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});
