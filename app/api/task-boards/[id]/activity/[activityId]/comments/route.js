import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { logActivity, findMentions, notifyMentions } from '@/lib/taskServer';
import { loadEntryForComment, commentBody, boardUrl, filesColumns, commentLogText } from '@/lib/taskComments';

// Adds a comment to a log entry. Anyone who can see the entry may comment.
// The comment is logged as its own 'log_comment' entry, and everyone
// @mentioned (who can see the task) gets a notification.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { board, entry, taskRow, people, error } = await loadEntryForComment(params, user);
  if (error) return error;

  const { text, files, error: bodyError } = commentBody(await request.json().catch(() => ({})));
  if (bodyError) return NextResponse.json({ error: bodyError }, { status: 400 });
  const mentions = findMentions(text, people);

  const stored = filesColumns(files);
  let commentId;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.execute(
      'INSERT INTO task_comments (board_id, activity_id, task_id, user_id, user_name, body, mentions, attachments, attachments_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [board.id, entry.id, entry.task_id, user.id, user.name, text, JSON.stringify(mentions), stored.attachments, stored.meta]
    );
    commentId = res.insertId;
    await logActivity(conn, {
      boardId: board.id,
      taskId: entry.task_id,
      user,
      action: 'log_comment',
      summary: `Commented on log #${entry.id}`,
      changes: [{ key: 'comment', label: `Comment on #${entry.id}`, oldText: '', newText: commentLogText(text, files) }],
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await notifyMentions({ board, taskRow, actor: user, mentions, body: commentLogText(text, files), url: boardUrl(board, entry.id) });
  return NextResponse.json({ ok: true, id: commentId, mentions });
});
