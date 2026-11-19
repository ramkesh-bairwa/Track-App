import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { loginPhotosEnabled, setLoginPhotos } from '@/lib/loginHistory';

// Whether Login history takes camera photos (sign in, app opened / unlocked)
// for the signed-in user. Each user switches their own.
export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ enabled: await loginPhotosEnabled(user.id) });
});

export const PUT = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Send enabled: true or false.' }, { status: 400 });
  await setLoginPhotos(user.id, body.enabled);
  return NextResponse.json({ enabled: body.enabled });
});
