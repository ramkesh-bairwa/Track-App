import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { clientIp } from '@/lib/rateLimit';
import { recordLogin, checkLoginPhoto } from '@/lib/loginHistory';

// Desktop app only: records "MyTrack was opened" in Login history, with the
// camera photo taken at that moment — the desktop app stays signed in, so
// the login page (which normally takes the photo) rarely shows.
export const POST = withApiErrors(async (request) => {
  if (process.env.MYTRACK_DESKTOP !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // A login a moment ago already recorded this opening (with its photo).
  const recent = await query(
    "SELECT id FROM login_events WHERE user_id = ? AND kind = 'login' AND created_at > NOW() - INTERVAL 2 MINUTE LIMIT 1",
    [user.id]
  );
  if (recent.length) return NextResponse.json({ ok: true, skipped: true });
  const body = await request.json().catch(() => ({}));
  const photo = checkLoginPhoto(body.photo) ? null : body.photo;
  await recordLogin(user.id, {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent') || '',
    photo,
    kind: 'app_open',
  });
  return NextResponse.json({ ok: true, photo: Boolean(photo) });
});
