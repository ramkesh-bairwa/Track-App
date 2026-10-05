import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { slugifyKey, fieldTypeMeta } from '@/lib/fieldTypes';
import { withApiErrors } from '@/lib/apiError';

async function assertOwnership(trackId, userId) {
  const rows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [trackId, userId]);
  return rows.length > 0;
}

export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const trackId = params.id;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const label = (body.label || '').trim();
  const fieldType = body.field_type || 'text';
  const meta = fieldTypeMeta(fieldType);
  const options = meta.supportsOptions ? body.options || '' : null;
  const fieldLength =
    meta.supportsLength && typeof body.field_length === 'string' && body.field_length.trim()
      ? body.field_length.trim().slice(0, 20)
      : null;
  const autoIncrement = Boolean(body.auto_increment);
  if (!label) return NextResponse.json({ error: 'Column label is required.' }, { status: 400 });

  try {
    if (autoIncrement) {
      const existingAI = await query(
        'SELECT id FROM track_columns WHERE track_id = ? AND is_auto_increment = 1',
        [trackId]
      );
      if (existingAI.length > 0) {
        return NextResponse.json(
          { error: 'This track already has an auto-increment column.' },
          { status: 400 }
        );
      }
    }

    const existing = await query('SELECT field_key FROM track_columns WHERE track_id = ?', [trackId]);
    const key = slugifyKey(label, existing.map((r) => r.field_key));

    const posRows = await query(
      'SELECT COALESCE(MAX(position), -1) AS maxPos FROM track_columns WHERE track_id = ?',
      [trackId]
    );
    const position = posRows[0].maxPos + 1;

    const result = await query(
      'INSERT INTO track_columns (track_id, label, field_key, field_type, options, field_length, is_auto_increment, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [trackId, label, key, fieldType, options, fieldLength, autoIncrement ? 1 : 0, position]
    );

    return NextResponse.json({
      ok: true,
      column: {
        id: result.insertId,
        track_id: Number(trackId),
        label,
        field_key: key,
        field_type: fieldType,
        options,
        field_length: fieldLength,
        is_auto_increment: autoIncrement,
        position,
      },
    });
  } catch (err) {
    console.error('Failed to create column:', err);
    return NextResponse.json({ error: err.sqlMessage || err.message || 'Could not add the column.' }, { status: 500 });
  }
});

// Reorder columns: body = { order: [columnId, columnId, ...] }
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const trackId = params.id;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const order = Array.isArray(body.order) ? body.order : [];
  await Promise.all(
    order.map((colId, index) =>
      query('UPDATE track_columns SET position = ? WHERE id = ? AND track_id = ?', [index, colId, trackId])
    )
  );
  return NextResponse.json({ ok: true });
});
