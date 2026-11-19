import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { appLockHash, lockoutSeconds, recordFailure, clearFailures } from '@/lib/appLock';
import { recordLogin } from '@/lib/loginHistory';
import { clientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// { password, useLoginPassword? } — the login password also unlocks, for
// when the app lock password is forgotten.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const hash = await appLockHash(user.id);
  if (!hash) return NextResponse.json({ ok: true });

  const wait = lockoutSeconds(user.id);
  if (wait) return NextResponse.json({ error: `Too many wrong tries. Wait ${wait} s.` }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '');
  let valid;
  if (body.useLoginPassword) {
    const rows = await query('SELECT password FROM users WHERE id = ?', [user.id]);
    valid = Boolean(rows[0]?.password) && (await verifyPassword(password, rows[0].password));
  } else {
    valid = await verifyPassword(password, hash);
  }
  // Every attempt goes into Login history (the client then attaches the
  // camera photo it took when the user came back to MyTrack).
  const eventId = await recordLogin(user.id, {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent') || '',
    kind: valid ? 'app_unlock' : 'app_unlock_failed',
  });
  if (!valid) {
    recordFailure(user.id);
    return NextResponse.json({ error: body.useLoginPassword ? 'Incorrect login password.' : 'Incorrect app lock password.', eventId }, { status: 400 });
  }
  clearFailures(user.id);
  return NextResponse.json({ ok: true, eventId });
});
