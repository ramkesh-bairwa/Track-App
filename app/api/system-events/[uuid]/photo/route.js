import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { systemEventPhoto } from '@/lib/systemEvents';

// The camera photo of one system event. Admins only.
export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user?.is_admin) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const dataUrl = await systemEventPhoto(params.uuid);
  const m = dataUrl?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/i);
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(Buffer.from(m[2], 'base64'), {
    headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  });
});
