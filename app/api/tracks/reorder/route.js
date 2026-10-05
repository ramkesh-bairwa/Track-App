import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

// Reorders a group of sibling tracks (same parent, including top-level
// tracks that share a NULL parent) relative to each other.
// Body: { order: [trackId, trackId, ...] }
export const PATCH = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const order = Array.isArray(body.order) ? body.order.map(Number) : [];
  if (order.length === 0) return NextResponse.json({ ok: true });

  const rows = await query(
    `SELECT id FROM tracks WHERE user_id = ? AND id IN (${order.map(() => '?').join(',')})`,
    [user.id, ...order]
  );
  const ownedIds = new Set(rows.map((r) => r.id));

  await Promise.all(
    order.map((trackId, index) =>
      ownedIds.has(trackId)
        ? query('UPDATE tracks SET position = ? WHERE id = ? AND user_id = ?', [index, trackId, user.id])
        : null
    )
  );
  return NextResponse.json({ ok: true });
});
