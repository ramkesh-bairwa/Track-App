import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/screenshots';

// Makes someone an admin, or takes it away: { is_admin: true | false }.
// Admins can't change themselves, so the last admin can't lock everyone out.
export const PATCH = withApiErrors(async (request, { params }) => {
  const { user, error } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id) || 0;
  if (id === user.id) return NextResponse.json({ error: 'You can’t change your own admin access.' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.is_admin !== 'boolean') return NextResponse.json({ error: 'Say whether they should be an admin.' }, { status: 400 });
  const result = await query('UPDATE users SET is_admin = ? WHERE id = ?', [body.is_admin ? 1 : 0, id]);
  if (!result.affectedRows) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
