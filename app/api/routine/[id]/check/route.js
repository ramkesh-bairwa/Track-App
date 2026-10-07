import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { isDate } from '@/lib/calendarServer';
import { ownRoutineItem } from '@/lib/routineServer';

// Ticks a routine item off for a day ({ date, done: true }) or unticks it.
export const PUT = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const item = await ownRoutineItem(params.id, user);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  if (!isDate(body.date)) return NextResponse.json({ error: 'Pick a valid date.' }, { status: 400 });
  if (body.done) {
    await query('INSERT IGNORE INTO routine_checks (item_id, user_id, check_date) VALUES (?, ?, ?)', [item.id, user.id, body.date]);
  } else {
    await query('DELETE FROM routine_checks WHERE item_id = ? AND check_date = ?', [item.id, body.date]);
  }
  return NextResponse.json({ ok: true, done: Boolean(body.done) });
});
