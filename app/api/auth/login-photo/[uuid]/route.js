import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { getLoginPhoto } from '@/lib/loginHistory';

// Serves the webcam photo for one of the current user's own logins — or, for
// an admin, anyone's (?user=<id>, from the admin panel).
export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const other = Number(new URL(request.url).searchParams.get('user')) || 0;
  const owner = other && user.is_admin ? other : user.id;
  const dataUrl = await getLoginPhoto(owner, params.uuid);
  if (!dataUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(Buffer.from(m[2], 'base64'), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=3600' },
  });
});
