import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/screenshots';
import { ACTIVITY_COLUMNS, LEAVE_COLUMNS } from '@/lib/calendarServer';

export const dynamic = 'force-dynamic';

// A user's calendar for an admin to review: leaves and activities from 30 days
// ago to 60 days ahead (newest-relevant first).
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id) || 0;
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);

  const [leaves, activities] = await Promise.all([
    query(
      `SELECT ${LEAVE_COLUMNS} FROM calendar_leaves
        WHERE user_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC, id DESC`,
      [id, to, from]
    ),
    query(
      `SELECT ${ACTIVITY_COLUMNS} FROM calendar_activities
        WHERE user_id = ? AND activity_date BETWEEN ? AND ?
        ORDER BY activity_date DESC, start_time IS NULL, start_time, id`,
      [id, from, to]
    ),
  ]);
  return NextResponse.json({
    leaves: leaves.map((l) => ({ ...l, half_day: Boolean(l.half_day) })),
    activities,
    range: { from, to },
  });
});
