import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { ACTIVITY_COLUMNS, LEAVE_COLUMNS, isDate } from '@/lib/calendarServer';

// Everything the calendar shows for a date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!isDate(from) || !isDate(to) || to < from) {
    return NextResponse.json({ error: 'Give a valid from/to date range.' }, { status: 400 });
  }

  const [leaves, activities] = await Promise.all([
    query(
      `SELECT ${LEAVE_COLUMNS} FROM calendar_leaves
        WHERE user_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date, id`,
      [user.id, to, from]
    ),
    query(
      `SELECT ${ACTIVITY_COLUMNS} FROM calendar_activities
        WHERE user_id = ? AND activity_date BETWEEN ? AND ?
        ORDER BY activity_date, start_time IS NULL, start_time, id`,
      [user.id, from, to]
    ),
  ]);
  return NextResponse.json({
    leaves: leaves.map((l) => ({ ...l, half_day: Boolean(l.half_day) })),
    activities,
  });
});
