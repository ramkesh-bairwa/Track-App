import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, createSessionToken, sessionCookie } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { recordActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

// Back to the admin's own account after "Open as this user".
export const POST = withApiErrors(async () => {
  const me = await getCurrentUser();
  if (!me?.impersonator) return NextResponse.json({ error: 'Not opened as another user.' }, { status: 400 });
  const [admin] = await query('SELECT id, name, email FROM users WHERE id = ? AND is_admin = 1', [me.impersonator.id]);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = await createSessionToken({ sub: String(admin.id), name: admin.name, email: admin.email });
  await recordActivity(admin.id, { kind: 'account', action: 'closed', summary: `Went back from ${me.name}’s account`, url: `/dashboard/users/${me.id}` });
  const res = NextResponse.json({ ok: true, userId: me.id });
  res.cookies.set(sessionCookie(token, 60 * 60 * 24 * 30));
  return res;
});
