import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { isDate } from '@/lib/calendarServer';
import { ROUTINE_COLUMNS, parseRoutineItem } from '@/lib/routineServer';

// Every routine item, and what was ticked off in the 7 days up to ?date.
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = new URL(request.url).searchParams.get('date');
  if (!isDate(date)) return NextResponse.json({ error: 'Give a date like 2026-10-06.' }, { status: 400 });

  const [items, checks] = await Promise.all([
    query(`SELECT ${ROUTINE_COLUMNS} FROM routine_items WHERE user_id = ? ORDER BY time_of_day IS NULL, time_of_day, id`, [user.id]),
    query(
      `SELECT item_id, DATE_FORMAT(check_date, '%Y-%m-%d') AS check_date FROM routine_checks
        WHERE user_id = ? AND check_date > DATE_SUB(?, INTERVAL 7 DAY) AND check_date <= ?`,
      [user.id, date, date]
    ),
  ]);
  return NextResponse.json({ items, checks });
});

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { value, error } = parseRoutineItem(await request.json().catch(() => ({})));
  if (error) return NextResponse.json({ error }, { status: 400 });

  const res = await query('INSERT INTO routine_items (user_id, title, time_of_day, days) VALUES (?, ?, ?, ?)', [
    user.id, value.title, value.time_of_day, value.days,
  ]);
  return NextResponse.json({ ok: true, id: res.insertId });
});
