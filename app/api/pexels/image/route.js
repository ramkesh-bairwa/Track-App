import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

// Per-user and never cacheable at build time.
export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

// Streams a Pexels image through our own origin, so a <canvas> can edit and
// export it (a cross-origin image would "taint" the canvas). Only Pexels'
// image CDN is allowed — this is not an open proxy.
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const src = new URL(request.url).searchParams.get('src') || '';
  let target;
  try {
    target = new URL(src);
  } catch {
    return NextResponse.json({ error: 'Bad image URL.' }, { status: 400 });
  }
  if (target.protocol !== 'https:' || target.hostname !== 'images.pexels.com') {
    return NextResponse.json({ error: 'Only Pexels images can be loaded.' }, { status: 400 });
  }

  const res = await fetch(target, { redirect: 'error', cache: 'no-store' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) return NextResponse.json({ error: 'Could not load that image.' }, { status: 502 });
  const size = Number(res.headers.get('content-length') || 0);
  if (size > MAX_BYTES) return NextResponse.json({ error: 'That image is too large.' }, { status: 413 });

  return new NextResponse(res.body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' },
  });
});
