import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { isToken, removeShot } from '@/lib/sharedShots';

// Stop sharing: deletes the image, so its link stops working.
export const DELETE = withApiErrors(async (_request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isToken(params.token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [row] = await query('SELECT * FROM shared_screenshots WHERE token = ? AND user_id = ?', [params.token, user.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await removeShot(row.token, row.mime);
  await query('DELETE FROM shared_screenshots WHERE id = ?', [row.id]);
  return NextResponse.json({ ok: true });
});
