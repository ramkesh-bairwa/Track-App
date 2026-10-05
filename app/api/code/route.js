import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { CODE_LANGUAGES, languageForName } from '@/lib/codeLanguages';

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const files = await query(
    `SELECT uuid, name, language, CHAR_LENGTH(COALESCE(content, '')) AS size, created_at, updated_at
       FROM code_snippets WHERE user_id = ? ORDER BY updated_at DESC`,
    [user.id]
  );
  return NextResponse.json({ files });
});

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : '';
  if (!name) return NextResponse.json({ error: 'Give the file a name, e.g. helpers.js' }, { status: 400 });
  const language = CODE_LANGUAGES.some((l) => l.id === body.language) ? body.language : languageForName(name);
  const content = typeof body.content === 'string' ? body.content : '';
  const uuid = randomUUID();
  await query('INSERT INTO code_snippets (uuid, user_id, name, language, content) VALUES (?, ?, ?, ?, ?)', [
    uuid,
    user.id,
    name,
    language,
    content,
  ]);
  return NextResponse.json({ ok: true, uuid });
});
