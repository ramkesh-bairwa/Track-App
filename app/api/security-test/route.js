import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { runSuite, summarize, CATS } from '@/lib/securityChecks';

// Runs the security self-test against this app's own origin. Signed-in only —
// it creates and then deletes a couple of throwaway accounts, so it must not
// be reachable anonymously. It only ever touches its own throwaway data.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const categories = Array.isArray(body.categories) ? body.categories.filter((c) => CATS.includes(c)) : [];
  const base = request.nextUrl.origin;

  const { results, tag, error } = await runSuite({ base, categories });

  // Always clean up the throwaway accounts (cascades to their data).
  let cleaned = 0;
  if (tag) {
    try {
      // lib/db's query() already unwraps to the OkPacket (not [rows, fields]).
      const r = await query('DELETE FROM users WHERE email LIKE ?', [`${tag}-%@example.test`]);
      cleaned = r.affectedRows ?? 0;
    } catch {
      /* leave cleanup to the CLI script if the DB delete fails */
    }
  }

  if (error) return NextResponse.json({ error, cleaned }, { status: 502 });
  return NextResponse.json({ base, ranAt: new Date().toISOString(), summary: summarize(results), results, cleaned });
});
