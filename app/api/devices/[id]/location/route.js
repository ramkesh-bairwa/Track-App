import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { readLocation } from '@/lib/devicesServer';
import { requesterIp } from '@/lib/tools/ipLocate';

// POST { latitude, longitude, accuracy? } — sent by the device itself while
// "Share from this device" is on. Also records the IP it reported from.
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const loc = readLocation(body);
  if (loc.error) return NextResponse.json({ error: loc.error }, { status: 400 });
  const result = await query(
    'UPDATE user_devices SET last_lat = ?, last_lon = ?, last_accuracy = ?, last_ip = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
    [loc.lat, loc.lon, loc.accuracy, requesterIp(request), params.id, user.id]
  );
  if (!result.affectedRows) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});

// DELETE → forget the device's last location.
export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await query(
    'UPDATE user_devices SET last_lat = NULL, last_lon = NULL, last_accuracy = NULL, last_ip = NULL, last_seen_at = NULL WHERE id = ? AND user_id = ?',
    [params.id, user.id]
  );
  if (!result.affectedRows) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
