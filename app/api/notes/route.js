import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const title = (body.title || '').trim();
  if (!title) return NextResponse.json({ error: 'Note title is required.' }, { status: 400 });

  let parentId = null;
  if (body.parent_id !== undefined && body.parent_id !== null && body.parent_id !== '') {
    const parentRows = await query('SELECT id FROM notes WHERE id = ? AND user_id = ?', [
      body.parent_id,
      user.id,
    ]);
    if (parentRows.length === 0) {
      return NextResponse.json({ error: 'Parent note not found.' }, { status: 400 });
    }
    parentId = Number(body.parent_id);
  }

  const posRows = await query(
    parentId === null
      ? 'SELECT COALESCE(MAX(position), -1) AS maxPos FROM notes WHERE user_id = ? AND parent_id IS NULL'
      : 'SELECT COALESCE(MAX(position), -1) AS maxPos FROM notes WHERE user_id = ? AND parent_id = ?',
    parentId === null ? [user.id] : [user.id, parentId]
  );
  const position = posRows[0].maxPos + 1;

  // 'plain' = the plain text / code editor (content kept exactly as typed).
  const style = body.mode === 'plain' ? JSON.stringify({ mode: 'plain' }) : null;

  const noteUuid = randomUUID();
  const result = await query(
    'INSERT INTO notes (user_id, parent_id, uuid, title, content, style, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, parentId, noteUuid, title, '', style, position]
  );

  return NextResponse.json({ ok: true, noteId: result.insertId, noteUuid });
});
