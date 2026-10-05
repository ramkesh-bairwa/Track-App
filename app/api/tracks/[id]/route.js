import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { sanitizeIcon } from '@/lib/icon';
import { withApiErrors } from '@/lib/apiError';
import { TRACK_VIEW_TYPES } from '@/lib/trackTypes';

async function assertOwnership(trackId, userId) {
  const rows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [trackId, userId]);
  return rows.length > 0;
}

export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const trackId = params.id;
  const tracks = await query('SELECT * FROM tracks WHERE id = ? AND user_id = ?', [trackId, user.id]);
  const track = tracks[0];
  if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const columns = await query(
    'SELECT * FROM track_columns WHERE track_id = ? ORDER BY position ASC, id ASC',
    [trackId]
  );
  const entries = await query(
    'SELECT * FROM track_entries WHERE track_id = ? ORDER BY created_at DESC',
    [trackId]
  );

  return NextResponse.json({ track, columns, entries });
});

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const trackId = params.id;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    fields.push('name = ?');
    values.push(body.name.trim());
  }
  if (typeof body.description === 'string') {
    fields.push('description = ?');
    values.push(body.description.trim() || null);
  }
  if (typeof body.icon === 'string' || typeof body.icon_type === 'string') {
    const iconResult = sanitizeIcon(body.icon_type, body.icon ?? '');
    if (iconResult.error) {
      return NextResponse.json({ error: iconResult.error }, { status: 400 });
    }
    fields.push('icon = ?', 'icon_type = ?');
    values.push(iconResult.icon, iconResult.icon_type);
  }
  if (typeof body.view_type === 'string') {
    if (!TRACK_VIEW_TYPES.some((t) => t.key === body.view_type)) {
      return NextResponse.json({ error: 'Unknown track type.' }, { status: 400 });
    }
    fields.push('view_type = ?');
    values.push(body.view_type);
  }
  if (typeof body.color === 'string' && body.color.trim()) {
    fields.push('color = ?');
    values.push(body.color.trim().slice(0, 20));
  }
  if (body.parent_id !== undefined) {
    if (body.parent_id === null) {
      fields.push('parent_id = ?');
      values.push(null);
    } else {
      const parentId = Number(body.parent_id);
      if (parentId === Number(trackId)) {
        return NextResponse.json({ error: 'A track cannot be its own parent.' }, { status: 400 });
      }
      const parentRows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [
        parentId,
        user.id,
      ]);
      if (parentRows.length === 0) {
        return NextResponse.json({ error: 'Parent track not found.' }, { status: 400 });
      }
      // A track can't move underneath one of its own sub-tracks — that would
      // create a cycle, since parent_id has no DB-level constraint to catch it.
      const descendants = await query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM tracks WHERE id = ?
           UNION ALL
           SELECT t.id FROM tracks t JOIN descendants d ON t.parent_id = d.id
         )
         SELECT id FROM descendants`,
        [trackId]
      );
      if (descendants.some((r) => r.id === parentId)) {
        return NextResponse.json(
          { error: 'Cannot move a track into one of its own sub-tracks.' },
          { status: 400 }
        );
      }
      fields.push('parent_id = ?');
      values.push(parentId);
    }
  }
  if (fields.length === 0) return NextResponse.json({ ok: true });

  values.push(trackId);
  try {
    await query(`UPDATE tracks SET ${fields.join(', ')} WHERE id = ?`, values);
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR' && typeof body.view_type === 'string') {
      return NextResponse.json(
        { error: 'Track types need a database update — run `npm run seed`, then try again.' },
        { status: 409 }
      );
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const trackId = params.id;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // parent_id has no DB-level foreign key (see schema.sql), so sub-tracks at any
  // depth are cascaded here rather than left orphaned or blocking the delete.
  const descendants = await query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM tracks WHERE id = ?
       UNION ALL
       SELECT t.id FROM tracks t JOIN descendants d ON t.parent_id = d.id
     )
     SELECT id FROM descendants`,
    [trackId]
  );
  const ids = descendants.map((r) => r.id);
  await query(
    `DELETE FROM tracks WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [user.id, ...ids]
  );
  return NextResponse.json({ ok: true });
});
