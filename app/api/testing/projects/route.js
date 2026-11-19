import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { resolveAccess } from '@/lib/testingAccess';

// GET /api/testing/projects
// Browser (cookie): the current user's projects.
// Outside tool (token): every project, so the tester can pick one.
export const GET = withApiErrors(async (request) => {
  const access = await resolveAccess(request);
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rows;
  if (access.user) {
    rows = await query(
      `SELECT p.uuid, p.name, p.base_url, p.created_at,
              (SELECT COUNT(*) FROM test_feedback f WHERE f.project_id = p.id) AS issue_count
       FROM test_projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`,
      [access.user.id]
    );
  } else {
    rows = await query(
      `SELECT p.uuid, p.name, p.base_url, p.created_at,
              (SELECT COUNT(*) FROM test_feedback f WHERE f.project_id = p.id) AS issue_count
       FROM test_projects p ORDER BY p.created_at DESC`
    );
  }
  return NextResponse.json({ projects: rows });
});

// POST /api/testing/projects  { name, base_url }  (browser only)
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const baseUrl = (body.base_url || '').trim().slice(0, 500);
  if (!name) return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });

  const uuid = randomUUID();
  await query('INSERT INTO test_projects (user_id, uuid, name, base_url) VALUES (?, ?, ?, ?)', [
    user.id,
    uuid,
    name.slice(0, 255),
    baseUrl || null,
  ]);
  return NextResponse.json({ ok: true, uuid, name, base_url: baseUrl });
});

// DELETE /api/testing/projects?uuid=<uuid>  (browser only) — removes the
// project and all its feedback (ON DELETE CASCADE).
export const DELETE = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uuid = new URL(request.url).searchParams.get('uuid');
  if (!uuid) return NextResponse.json({ error: 'uuid is required.' }, { status: 400 });

  const result = await query('DELETE FROM test_projects WHERE uuid = ? AND user_id = ?', [
    uuid,
    user.id,
  ]);
  return NextResponse.json({ ok: true, deleted: result.affectedRows || 0 });
});
