import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { fieldTypeMeta } from '@/lib/fieldTypes';
import { withApiErrors } from '@/lib/apiError';

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

  values.push(columnId, trackId);
  await query(`UPDATE track_columns SET ${fields.join(', ')} WHERE id = ? AND track_id = ?`, values);

  const rows = await query('SELECT * FROM track_columns WHERE id = ?', [columnId]);
  return NextResponse.json({ ok: true, column: rows[0] });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: trackId, columnId } = params;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await query('DELETE FROM track_columns WHERE id = ? AND track_id = ?', [columnId, trackId]);
  return NextResponse.json({ ok: true });
});
