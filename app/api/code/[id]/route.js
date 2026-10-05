import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { CODE_LANGUAGES } from '@/lib/codeLanguages';

const MAX_CODE_CHARS = 5_000_000;

async function load(uuid, userId) {
  return (await query('SELECT * FROM code_snippets WHERE uuid = ? AND user_id = ?', [uuid, userId]))[0] || null;
}

export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const file = await load(params.id, user.id);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ file });
});

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const file = await load(params.id, user.id);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 255);
    if (!name) return NextResponse.json({ error: 'The file needs a name.' }, { status: 400 });
    fields.push('name = ?');
    values.push(name);
  }
  if (typeof body.language === 'string' && CODE_LANGUAGES.some((l) => l.id === body.language)) {
    fields.push('language = ?');
    values.push(body.language);
  }
  if (typeof body.content === 'string') {
    if (body.content.length > MAX_CODE_CHARS) return NextResponse.json({ error: 'That file is too large to save (5 MB max).' }, { status: 413 });
    fields.push('content = ?');
    values.push(body.content);
  }
  if (fields.length === 0) return NextResponse.json({ ok: true });
  values.push(file.id);
  await query(`UPDATE code_snippets SET ${fields.join(', ')} WHERE id = ?`, values);
  const updated = await query('SELECT updated_at FROM code_snippets WHERE id = ?', [file.id]);
  return NextResponse.json({ ok: true, updated_at: updated[0]?.updated_at });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const file = await load(params.id, user.id);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await query('DELETE FROM code_snippets WHERE id = ?', [file.id]);
  return NextResponse.json({ ok: true });
});
