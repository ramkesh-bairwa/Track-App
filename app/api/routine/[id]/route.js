import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { ownRoutineItem, parseRoutineItem } from '@/lib/routineServer';

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const item = await ownRoutineItem(params.id, user);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { value, error } = parseRoutineItem({ ...item, ...body });
  if (error) return NextResponse.json({ error }, { status: 400 });

  await query('UPDATE routine_items SET title = ?, time_of_day = ?, days = ? WHERE id = ?', [value.title, value.time_of_day, value.days, item.id]);
  return NextResponse.json({ ok: true });
});

// Removes the item and its tick history.
export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const item = await ownRoutineItem(params.id, user);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await query('DELETE FROM routine_items WHERE id = ?', [item.id]);
  return NextResponse.json({ ok: true });
});
