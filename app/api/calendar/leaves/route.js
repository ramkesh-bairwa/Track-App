import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { parseLeave } from '@/lib/calendarServer';

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { value, error } = parseLeave(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const overlap = await query(
    'SELECT id FROM calendar_leaves WHERE user_id = ? AND start_date <= ? AND end_date >= ? LIMIT 1',
    [user.id, value.end_date, value.start_date]
  );
  if (overlap.length) return NextResponse.json({ error: 'You already have leave on some of those days.' }, { status: 400 });

  const res = await query(
    'INSERT INTO calendar_leaves (user_id, start_date, end_date, leave_type, half_day, note) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, value.start_date, value.end_date, value.leave_type, value.half_day, value.note]
  );
  return NextResponse.json({ ok: true, id: res.insertId });
});
