import { randomUUID } from 'crypto';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import TrackView from '@/components/TrackView';

export default async function TrackPage({ params }) {
  const user = await getCurrentUser();
  const routeParam = params.id;

  // The route segment is a track's uuid; a bare numeric id (an old link, or
  // one typed by hand) still resolves so nothing already bookmarked breaks.
  const isNumericId = /^\d+$/.test(routeParam);
  const tracks = await query(
    isNumericId ? 'SELECT * FROM tracks WHERE id = ? AND user_id = ?' : 'SELECT * FROM tracks WHERE uuid = ? AND user_id = ?',
    [routeParam, user.id]
  );
  let track = tracks[0];
  if (!track) notFound();

  // Defensive backfill: the only way a track can still be missing its uuid
  // is if the schema migration hasn't been (re-)run yet — generate and
  // persist one now rather than leaving the record without a stable id.
  if (!track.uuid) {
    const uuid = randomUUID();
    await query('UPDATE tracks SET uuid = ? WHERE id = ?', [uuid, track.id]);
    track = { ...track, uuid };
  }

  // Canonicalize the address bar to the uuid — this is what actually makes
  // "the url shows this record's unique id" true regardless of how it was reached.
  if (routeParam !== track.uuid) {
    redirect(`/dashboard/tracks/${track.uuid}`);
  }

  const trackId = track.id;

  const columns = await query(
    'SELECT * FROM track_columns WHERE track_id = ? ORDER BY position ASC, id ASC',
    [trackId]
  );
  const rawEntries = await query(
    'SELECT * FROM track_entries WHERE track_id = ? ORDER BY position ASC, id ASC',
    [trackId]
  );
  const entries = rawEntries.map((e) => ({
    ...e,
    is_locked: !!e.is_locked,
    // A locked entry's real data never reaches the browser until it's unlocked.
    data: e.is_locked ? null : (typeof e.data === 'string' ? JSON.parse(e.data) : e.data),
  }));

  const breadcrumbs = await query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, uuid, parent_id, name, 0 AS depth FROM tracks WHERE id = ?
       UNION ALL
       SELECT t.id, t.uuid, t.parent_id, t.name, a.depth + 1
       FROM tracks t JOIN ancestors a ON t.id = a.parent_id
     )
     SELECT id, uuid, name FROM ancestors ORDER BY depth DESC`,
    [trackId]
  );

  const subtracks = await query(
    `SELECT t.*,
       (SELECT COUNT(*) FROM track_entries e WHERE e.track_id = t.id) AS entry_count,
       (SELECT COUNT(*) FROM track_columns c WHERE c.track_id = t.id) AS column_count,
       (SELECT COUNT(*) FROM tracks sub WHERE sub.parent_id = t.id) AS child_count
     FROM tracks t WHERE t.parent_id = ? ORDER BY t.position ASC, t.id ASC`,
    [trackId]
  );

  return (
    <TrackView
      track={track}
      initialColumns={columns}
      initialEntries={entries}
      user={user}
      breadcrumbs={breadcrumbs}
      subtracks={subtracks}
    />
  );
}
