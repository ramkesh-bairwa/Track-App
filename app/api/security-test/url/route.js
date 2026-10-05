import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { checkUrl } from '@/lib/urlPosture';

// Read-only security posture check for a public URL. Signed-in only. Performs
// one GET + a TLS handshake and reports observable configuration — it sends no
// attack payloads and is SSRF-guarded against internal targets.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  let url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'Enter a URL to check.' }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const result = await checkUrl(url);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Could not check that URL.' }, { status: 400 });
  }
});
