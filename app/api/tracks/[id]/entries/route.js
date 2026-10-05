import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { emptyValueFor, sanitizeEntryValue } from '@/lib/fieldTypes';
import { withApiErrors } from '@/lib/apiError';

async function assertOwnership(trackId, userId) {
  const rows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [trackId, userId]);
  return rows.length > 0;
}

export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const trackId = params.id;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const entries = await query(
    'SELECT * FROM track_entries WHERE track_id = ? ORDER BY position ASC, id ASC',
    [trackId]
  );
  // A locked entry's real data never leaves the server until it's unlocked.
  const masked = entries.map((e) => ({ ...e, is_locked: !!e.is_locked, data: e.is_locked ? null : e.data }));
  return NextResponse.json({ entries: masked });
});

// Reorder entries: body = { order: [entryId, entryId, ...] }
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
    order.map((entryId, index) =>
      query('UPDATE track_entries SET position = ? WHERE id = ? AND track_id = ?', [
        index,
        entryId,
        trackId,
      ])
    )
  );
  return NextResponse.json({ ok: true });
});

export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const trackId = params.id;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const columns = await query(
    'SELECT field_key, field_type, is_auto_increment FROM track_columns WHERE track_id = ?',
    [trackId]
  );
  const body = await request.json().catch(() => ({}));
  const incoming = body.data && typeof body.data === 'object' ? body.data : {};

  const data = {};
  for (const col of columns) {
    // Auto-increment columns are a computed row number (see Sr. No. in
    // TrackView), not a stored value — nothing to write here.
    if (col.is_auto_increment) continue;
    if (Object.prototype.hasOwnProperty.call(incoming, col.field_key)) {
      data[col.field_key] = sanitizeEntryValue(col.field_type, incoming[col.field_key]);
    } else {
      data[col.field_key] = emptyValueFor(col.field_type);
    }
  }

  const posRows = await query(
    'SELECT COALESCE(MIN(position), 1) AS minPos FROM track_entries WHERE track_id = ?',
    [trackId]
  );
  const position = posRows[0].minPos - 1;

  const result = await query(
    'INSERT INTO track_entries (track_id, uuid, data, position) VALUES (?, ?, ?, ?)',
    [trackId, randomUUID(), JSON.stringify(data), position]
  );

  const rows = await query('SELECT * FROM track_entries WHERE id = ?', [result.insertId]);
  return NextResponse.json({ ok: true, entry: rows[0] });
});
