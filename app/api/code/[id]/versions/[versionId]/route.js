import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

async function loadVersion(params, userId) {
  const rows = await query(
    `SELECT v.* FROM code_versions v JOIN code_snippets s ON s.id = v.snippet_id
      WHERE s.uuid = ? AND s.user_id = ? AND v.id = ?`,
    [params.id, userId, params.versionId]
  );
  return rows[0] || null;
}

export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const version = await loadVersion(params, user.id);
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ version });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const version = await loadVersion(params, user.id);
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await query('DELETE FROM code_versions WHERE id = ?', [version.id]);
  return NextResponse.json({ ok: true });
});
