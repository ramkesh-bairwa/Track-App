import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

// The signed-in user's notifications (newest first) and how many are unread.
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 20));
  const items = await query(
    `SELECT id, actor_id, actor_name, kind, title, body, url, read_at, created_at
       FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ${limit}`,
    [user.id]
  );
  const [{ unread }] = await query('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [user.id]);
  return NextResponse.json({ items, unread: Number(unread) });
});

// { ids: [..] } marks those read; { all: true } marks everything read.
export const PATCH = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.all) {
    await query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [user.id]);
  } else if (Array.isArray(body.ids) && body.ids.length) {
    const ids = body.ids.map(Number).filter(Number.isFinite).slice(0, 100);
    if (ids.length) {
      await query(
        `UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
        [user.id, ...ids]
      );
    }
  }
  return NextResponse.json({ ok: true });
});
