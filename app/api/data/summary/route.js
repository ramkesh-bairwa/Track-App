import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { MODULES } from '@/lib/dataTransfer';

export const dynamic = 'force-dynamic';

// How many items each module holds for the signed-in user (shown in the Export dialog).
export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const conn = await getPool().getConnection();
  try {
    const modules = [];
    for (const [key, mod] of Object.entries(MODULES)) {
      // One unreadable module (e.g. its table is missing in an older database) mustn't hide the rest.
      try {
        modules.push({ key, label: mod.label, count: Number(await mod.count(conn, user.id)) });
      } catch (err) {
        console.error(`Data summary: ${key} unavailable:`, err.message);
        modules.push({ key, label: mod.label, count: null, unavailable: true });
      }
    }
    return NextResponse.json({ modules });
  } finally {
    conn.release();
  }
});
