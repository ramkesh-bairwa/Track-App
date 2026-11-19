import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { resolveAccess } from '@/lib/testingAccess';

const PUBLIC_DIR = path.join(process.cwd(), 'public', 'testing-feedback');

// Look up a project by uuid. For a browser call it must belong to the user;
// a token call may reach any project.
async function findProject(uuid, access) {
  if (!uuid) return null;
  const rows = access.user
    ? await query('SELECT id, uuid FROM test_projects WHERE uuid = ? AND user_id = ?', [uuid, access.user.id])
    : await query('SELECT id, uuid FROM test_projects WHERE uuid = ?', [uuid]);
  return rows[0] || null;
}

// GET /api/testing/feedback?project=<uuid>
export const GET = withApiErrors(async (request) => {
  const access = await resolveAccess(request);
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uuid = new URL(request.url).searchParams.get('project');
  const project = await findProject(uuid, access);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const issues = await query(
    `SELECT id, run_id, url, screen, title, description, screenshot_path, status, created_at
     FROM test_feedback WHERE project_id = ? ORDER BY id DESC`,
    [project.id]
  );
  return NextResponse.json({ issues });
});

// POST /api/testing/feedback
// {
//   project: "<uuid>",
//   run_id: "20261016_181212",
//   replace: true,                       // clear this project's old issues first
//   issues: [ { url, screen, title, description, screenshot_base64 } ]
// }
export const POST = withApiErrors(async (request) => {
  const access = await resolveAccess(request);
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const project = await findProject(body.project, access);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const runId = String(body.run_id || Date.now()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const issues = Array.isArray(body.issues) ? body.issues : [];

  // "replace" keeps the dashboard showing the latest run only.
  if (body.replace !== false) {
    await query('DELETE FROM test_feedback WHERE project_id = ?', [project.id]);
  }

  const runDir = path.join(PUBLIC_DIR, project.uuid, runId);
  let saved = 0;
  for (let i = 0; i < issues.length; i++) {
    const iss = issues[i] || {};
    let screenshotPath = null;

    if (iss.screenshot_base64) {
      try {
        await fs.mkdir(runDir, { recursive: true });
        const data = String(iss.screenshot_base64).replace(/^data:image\/\w+;base64,/, '');
        const file = `${String(i + 1).padStart(3, '0')}.png`;
        await fs.writeFile(path.join(runDir, file), Buffer.from(data, 'base64'));
        // served statically from /public
        screenshotPath = `/testing-feedback/${project.uuid}/${runId}/${file}`;
      } catch (err) {
        console.error('screenshot save failed:', err.message);
      }
    }

    const allowed = ['pass', 'fail', 'warn', 'open'];
    const status = allowed.includes(iss.status) ? iss.status : 'open';
    await query(
      `INSERT INTO test_feedback (project_id, run_id, url, screen, title, description, screenshot_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project.id,
        runId,
        (iss.url || '').slice(0, 500) || null,
        (iss.screen || '').slice(0, 60) || null,
        (iss.title || 'Issue').slice(0, 255),
        iss.description || null,
        screenshotPath,
        status,
      ]
    );
    saved++;
  }

  return NextResponse.json({ ok: true, run_id: runId, saved });
});

// DELETE /api/testing/feedback?id=<feedbackId>        -> delete one issue
// DELETE /api/testing/feedback?project=<uuid>&all=1   -> clear all for project
export const DELETE = withApiErrors(async (request) => {
  const access = await resolveAccess(request);
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const projectUuid = params.get('project');

  if (id) {
    const result = access.user
      ? await query(
          `DELETE f FROM test_feedback f JOIN test_projects p ON p.id = f.project_id
           WHERE f.id = ? AND p.user_id = ?`,
          [id, access.user.id]
        )
      : await query('DELETE FROM test_feedback WHERE id = ?', [id]);
    return NextResponse.json({ ok: true, deleted: result.affectedRows || 0 });
  }

  if (projectUuid) {
    const project = await findProject(projectUuid, access);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const result = await query('DELETE FROM test_feedback WHERE project_id = ?', [project.id]);
    return NextResponse.json({ ok: true, deleted: result.affectedRows || 0 });
  }

  return NextResponse.json({ error: 'Pass ?id= or ?project=&all=1' }, { status: 400 });
});
