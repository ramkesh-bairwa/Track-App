import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import NotesDashboard from '@/components/NotesDashboard';

export default async function NotesPage() {
  const user = await getCurrentUser();
  const notes = await query(
    `SELECT n.*,
       (SELECT COUNT(*) FROM notes sub WHERE sub.parent_id = n.id) AS child_count
     FROM notes n WHERE n.user_id = ? ORDER BY n.position ASC, n.id ASC`,
    [user.id]
  );

  return <NotesDashboard notes={notes} />;
}
