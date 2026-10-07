import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import NoteView from '@/components/NoteView';

export default async function NotePage({ params }) {
  const user = await getCurrentUser();
  const rows = await query('SELECT * FROM notes WHERE uuid = ? AND user_id = ?', [params.id, user.id]);
  const note = rows[0];
  if (!note) notFound();

  const breadcrumbs = await query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, uuid, parent_id, title, 0 AS depth FROM notes WHERE id = ?
       UNION ALL
       SELECT n.id, n.uuid, n.parent_id, n.title, a.depth + 1
       FROM notes n JOIN ancestors a ON n.id = a.parent_id
     )
     SELECT id, uuid, title FROM ancestors ORDER BY depth DESC`,
    [note.id]
  );

  const subnotes = await query(
    `SELECT n.*,
       (SELECT COUNT(*) FROM notes sub WHERE sub.parent_id = n.id) AS child_count
     FROM notes n WHERE n.parent_id = ? ORDER BY n.position ASC, n.id ASC`,
    [note.id]
  );

  return <NoteView note={note} breadcrumbs={breadcrumbs} subnotes={subnotes} />;
}
