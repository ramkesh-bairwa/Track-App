import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { logTrack } from '@/lib/trackLog';

// PATCH { note } — add, change or clear the note on a history entry. The
// logged change itself never changes; the note edit is logged as its own line.
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = (
    await query('SELECT * FROM track_activity WHERE id = ? AND owner_id = ?', [params.activityId, user.id])
  )[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 5000) : '';
  if ((row.note || '') === note) return NextResponse.json({ ok: true });
  await query('UPDATE track_activity SET note = ?, note_by = ?, note_at = CURRENT_TIMESTAMP WHERE id = ?', [note || null, note ? user.id : null, row.id]);
  await logTrack({
    trackId: row.track_id,
    trackName: row.track_name,
    user,
    action: 'log_note',
    summary: `${note ? (row.note ? 'Edited a note' : 'Added a note') : 'Removed a note'} on #${row.id}`,
    entry: row.entry_id ? { id: row.entry_id, uuid: row.entry_uuid, label: row.entry_label } : null,
    changes: [{ key: 'note', label: 'Note', oldText: row.note || '', newText: note }],
  });
  return NextResponse.json({ ok: true });
});
