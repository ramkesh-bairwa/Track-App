import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { logTrack, propChange } from '@/lib/trackLog';

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
  const before = await query(
    `SELECT id, name, parent_id FROM tracks WHERE user_id = ? AND id IN (${order.map(() => '?').join(',')}) ORDER BY position ASC, id ASC`,
    [user.id, ...order]
  );

  await Promise.all(
    order.map((trackId, index) =>
      ownedIds.has(trackId)
        ? query('UPDATE tracks SET position = ? WHERE id = ? AND user_id = ?', [index, trackId, user.id])
        : null
    )
  );
  // Sub-tracks moved around inside a track → a line in that track's history.
  const parentId = before[0]?.parent_id;
  if (parentId && before.every((t) => t.parent_id === parentId)) {
    const name = new Map(before.map((t) => [t.id, t.name]));
    const was = before.map((t) => t.name).join(', ');
    const now = order.filter((id) => name.has(id)).map((id) => name.get(id)).join(', ');
    if (was !== now) {
      await logTrack({ trackId: parentId, user, action: 'subtrack_reorder', summary: 'Reordered sub-tracks', changes: [propChange('order', 'Order', was, now)] });
    }
  }
  return NextResponse.json({ ok: true });
});
