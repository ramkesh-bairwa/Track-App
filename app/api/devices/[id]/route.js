import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { DEVICE_COLUMNS, isDuplicate, readDevice } from '@/lib/devicesServer';

// PATCH { name?, imei?, imei2?, notes? } → the updated device.
export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { values, error } = readDevice(body, { partial: true });
  if (error) return NextResponse.json({ error }, { status: 400 });
  const keys = Object.keys(values);
  if (!keys.length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

  try {
    const result = await query(
      `UPDATE user_devices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
      [...keys.map((k) => values[k]), params.id, user.id]
    );
    if (!result.affectedRows) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (err) {
    if (isDuplicate(err)) return NextResponse.json({ error: 'You’ve already saved a device with that IMEI.' }, { status: 409 });
    throw err;
  }
  const [device] = await query(`SELECT ${DEVICE_COLUMNS} FROM user_devices WHERE id = ? AND user_id = ?`, [params.id, user.id]);
  return NextResponse.json({ device });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await query('DELETE FROM user_devices WHERE id = ? AND user_id = ?', [params.id, user.id]);
  if (!result.affectedRows) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
