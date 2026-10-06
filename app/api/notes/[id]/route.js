import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { hit, reset } from '@/lib/rateLimit';

async function assertOwnership(noteId, userId) {
  const rows = await query('SELECT id FROM notes WHERE id = ? AND user_id = ?', [noteId, userId]);
  return rows.length > 0;
}

export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await query('SELECT * FROM notes WHERE id = ? AND user_id = ?', [params.id, user.id]);
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ note: rows[0] });
});

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const noteId = params.id;
  if (!(await assertOwnership(noteId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];

  if (typeof body.title === 'string' && body.title.trim()) {
    fields.push('title = ?');
    values.push(body.title.trim());
  }
  if (typeof body.content === 'string') {
    fields.push('content = ?');
    values.push(body.content);
  }
  if (body.style !== undefined) {
    fields.push('style = ?');
    values.push(body.style ? JSON.stringify(body.style) : null);
  }
  if (body.parent_id !== undefined) {
    if (body.parent_id === null) {
      fields.push('parent_id = ?');
      values.push(null);
    } else {
      const parentId = Number(body.parent_id);
      if (parentId === Number(noteId)) {
        return NextResponse.json({ error: 'A note cannot be its own parent.' }, { status: 400 });
      }
      const parentRows = await query('SELECT id FROM notes WHERE id = ? AND user_id = ?', [
        parentId,
        user.id,
      ]);
      if (parentRows.length === 0) {
        return NextResponse.json({ error: 'Parent note not found.' }, { status: 400 });
      }
      const descendants = await query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM notes WHERE id = ?
           UNION ALL
           SELECT n.id FROM notes n JOIN descendants d ON n.parent_id = d.id
         )
         SELECT id FROM descendants`,
        [noteId]
      );
      if (descendants.some((r) => r.id === parentId)) {
        return NextResponse.json(
          { error: 'Cannot move a note into one of its own sub-notes.' },
          { status: 400 }
        );
      }
      fields.push('parent_id = ?');
      values.push(parentId);
    }
  }

  if (fields.length === 0) return NextResponse.json({ ok: true });

  values.push(noteId);
  await query(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`, values);
  const rows = await query('SELECT * FROM notes WHERE id = ?', [noteId]);
  return NextResponse.json({ ok: true, note: rows[0] });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const noteId = params.id;
  if (!(await assertOwnership(noteId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Deleting a note always needs a password: the privacy password if one is
  // set (Settings → Privacy), otherwise the account's login password.
  const limitKey = `note-delete:${user.id}`;
  const limit = hit(limitKey, { max: 10, windowMs: 15 * 60 * 1000 });
  if (limit.limited) {
    return NextResponse.json(
      { error: 'Too many wrong passwords. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }
  const body = await request.json().catch(() => ({}));
  const [pw] = await query('SELECT password, action_password FROM users WHERE id = ?', [user.id]);
  if (!pw || !(await verifyPassword(String(body.password || ''), pw.action_password || pw.password))) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 403 });
  }
  reset(limitKey);

  const descendants = await query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM notes WHERE id = ?
       UNION ALL
       SELECT n.id FROM notes n JOIN descendants d ON n.parent_id = d.id
     )
     SELECT id FROM descendants`,
    [noteId]
  );
  const ids = descendants.map((r) => r.id);
  await query(
    `DELETE FROM notes WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [user.id, ...ids]
  );
  return NextResponse.json({ ok: true });
});
