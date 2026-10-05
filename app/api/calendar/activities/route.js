import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { parseActivity } from '@/lib/calendarServer';

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { value, error } = parseActivity(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const res = await query(
    'INSERT INTO calendar_activities (user_id, activity_date, start_time, end_time, title, details) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, value.activity_date, value.start_time, value.end_time, value.title, value.details]
  );
  return NextResponse.json({ ok: true, id: res.insertId });
});
