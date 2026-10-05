import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { LEAVE_COLUMNS, parseLeave } from '@/lib/calendarServer';

async function ownLeave(id, user) {
  const rows = await query(`SELECT ${LEAVE_COLUMNS} FROM calendar_leaves WHERE id = ? AND user_id = ?`, [Number(id) || 0, user.id]);
  return rows[0] || null;
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const leave = await ownLeave(params.id, user);
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const merged = { ...leave, ...body };
  const { value, error } = parseLeave(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const overlap = await query(
    'SELECT id FROM calendar_leaves WHERE user_id = ? AND id <> ? AND start_date <= ? AND end_date >= ? LIMIT 1',
    [user.id, leave.id, value.end_date, value.start_date]
  );
  if (overlap.length) return NextResponse.json({ error: 'You already have leave on some of those days.' }, { status: 400 });

  await query(
    'UPDATE calendar_leaves SET start_date = ?, end_date = ?, leave_type = ?, half_day = ?, note = ? WHERE id = ?',
    [value.start_date, value.end_date, value.leave_type, value.half_day, value.note, leave.id]
  );
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const leave = await ownLeave(params.id, user);
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await query('DELETE FROM calendar_leaves WHERE id = ?', [leave.id]);
  return NextResponse.json({ ok: true });
});
