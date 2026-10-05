import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import TracksDashboard from '@/components/TracksDashboard';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const tracks = await query(
    `SELECT t.*,
       (SELECT COUNT(*) FROM track_entries e WHERE e.track_id = t.id) AS entry_count,
       (SELECT COUNT(*) FROM track_columns c WHERE c.track_id = t.id) AS column_count,
       (SELECT COUNT(*) FROM tracks sub WHERE sub.parent_id = t.id) AS child_count
     FROM tracks t WHERE t.user_id = ? ORDER BY t.position ASC, t.id ASC`,
    [user.id]
  );

  return <TracksDashboard tracks={tracks} />;
}
