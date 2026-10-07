import { NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { logActivity, findMentions, notifyMentions, parseJson } from '@/lib/taskServer';
import { loadEntryForComment, commentBody, boardUrl, filesColumns, commentLogText } from '@/lib/taskComments';

// Only the comment's author or the board admin may edit or delete it. Both
// are logged with the old → new text, so nothing said is ever lost.
async function loadComment(params, user) {
  const loaded = await loadEntryForComment(params, user);
  if (loaded.error) return loaded;
  const rows = await query('SELECT * FROM task_comments WHERE id = ? AND activity_id = ? AND deleted_at IS NULL', [
    params.commentId,
    loaded.entry.id,
  ]);
  const comment = rows[0];
  if (!comment) return { error: NextResponse.json({ error: 'That comment was not found.' }, { status: 404 }) };
  if (comment.user_id !== user.id && !loaded.access.isAdmin) {
    return { error: NextResponse.json({ error: 'Only the person who wrote this comment, or the board admin, can change it.' }, { status: 403 }) };
  }
  return { ...loaded, comment };
}

async function logChange(user, board, entry, verb, oldText, newText) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await logActivity(conn, {
      boardId: board.id,
      taskId: entry.task_id,
      user,
      action: 'log_comment',
      summary: `${verb} a comment on log #${entry.id}`,
      changes: [{ key: 'comment', label: `Comment on #${entry.id}`, oldText, newText }],
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { board, entry, taskRow, people, comment, error } = await loadComment(params, user);
  if (error) return error;

  // `keep_attachments`: indexes of the existing files to keep (all, if absent);
  // `attachments`: new files to add.
  const body = await request.json().catch(() => ({}));
  const existing = parseJson(comment.attachments, []) || [];
  const keep = Array.isArray(body.keep_attachments) ? new Set(body.keep_attachments.map(Number)) : null;
  const keptFiles = keep ? existing.filter((_, i) => keep.has(i)) : existing;
  const { text, files, error: bodyError } = commentBody(body, { keptFiles });
  if (bodyError) return NextResponse.json({ error: bodyError }, { status: 400 });
  const before = commentLogText(comment.body, existing);
  const after = commentLogText(text, files);
  if (before === after && files.length === existing.length) return NextResponse.json({ ok: true });
  const mentions = findMentions(text, people);
  const stored = filesColumns(files);

  await query('UPDATE task_comments SET body = ?, mentions = ?, attachments = ?, attachments_meta = ?, edited_at = NOW() WHERE id = ?', [
    text,
    JSON.stringify(mentions),
    stored.attachments,
    stored.meta,
    comment.id,
  ]);
  await logChange(user, board, entry, 'Edited', before, after);
  await notifyMentions({
    board,
    taskRow,
    actor: user,
    mentions,
    already: parseJson(comment.mentions, []) || [],
    body: after,
    url: boardUrl(board, entry.id),
  });
  return NextResponse.json({ ok: true, mentions });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { board, entry, comment, error } = await loadComment(params, user);
  if (error) return error;
  await query('UPDATE task_comments SET deleted_at = NOW() WHERE id = ?', [comment.id]);
  await logChange(user, board, entry, 'Deleted', commentLogText(comment.body, parseJson(comment.attachments, []) || []), '');
  return NextResponse.json({ ok: true });
});
