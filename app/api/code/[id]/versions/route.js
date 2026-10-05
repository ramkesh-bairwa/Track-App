import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { CODE_LANGUAGES } from '@/lib/codeLanguages';

const MAX_CODE_CHARS = 5_000_000;
const MAX_VERSIONS = 100; // oldest snapshots beyond this are dropped

async function loadFile(uuid, userId) {
  return (await query('SELECT id, language, content FROM code_snippets WHERE uuid = ? AND user_id = ?', [uuid, userId]))[0] || null;
}

// Saved snapshots of one code file, newest first (without their content).
export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const file = await loadFile(params.id, user.id);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const versions = await query(
    `SELECT id, label, language, CHAR_LENGTH(COALESCE(content, '')) AS size, created_at
       FROM code_versions WHERE snippet_id = ? ORDER BY id DESC`,
    [file.id]
  );
  return NextResponse.json({ versions });
});

// Snapshot the given content (the editor's current code) as a new version.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const file = await loadFile(params.id, user.id);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content : file.content || '';
  if (content.length > MAX_CODE_CHARS) return NextResponse.json({ error: 'That file is too large to save (5 MB max).' }, { status: 413 });
  const language = CODE_LANGUAGES.some((l) => l.id === body.language) ? body.language : file.language;
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 255) : null;

  // Saving the same code twice in a row doesn't add a duplicate snapshot.
  const last = (await query('SELECT id, content FROM code_versions WHERE snippet_id = ? ORDER BY id DESC LIMIT 1', [file.id]))[0];
  if (last && last.content === content && !label) return NextResponse.json({ ok: true, id: last.id, unchanged: true });

  const res = await query('INSERT INTO code_versions (snippet_id, label, language, content) VALUES (?, ?, ?, ?)', [
    file.id,
    label,
    language,
    content,
  ]);
  await query(
    `DELETE FROM code_versions WHERE snippet_id = ? AND id NOT IN (
       SELECT id FROM (SELECT id FROM code_versions WHERE snippet_id = ? ORDER BY id DESC LIMIT ${MAX_VERSIONS}) keep)`,
    [file.id, file.id]
  );
  return NextResponse.json({ ok: true, id: res.insertId });
});
