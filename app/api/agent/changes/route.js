import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireDevice } from '@/lib/agent';
import { exportChanges, syncConnection } from '@/lib/sync';
import { computeScope } from '@/lib/syncScope';

export const dynamic = 'force-dynamic';

// This device's user's changes since ?since= (their slice only).
export const GET = withApiErrors(async (request) => {
  const { device, error } = await requireDevice(request);
  if (error) return error;
  const since = new URL(request.url).searchParams.get('since') || null;
  const conn = await syncConnection();
  let scope;
  try {
    scope = await computeScope(conn, device.user_id);
  } finally {
    await conn.end();
  }
  return NextResponse.json(await exportChanges(since, { scope }));
});
