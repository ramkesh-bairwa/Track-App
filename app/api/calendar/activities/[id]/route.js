import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { ACTIVITY_COLUMNS, parseActivity } from '@/lib/calendarServer';

async function ownActivity(id, user) {
  const rows = await query(
    `SELECT ${ACTIVITY_COLUMNS} FROM calendar_activities WHERE id = ? AND user_id = ?`,
    [Number(id) || 0, user.id]
  );
  return rows[0] || null;
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const activity = await ownActivity(params.id, user);
  if (!activity) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { value, error } = parseActivity({ ...activity, ...body });
  if (error) return NextResponse.json({ error }, { status: 400 });

  await query(
    'UPDATE calendar_activities SET activity_date = ?, start_time = ?, end_time = ?, title = ?, details = ? WHERE id = ?',
    [value.activity_date, value.start_time, value.end_time, value.title, value.details, activity.id]
  );
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const activity = await ownActivity(params.id, user);
  if (!activity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await query('DELETE FROM calendar_activities WHERE id = ?', [activity.id]);
  return NextResponse.json({ ok: true });
});
