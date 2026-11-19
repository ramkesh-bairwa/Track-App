import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { fieldTypeMeta } from '@/lib/fieldTypes';
import { withApiErrors } from '@/lib/apiError';
import { logTrack, propChange } from '@/lib/trackLog';
import { checkDeletePassword } from '@/lib/deleteGuard';

async function assertOwnership(trackId, userId) {
  const rows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [trackId, userId]);
  return rows.length > 0;
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: trackId, columnId } = params;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const label = (body.label || '').trim();
  if (!label) return NextResponse.json({ error: 'Column label is required.' }, { status: 400 });

  const fieldType = typeof body.field_type === 'string' ? body.field_type : null;
  const meta = fieldType ? fieldTypeMeta(fieldType) : null;

  const fields = ['label = ?'];
  const values = [label.slice(0, 255)];

  if (fieldType) {
    fields.push('field_type = ?');
    values.push(fieldType);

    const fieldLength =
      meta.supportsLength && typeof body.field_length === 'string' && body.field_length.trim()
        ? body.field_length.trim().slice(0, 20)
        : null;
    fields.push('field_length = ?');
    values.push(fieldLength);

    const options = meta.supportsOptions ? body.options || '' : null;
    fields.push('options = ?');
    values.push(options);
  }

  const before = (await query('SELECT * FROM track_columns WHERE id = ? AND track_id = ?', [columnId, trackId]))[0];
  values.push(columnId, trackId);
  await query(`UPDATE track_columns SET ${fields.join(', ')} WHERE id = ? AND track_id = ?`, values);

  const rows = await query('SELECT * FROM track_columns WHERE id = ?', [columnId]);
  const after = rows[0];
  if (before && after) {
    const changes = [];
    if (before.label !== after.label) changes.push(propChange('label', 'Name', before.label, after.label));
    if (before.field_type !== after.field_type) {
      changes.push(propChange('type', 'Type', fieldTypeMeta(before.field_type).label, fieldTypeMeta(after.field_type).label));
    }
    if (String(before.options ?? '') !== String(after.options ?? '')) changes.push(propChange('options', 'Options', before.options, after.options));
    if (String(before.field_length ?? '') !== String(after.field_length ?? '')) changes.push(propChange('length', 'Length', before.field_length, after.field_length));
    if (changes.length) {
      await logTrack({ trackId, user, action: 'column_update', summary: `Edited column “${after.label}”`, changes });
    }
  }
  return NextResponse.json({ ok: true, column: rows[0] });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: trackId, columnId } = params;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const denied = await checkDeletePassword(request, user);
  if (denied) return denied;
  const gone = (await query('SELECT label, field_type FROM track_columns WHERE id = ? AND track_id = ?', [columnId, trackId]))[0];
  await query('DELETE FROM track_columns WHERE id = ? AND track_id = ?', [columnId, trackId]);
  if (gone) {
    await logTrack({
      trackId,
      user,
      action: 'column_remove',
      summary: `Removed column “${gone.label}”`,
      changes: [{ key: 'type', label: 'Type', oldText: fieldTypeMeta(gone.field_type).label, newText: '' }],
    });
  }
  return NextResponse.json({ ok: true });
});
