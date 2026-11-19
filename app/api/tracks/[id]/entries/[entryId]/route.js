import { NextResponse } from 'next/server';
import { sanitizeEntryValue } from '@/lib/fieldTypes';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { logTrack, trackColumns, diffEntry, entryLabel, parseData } from '@/lib/trackLog';
import { checkDeletePassword } from '@/lib/deleteGuard';

async function assertOwnership(trackId, userId) {
  const rows = await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [trackId, userId]);
  return rows.length > 0;
}

// Body: { field_key, value }  -> patches a single field inside the entry's JSON data
// or   : { data: { ...full object... } } -> replaces the whole data object
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: trackId, entryId } = params;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rows = await query('SELECT * FROM track_entries WHERE id = ? AND track_id = ?', [entryId, trackId]);
  const entry = rows[0];
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  if (typeof body.locked === 'boolean') {
    await query('UPDATE track_entries SET is_locked = ? WHERE id = ?', [body.locked ? 1 : 0, entryId]);
    const updated = await query('SELECT * FROM track_entries WHERE id = ?', [entryId]);
    const row = updated[0];
    if (Boolean(entry.is_locked) !== body.locked) {
      const label = entryLabel(await trackColumns(trackId), parseData(row.data));
      await logTrack({
        trackId,
        user,
        action: body.locked ? 'entry_lock' : 'entry_unlock',
        summary: `${body.locked ? 'Locked' : 'Unlocked'} record${label ? ` “${label}”` : ''}`,
        entry: { id: row.id, uuid: row.uuid, label },
      });
    }
    return NextResponse.json({
      ok: true,
      entry: { ...row, is_locked: !!row.is_locked, data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data },
    });
  }
  if (entry.is_locked) {
    return NextResponse.json({ error: 'Unlock this entry before editing it.' }, { status: 403 });
  }

  const columns = await query('SELECT field_key, field_type, is_auto_increment FROM track_columns WHERE track_id = ?', [trackId]);
  const autoIncrementKeys = new Set(columns.filter((c) => c.is_auto_increment).map((c) => c.field_key));
  const typeOf = new Map(columns.map((c) => [c.field_key, c.field_type]));

  let current = entry.data;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current);
    } catch {
      current = {};
    }
  }
  current = current || {};

  // Only real columns can be written, each value cleaned for its field type.
  let next;
  if (body.data && typeof body.data === 'object') {
    next = { ...current };
    for (const [key, value] of Object.entries(body.data)) {
      if (typeOf.has(key)) next[key] = sanitizeEntryValue(typeOf.get(key), value);
    }
  } else if (typeof body.field_key === 'string') {
    if (autoIncrementKeys.has(body.field_key)) {
      return NextResponse.json({ error: 'This field is auto-generated and cannot be edited.' }, { status: 400 });
    }
    if (!typeOf.has(body.field_key)) return NextResponse.json({ error: 'Unknown field.' }, { status: 400 });
    next = { ...current, [body.field_key]: sanitizeEntryValue(typeOf.get(body.field_key), body.value) };
  } else {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  for (const key of autoIncrementKeys) {
    next[key] = current[key];
  }

  await query('UPDATE track_entries SET data = ? WHERE id = ?', [JSON.stringify(next), entryId]);
  const updated = await query('SELECT * FROM track_entries WHERE id = ?', [entryId]);
  const cols = await trackColumns(trackId);
  const changes = diffEntry(cols, current, next);
  if (changes.length) {
    const label = entryLabel(cols, next) || entryLabel(cols, current);
    await logTrack({
      trackId,
      user,
      action: 'entry_update',
      summary: `Edited record${label ? ` “${label}”` : ''}`,
      entry: { id: entry.id, uuid: entry.uuid, label },
      changes,
    });
  }
  return NextResponse.json({ ok: true, entry: updated[0] });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: trackId, entryId } = params;
  if (!(await assertOwnership(trackId, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const denied = await checkDeletePassword(request, user);
  if (denied) return denied;
  const rows = await query('SELECT * FROM track_entries WHERE id = ? AND track_id = ?', [entryId, trackId]);
  const entry = rows[0];
  await query('DELETE FROM track_entries WHERE id = ? AND track_id = ?', [entryId, trackId]);
  if (entry) {
    const cols = await trackColumns(trackId);
    const data = parseData(entry.data);
    const label = entryLabel(cols, data);
    await logTrack({
      trackId,
      user,
      action: 'entry_delete',
      summary: `Deleted record${label ? ` “${label}”` : ''}`,
      entry: { id: entry.id, uuid: entry.uuid, label },
      // Kept so the record can be restored from the history.
      snapshot: { uuid: entry.uuid, data, position: entry.position, is_locked: Boolean(entry.is_locked), created_at: entry.created_at },
    });
  }
  return NextResponse.json({ ok: true });
});
