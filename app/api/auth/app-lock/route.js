import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { impersonationBlock, getCurrentUser, hashPassword, verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { appLockHash } from '@/lib/appLock';

export const dynamic = 'force-dynamic';

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ enabled: Boolean(await appLockHash(user.id)) });
});

// { currentPassword?, newPassword } sets / changes it; { currentPassword, disable: true }
// turns it off. Changing or turning it off needs the current app lock password.
export const PATCH = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (impersonationBlock(user)) return NextResponse.json({ error: impersonationBlock(user) }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const existing = await appLockHash(user.id);

  if (existing && !(await verifyPassword(String(body.currentPassword || ''), existing))) {
    return NextResponse.json({ error: 'Current app lock password is incorrect.' }, { status: 400 });
  }

  if (body.disable) {
    await query('UPDATE users SET app_lock_password = NULL WHERE id = ?', [user.id]);
    return NextResponse.json({ ok: true, enabled: false });
  }

  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (next.length < 4) {
    return NextResponse.json({ error: 'App lock password must be at least 4 characters.' }, { status: 400 });
  }
  try {
    await query('UPDATE users SET app_lock_password = ? WHERE id = ?', [await hashPassword(next), user.id]);
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      return NextResponse.json({ error: 'The database needs updating first — run "npm run seed".' }, { status: 500 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, enabled: true });
});
