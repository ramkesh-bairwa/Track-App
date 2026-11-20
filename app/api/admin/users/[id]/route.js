import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/screenshots';
import { setLoginPhotos } from '@/lib/loginHistory';

// Admin controls for one user:
//   { is_admin: true|false }       — grant / revoke admin
//   { login_photos: true|false }   — turn their sign-in / unlock camera photos on or off
// An admin can't change their own admin access, so the last admin can't lock
// everyone out.
export const PATCH = withApiErrors(async (request, { params }) => {
  const { user, error } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id) || 0;
  const body = await request.json().catch(() => ({}));

  if (typeof body.is_admin === 'boolean') {
    if (id === user.id) return NextResponse.json({ error: 'You can’t change your own admin access.' }, { status: 400 });
    const result = await query('UPDATE users SET is_admin = ? WHERE id = ?', [body.is_admin ? 1 : 0, id]);
    if (!result.affectedRows) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (typeof body.login_photos === 'boolean') {
    const [target] = await query('SELECT id FROM users WHERE id = ?', [id]);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await setLoginPhotos(id, body.login_photos);
    return NextResponse.json({ ok: true, login_photos: body.login_photos });
  }

  return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
});
