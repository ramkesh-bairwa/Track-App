import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { slugifyKey, fieldTypeMeta } from '@/lib/fieldTypes';
import { sanitizeIcon } from '@/lib/icon';
import { withApiErrors } from '@/lib/apiError';
import { normalizeViewType } from '@/lib/trackTypes';

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tracks = await query(
    `SELECT t.*,
       (SELECT COUNT(*) FROM track_entries e WHERE e.track_id = t.id) AS entry_count,
       (SELECT COUNT(*) FROM track_columns c WHERE c.track_id = t.id) AS column_count
     FROM tracks t WHERE t.user_id = ? ORDER BY t.created_at DESC`,
    [user.id]
  );
  return NextResponse.json({ tracks });
});

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const color = (body.color || '#35C2A6').trim().slice(0, 20);
  const columns = Array.isArray(body.columns) ? body.columns : [];
  const viewType = normalizeViewType(body.view_type);

  if (!name) {
    return NextResponse.json({ error: 'Track name is required.' }, { status: 400 });
  }

  const iconResult = sanitizeIcon(body.icon_type, body.icon);
  if (iconResult.error) {
    return NextResponse.json({ error: iconResult.error }, { status: 400 });
  }
  const { icon, icon_type: iconType } = iconResult;

  let parentId = null;
  if (body.parent_id !== undefined && body.parent_id !== null && body.parent_id !== '') {
    const parentRows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [
      body.parent_id,
      user.id,
    ]);
    if (parentRows.length === 0) {
      return NextResponse.json({ error: 'Parent track not found.' }, { status: 400 });
    }
    parentId = Number(body.parent_id);
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const trackUuid = randomUUID();
    let trackResult;
    try {
      [trackResult] = await conn.execute(
        'INSERT INTO tracks (user_id, parent_id, uuid, name, description, icon, icon_type, color, view_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user.id, parentId, trackUuid, name, description || null, icon, iconType, color, viewType]
      );
    } catch (err) {
      // Database not migrated yet (no view_type column) — still create the
      // track; it just shows in the default table layout until `npm run seed`.
      if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
      [trackResult] = await conn.execute(
        'INSERT INTO tracks (user_id, parent_id, uuid, name, description, icon, icon_type, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [user.id, parentId, trackUuid, name, description || null, icon, iconType, color]
      );
    }
    const trackId = trackResult.insertId;

    const usedKeys = [];
    let position = 0;
    let hasAutoIncrement = false;
    for (const col of columns) {
      const label = (col.label || '').trim();
      if (!label) continue;
      const fieldType = col.field_type || 'text';
      const meta = fieldTypeMeta(fieldType);
      const key = slugifyKey(label, usedKeys);
      usedKeys.push(key);
      const options = meta.supportsOptions ? (col.options || '') : null;
      const fieldLength =
        meta.supportsLength && typeof col.field_length === 'string' && col.field_length.trim()
          ? col.field_length.trim().slice(0, 20)
          : null;
      const autoIncrement = Boolean(col.auto_increment) && !hasAutoIncrement;
      if (autoIncrement) hasAutoIncrement = true;

      await conn.execute(
        'INSERT INTO track_columns (track_id, label, field_key, field_type, options, field_length, is_auto_increment, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [trackId, label, key, fieldType, options, fieldLength, autoIncrement ? 1 : 0, position]
      );
      position += 1;
    }

    await conn.commit();
    return NextResponse.json({ ok: true, trackId, trackUuid });
  } catch (err) {
    await conn.rollback();
    return NextResponse.json({ error: 'Could not create track.' }, { status: 500 });
  } finally {
    conn.release();
  }
});
