import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { sanitizeEntryValue } from '@/lib/fieldTypes';
import { logTrack, trackColumns, diffEntry, entryLabel, parseData } from '@/lib/trackLog';

// POST — undo a logged record change: an edit puts the old values back
// (fields changed since are overwritten, files are left alone); a delete
// brings the record back. The undo is logged too.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = (
    await query('SELECT * FROM track_activity WHERE id = ? AND owner_id = ?', [params.activityId, user.id])
  )[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.reverted_at) return NextResponse.json({ error: 'That change was already reverted.' }, { status: 409 });

  const trackId = row.track_id;
  if (!(await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [trackId, user.id]))[0]) {
    return NextResponse.json({ error: 'That track was deleted, so this can’t be undone.' }, { status: 409 });
  }
  const cols = await trackColumns(trackId);
  const typeOf = new Map(cols.filter((c) => !c.is_auto_increment).map((c) => [c.field_key, c.field_type]));

  if (row.action === 'entry_update') {
    const entry = (await query('SELECT * FROM track_entries WHERE id = ? AND track_id = ?', [row.entry_id, trackId]))[0];
    if (!entry) return NextResponse.json({ error: 'That record no longer exists.' }, { status: 409 });
    if (entry.is_locked) return NextResponse.json({ error: 'Unlock the record first.' }, { status: 403 });
    const current = parseData(entry.data);
    const next = { ...current };
    for (const c of parseData(row.changes) || []) {
      if (!typeOf.has(c.key) || (c.old === null && c.new === null && c.oldText)) continue; // gone column / file
      next[c.key] = sanitizeEntryValue(typeOf.get(c.key), c.old ?? '');
    }
    const changes = diffEntry(cols, current, next);
    if (!changes.length) return NextResponse.json({ error: 'The record already has those values.' }, { status: 409 });
    await query('UPDATE track_entries SET data = ? WHERE id = ?', [JSON.stringify(next), entry.id]);
    const label = entryLabel(cols, next);
    await logTrack({
      trackId,
      user,
      action: 'entry_update',
      summary: `Reverted record${label ? ` “${label}”` : ''} (undid #${row.id})`,
      entry: { id: entry.id, uuid: entry.uuid, label },
      changes,
      revertOf: row.id,
    });
  } else if (row.action === 'entry_delete') {
    const snap = parseData(row.snapshot);
    if (!snap?.data) return NextResponse.json({ error: 'Nothing saved to restore.' }, { status: 409 });
    const exists = (await query('SELECT id FROM track_entries WHERE uuid = ?', [snap.uuid]))[0];
    if (exists) return NextResponse.json({ error: 'That record is already back.' }, { status: 409 });
    const res = await query('INSERT INTO track_entries (track_id, uuid, data, position, is_locked) VALUES (?, ?, ?, ?, ?)', [
      trackId,
      snap.uuid,
      JSON.stringify(snap.data),
      Number(snap.position) || 0,
      snap.is_locked ? 1 : 0,
    ]);
    // Keep the record's history together under its new id.
    await query('UPDATE track_activity SET entry_id = ? WHERE track_id = ? AND entry_uuid = ?', [res.insertId, trackId, snap.uuid]);
    const label = entryLabel(cols, snap.data);
    await logTrack({
      trackId,
      user,
      action: 'entry_restore',
      summary: `Restored record${label ? ` “${label}”` : ''} (undid #${row.id})`,
      entry: { id: res.insertId, uuid: snap.uuid, label },
      revertOf: row.id,
    });
  } else {
    return NextResponse.json({ error: 'Only record edits and deletes can be reverted.' }, { status: 400 });
  }

  await query('UPDATE track_activity SET reverted_by = ?, reverted_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id, row.id]);
  return NextResponse.json({ ok: true });
});
