import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { isLocalRequest, systemPhotosEnabled, setSystemPhotos } from '@/lib/systemEvents';

// Whether this computer takes system photos. Read by the desktop app (its
// launch secret) and admins; changed by admins.
export const GET = withApiErrors(async (request) => {
  if (!isLocalRequest(request)) {
    const user = await getCurrentUser();
    if (!user?.is_admin) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ enabled: await systemPhotosEnabled(), desktop: process.env.MYTRACK_DESKTOP === '1' });
});

export const PUT = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user?.is_admin) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (process.env.MYTRACK_DESKTOP !== '1') return NextResponse.json({ error: 'System photos are set in the desktop app.' }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Send enabled: true or false.' }, { status: 400 });
  await setSystemPhotos(body.enabled);
  return NextResponse.json({ enabled: body.enabled });
});
