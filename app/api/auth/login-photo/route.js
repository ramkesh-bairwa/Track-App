import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { attachLoginPhoto } from '@/lib/loginHistory';

// Attaches the webcam photo captured on the login page to that login event.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.eventId !== 'string' || !body.eventId) return NextResponse.json({ error: 'Missing login id.' }, { status: 400 });
  const result = await attachLoginPhoto(user.id, body.eventId, body.photo);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
});
