import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { listTrackActivity } from '@/lib/trackLog';

// GET ?entry=<entryId>  — one record's history
//     ?sub=1            — include every sub-track (any depth)
export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const track = (await query('SELECT id FROM tracks WHERE id = ? AND user_id = ?', [params.id, user.id]))[0];
  if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(request.url);
  const entryId = Number(url.searchParams.get('entry')) || null;
  const withSubs = url.searchParams.get('sub') === '1' && !entryId;

  let trackIds = [track.id];
  if (withSubs) {
    const rows = await query(
      `WITH RECURSIVE d AS (
         SELECT id FROM tracks WHERE id = ? AND user_id = ?
         UNION ALL
         SELECT t.id FROM tracks t JOIN d ON t.parent_id = d.id
       ) SELECT id FROM d`,
      [track.id, user.id]
    );
    trackIds = rows.map((r) => r.id);
  }

  const where = [`a.track_id IN (${trackIds.map(() => '?').join(',')})`, '(a.owner_id = ? OR a.owner_id IS NULL)'];
  const args = [...trackIds, user.id];
  if (entryId) {
    where.push('a.entry_id = ?');
    args.push(entryId);
  }
  const activity = await listTrackActivity(where.join(' AND '), args);
  return NextResponse.json({ activity, me: user.id });
});
