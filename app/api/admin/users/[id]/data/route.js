import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/screenshots';

export const dynamic = 'force-dynamic';

// Read-only drill-down into one user's own data, so an admin can look without
// impersonating. ?section = tracks | track&trackId=N | notes | tasks | boards
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id) || 0;
  const sp = new URL(request.url).searchParams;
  const section = sp.get('section') || 'tracks';

  if (section === 'tracks') {
    const tracks = await query(
      `SELECT t.id, t.name, t.description, t.color, t.parent_id,
              (SELECT COUNT(*) FROM track_entries e WHERE e.track_id = t.id) AS entries
         FROM tracks t WHERE t.user_id = ? ORDER BY t.parent_id IS NOT NULL, t.position, t.id`,
      [id]
    );
    return NextResponse.json({ tracks });
  }

  if (section === 'track') {
    const trackId = Number(sp.get('trackId')) || 0;
    const [track] = await query('SELECT id, name, description FROM tracks WHERE id = ? AND user_id = ?', [trackId, id]);
    if (!track) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const columns = await query(
      'SELECT id, label, field_key, field_type FROM track_columns WHERE track_id = ? ORDER BY position, id',
      [trackId]
    );
    const rows = await query(
      'SELECT id, data, created_at FROM track_entries WHERE track_id = ? ORDER BY position, id LIMIT 1000',
      [trackId]
    );
    const entries = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      data: typeof r.data === 'string' ? safeJson(r.data) : r.data || {},
    }));
    return NextResponse.json({ track, columns, entries });
  }

  if (section === 'notes') {
    const notes = await query(
      'SELECT id, title, content, parent_id, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY parent_id IS NOT NULL, position, id LIMIT 1000',
      [id]
    );
    // Strip HTML to a plain-text preview so nothing from the note can run in the admin page.
    return NextResponse.json({
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        parent_id: n.parent_id,
        created_at: n.created_at,
        updated_at: n.updated_at,
        preview: plain(n.content).slice(0, 600),
      })),
    });
  }

  if (section === 'tasks') {
    const tasks = await query(
      `SELECT ta.id, ta.title, ta.status, ta.priority, ta.due_date, ta.updated_at, b.name AS board
         FROM tasks ta JOIN task_boards b ON b.id = ta.board_id
        WHERE ta.assignee_id = ? AND ta.deleted_at IS NULL ORDER BY ta.updated_at DESC LIMIT 1000`,
      [id]
    );
    return NextResponse.json({ tasks });
  }

  if (section === 'boards') {
    const boards = await query(
      `SELECT id, name, description, visibility,
              (SELECT COUNT(*) FROM tasks WHERE board_id = task_boards.id AND deleted_at IS NULL) AS tasks
         FROM task_boards WHERE owner_id = ? ORDER BY id`,
      [id]
    );
    return NextResponse.json({ boards });
  }

  return NextResponse.json({ error: 'Unknown section.' }, { status: 400 });
});

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function plain(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
