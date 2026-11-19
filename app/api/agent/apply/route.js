import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireDevice, touchDevice } from '@/lib/agent';
import { applyChanges, syncConnection } from '@/lib/sync';
import { computeScope } from '@/lib/syncScope';

export const dynamic = 'force-dynamic';

// Changes made on the desktop app. Only rows of the device's user are taken;
// system photos from it are filed under that user and computer.
export const POST = withApiErrors(async (request) => {
  const { device, error } = await requireDevice(request);
  if (error) return error;
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Nothing to apply.' }, { status: 400 });
  const conn = await syncConnection();
  let scope;
  try {
    scope = await computeScope(conn, device.user_id);
  } finally {
    await conn.end();
  }
  const { stats } = await applyChanges(payload, { scope });
  const events = (payload.tables?.system_events || []).map((e) => e?.uuid).filter((u) => typeof u === 'string');
  if (events.length) {
    await query(`UPDATE system_events SET user_id = ?, device_id = ? WHERE user_id IS NULL AND uuid IN (${events.map(() => '?').join(',')})`, [
      device.user_id,
      device.id,
      ...events,
    ]);
  }
  await touchDevice(device, request, { last_sync_at: new Date() });
  return NextResponse.json({ ok: true, stats });
});
