import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, createSessionToken, sessionCookie } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { recordActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

// "Open as this user": { userId } → the admin's browser now uses MyTrack as
// that person (a banner offers the way back). Not for other admins. Logged
// in both people's activity, and everything done meanwhile is marked as done
// by the admin.
export const POST = withApiErrors(async (request) => {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.impersonator) return NextResponse.json({ error: 'Go back to your own account first.' }, { status: 400 });
  if (!me.is_admin) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const id = Number(body.userId) || 0;
  if (id === me.id) return NextResponse.json({ error: 'That’s you.' }, { status: 400 });
  const [target] = await query('SELECT id, name, email, is_admin FROM users WHERE id = ?', [id]);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (target.is_admin) return NextResponse.json({ error: 'Admins can’t be opened as another admin.' }, { status: 403 });

  // The session names the admin (imp), so "Back to my account" can return
  // to them; it lasts 8 hours at most.
  const token = await createSessionToken({ sub: String(target.id), name: target.name, email: target.email, imp: me.id });
  await recordActivity(me.id, { kind: 'account', action: 'opened', summary: `Opened MyTrack as ${target.name} (${target.email})`, url: `/dashboard/users/${target.id}` });
  await recordActivity(target.id, { kind: 'account', action: 'opened', summary: `Admin ${me.name} opened your account` });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(token, 8 * 60 * 60));
  return res;
});
