import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

// Per-user and never cacheable at build time.
export const dynamic = 'force-dynamic';

// Proxies Pexels search so the API key never reaches the browser.
// No `q` → Pexels' curated photos.
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'Pexels isn’t set up yet. Add PEXELS_API_KEY to .env (free key at pexels.com/api), then restart the server.', setup: true },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(100, Number(searchParams.get('page')) || 1));
  const orientation = ['landscape', 'portrait', 'square'].includes(searchParams.get('orientation')) ? searchParams.get('orientation') : '';
  const url = q
    ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24&page=${page}${orientation ? `&orientation=${orientation}` : ''}`
    : `https://api.pexels.com/v1/curated?per_page=24&page=${page}`;

  const res = await fetch(url, { headers: { Authorization: key }, cache: 'no-store' });
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json({ error: 'Pexels rejected the API key — check PEXELS_API_KEY in .env.', setup: true }, { status: 502 });
  }
  if (res.status === 429) return NextResponse.json({ error: 'Pexels rate limit reached — try again in a little while.' }, { status: 429 });
  if (!res.ok) return NextResponse.json({ error: 'Pexels is not responding right now.' }, { status: 502 });

  const json = await res.json();
  return NextResponse.json({
    page: json.page,
    hasMore: Boolean(json.next_page),
    total: json.total_results ?? null,
    photos: (json.photos || []).map((p) => ({
      id: p.id,
      width: p.width,
      height: p.height,
      alt: p.alt || '',
      color: p.avg_color,
      photographer: p.photographer,
      photographerUrl: p.photographer_url,
      url: p.url,
      thumb: p.src?.medium,
      large: p.src?.large2x || p.src?.large,
      original: p.src?.original,
    })),
  });
});
