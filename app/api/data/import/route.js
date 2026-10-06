import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { FORMAT, MODULES, MODULE_KEYS, summarize } from '@/lib/dataTransfer';

export const dynamic = 'force-dynamic';

// POST { file: <exported JSON>, modules: ['notes', ...], update: true } → adds
// those modules to the signed-in user's account and (unless update is false)
// updates the items that came from an earlier import. All-or-nothing: any error rolls back.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const file = body?.file;
  if (!file || file.format !== FORMAT || typeof file.modules !== 'object') {
    return NextResponse.json({ error: 'This is not a MyTrack export file.' }, { status: 400 });
  }
  const keys = (Array.isArray(body.modules) ? body.modules : Object.keys(file.modules)).filter(
    (k) => MODULE_KEYS.includes(k) && file.modules[k] != null
  );
  if (!keys.length) return NextResponse.json({ error: 'Pick at least one thing to import.' }, { status: 400 });

  const opts = { update: body.update !== false };
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const results = [];
    for (const key of keys) {
      const { detail, ...counts } = await MODULES[key].import(conn, user.id, file.modules[key], opts);
      results.push({ key, label: MODULES[key].label, ...counts, summary: summarize(counts), detail });
    }
    await conn.commit();
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
});
