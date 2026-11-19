import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { isLocalRequest, recordSystemEvent, listSystemEvents, systemPhotosEnabled } from '@/lib/systemEvents';

// Desktop app only (its launch secret): add a system event with its photo.
export const POST = withApiErrors(async (request) => {
  if (!isLocalRequest(request)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await systemPhotosEnabled())) return NextResponse.json({ ok: true, off: true });
  const body = await request.json().catch(() => ({}));
  const uuid = await recordSystemEvent(String(body.kind || ''), body.photo);
  return NextResponse.json({ ok: true, uuid });
});

// Admins: the system login history.
export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user?.is_admin) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ events: await listSystemEvents() });
});
