import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, verifyPassword } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rows = await query('SELECT action_password FROM users WHERE id = ?', [user.id]);
  const hash = rows[0]?.action_password;
  if (!hash) return NextResponse.json({ ok: true });

  const valid = await verifyPassword(body.password || '', hash);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect privacy password.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
