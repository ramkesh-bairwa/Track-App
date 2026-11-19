import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { logTrack, trackColumns, entryLabel, parseData } from '@/lib/trackLog';

// POST — someone opened a record's details. Logged at most once per
// 10 minutes per person and record.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const entry = (
    await query(
      'SELECT e.* FROM track_entries e JOIN tracks t ON t.id = e.track_id WHERE e.id = ? AND e.track_id = ? AND t.user_id = ?',
      [params.entryId, params.id, user.id]
    )
  )[0];
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const recent = await query(
    "SELECT id FROM track_activity WHERE entry_id = ? AND user_id = ? AND action = 'entry_view' AND created_at >= NOW() - INTERVAL 10 MINUTE LIMIT 1",
    [entry.id, user.id]
  );
  if (!recent.length) {
    const label = entry.is_locked ? '' : entryLabel(await trackColumns(entry.track_id), parseData(entry.data));
    await logTrack({
      trackId: entry.track_id,
      user,
      action: 'entry_view',
      summary: `Viewed record${label ? ` “${label}”` : ''}`,
      entry: { id: entry.id, uuid: entry.uuid, label },
    });
  }
  return NextResponse.json({ ok: true });
});
