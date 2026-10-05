import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { DEVICE_COLUMNS, MAX_DEVICES, NO_TABLE, isDuplicate, noTableResponse, readDevice } from '@/lib/devicesServer';

// GET → the signed-in user's saved devices.
export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const devices = await query(`SELECT ${DEVICE_COLUMNS} FROM user_devices WHERE user_id = ? ORDER BY name, id`, [user.id]);
    return NextResponse.json({ devices });
  } catch (err) {
    if (err?.code === NO_TABLE) return NextResponse.json(noTableResponse, { status: 503 });
    throw err;
  }
});

// POST { name, imei, imei2?, notes? } → the saved device.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { values, error } = readDevice(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const [{ n }] = await query('SELECT COUNT(*) AS n FROM user_devices WHERE user_id = ?', [user.id]);
  if (n >= MAX_DEVICES) return NextResponse.json({ error: `You can save up to ${MAX_DEVICES} devices.` }, { status: 400 });

  try {
    const result = await query('INSERT INTO user_devices (user_id, name, imei, imei2, notes) VALUES (?, ?, ?, ?, ?)', [
      user.id, values.name, values.imei, values.imei2 ?? null, values.notes ?? null,
    ]);
    const [device] = await query(`SELECT ${DEVICE_COLUMNS} FROM user_devices WHERE id = ?`, [result.insertId]);
    return NextResponse.json({ device }, { status: 201 });
  } catch (err) {
    if (isDuplicate(err)) return NextResponse.json({ error: 'You’ve already saved a device with that IMEI.' }, { status: 409 });
    throw err;
  }
});
