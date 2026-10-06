import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { FORMAT, FORMAT_VERSION, MODULES, MODULE_KEYS } from '@/lib/dataTransfer';

export const dynamic = 'force-dynamic';

// GET /api/data/export?modules=notes,tracks → a JSON file with just those modules.
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const asked = (new URL(request.url).searchParams.get('modules') || '').split(',').filter((k) => MODULE_KEYS.includes(k));
  if (!asked.length) return NextResponse.json({ error: 'Pick at least one thing to export.' }, { status: 400 });

  const conn = await getPool().getConnection();
  try {
    const modules = {};
    for (const key of asked) modules[key] = await MODULES[key].export(conn, user.id);
    const file = {
      format: FORMAT,
      version: FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      exported_from: request.headers.get('host') || '',
      exported_by: user.email,
      modules,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(file), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="mytrack-${asked.length === MODULE_KEYS.length ? 'all' : asked.join('-')}-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    conn.release();
  }
});
