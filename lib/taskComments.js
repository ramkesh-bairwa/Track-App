import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getBoardAccess, canSeeTask, normalizeTask, boardPeople, sanitizeFile } from '@/lib/taskServer';

export const MAX_COMMENT = 2000;

// Loads a log entry for commenting: the board access, the entry, its task row
// (if any) and the board's people. Returns `{ error }` as a response when the
// user can't see it.
export async function loadEntryForComment(params, user) {
  const access = await getBoardAccess(params.id, user);
  if (!access) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  const { board } = access;
  const rows = await query('SELECT * FROM task_activity WHERE id = ? AND board_id = ?', [params.activityId, board.id]);
  const entry = rows[0];
  if (!entry) return { error: NextResponse.json({ error: 'That log entry was not found.' }, { status: 404 }) };
  let taskRow = null;
  if (entry.task_id) {
    const taskRows = await query('SELECT * FROM tasks WHERE id = ? AND board_id = ?', [entry.task_id, board.id]);
    taskRow = taskRows[0] || null;
    if (taskRow && !canSeeTask(access, normalizeTask(taskRow), user.id)) {
      return { error: NextResponse.json({ error: 'That log entry was not found.' }, { status: 404 }) };
    }
  }
  const people = await boardPeople(board);
  return { access, board, entry, taskRow, people };
}

export const MAX_COMMENT_FILES = 5;

// Text plus any new attachments ({ name, type, size, data } with a data URL,
// each under 2MB). A comment needs text or at least one file.
export function commentBody(body, { keptFiles = [] } = {}) {
  const text = typeof body?.body === 'string' ? body.body.trim().slice(0, MAX_COMMENT) : '';
  let files;
  try {
    files = (Array.isArray(body?.attachments) ? body.attachments : []).map(sanitizeFile).filter(Boolean);
  } catch (err) {
    return { error: err.message };
  }
  const all = [...keptFiles, ...files];
  if (all.length > MAX_COMMENT_FILES) return { error: `Attach up to ${MAX_COMMENT_FILES} files per comment.` };
  if (!text && all.length === 0) return { error: 'Write a comment or attach a file first.' };
  return { text, files: all };
}

// Stored form: the files, and the light list the history shows.
export function filesColumns(files) {
  if (!files.length) return { attachments: null, meta: null };
  return {
    attachments: JSON.stringify(files),
    meta: JSON.stringify(files.map((f) => ({ name: f.name, type: f.type, size: f.size }))),
  };
}

// How a comment reads in the log: its text plus "📎 a.pdf, b.png".
export function commentLogText(text, files) {
  const names = files.map((f) => f.name).join(', ');
  return [text, names && `📎 ${names}`].filter(Boolean).join('\n');
}

export function boardUrl(board, entryId) {
  return `/dashboard/tasks/${board.uuid}#log-${entryId}`;
}
