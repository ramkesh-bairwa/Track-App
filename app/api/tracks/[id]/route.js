import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { sanitizeIcon } from '@/lib/icon';
import { withApiErrors } from '@/lib/apiError';
import { TRACK_VIEW_TYPES } from '@/lib/trackTypes';
import { logTrack, propChange } from '@/lib/trackLog';
import { checkDeletePassword } from '@/lib/deleteGuard';

const trackName = async (id) => (id ? (await query('SELECT name FROM tracks WHERE id = ?', [id]))[0]?.name || '' : '');

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
  const before = (await query('SELECT * FROM tracks WHERE id = ?', [trackId]))[0];
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

  const after = (await query('SELECT * FROM tracks WHERE id = ?', [trackId]))[0];
  const changes = [];
  const cmp = (key, label, fmt = (v) => v ?? '') => {
    if (String(before[key] ?? '') !== String(after[key] ?? '')) changes.push(propChange(key, label, fmt(before[key]), fmt(after[key])));
  };
  cmp('name', 'Name');
  cmp('description', 'Description');
  cmp('color', 'Colour');
  cmp('view_type', 'Layout', (v) => TRACK_VIEW_TYPES.find((t) => t.key === v)?.label || v || '');
  if (before.icon !== after.icon || before.icon_type !== after.icon_type) {
    changes.push({ key: 'icon', label: 'Icon', oldText: '', newText: after.icon_type === 'image' ? 'New image' : after.icon || '' });
  }
  if (String(before.parent_id ?? '') !== String(after.parent_id ?? '')) {
    const from = (await trackName(before.parent_id)) || 'top level';
    const to = (await trackName(after.parent_id)) || 'top level';
    changes.push(propChange('parent', 'Moved', from, to));
    if (before.parent_id) await logTrack({ trackId: before.parent_id, user, action: 'subtrack_remove', summary: `Sub-track “${after.name}” moved to ${to}` });
    if (after.parent_id) await logTrack({ trackId: after.parent_id, user, action: 'subtrack_add', summary: `Sub-track “${after.name}” moved here from ${from}` });
  }
  if (changes.length) {
    const only = changes.length === 1 ? changes[0].key : '';
    const summary =
      only === 'name' ? `Renamed track to “${after.name}”` : only === 'parent' ? 'Moved track' : only === 'view_type' ? 'Changed layout' : 'Edited track details';
    await logTrack({ trackId, user, action: 'track_update', summary, changes });
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

  const denied = await checkDeletePassword(request, user);
  if (denied) return denied;

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
  // History is kept: the deleted track gets a last line, and its parent
  // (for a sub-track) a line about it.
  const gone = (await query('SELECT name, parent_id FROM tracks WHERE id = ?', [trackId]))[0];
  if (gone) {
    const counts = (await query(
      `SELECT COUNT(*) AS n FROM track_entries WHERE track_id IN (${ids.map(() => '?').join(',')})`,
      ids
    ))[0];
    const subs = ids.length - 1;
    const what = `(${counts.n} record${Number(counts.n) === 1 ? '' : 's'}${subs ? `, ${subs} sub-track${subs === 1 ? '' : 's'}` : ''})`;
    const parentName = gone.parent_id ? (await query('SELECT name FROM tracks WHERE id = ?', [gone.parent_id]))[0]?.name : null;
    await logTrack({
      trackId,
      user,
      action: 'track_delete',
      summary: `Deleted ${gone.parent_id ? 'sub-track' : 'track'} “${gone.name}” ${what}${parentName ? ` from “${parentName}”` : ''}`,
    });
    if (gone.parent_id) {
      await logTrack({ trackId: gone.parent_id, user, action: 'subtrack_delete', summary: `Deleted sub-track “${gone.name}” ${what}` });
    }
  }
  await query(
    `DELETE FROM tracks WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [user.id, ...ids]
  );
  return NextResponse.json({ ok: true });
});
