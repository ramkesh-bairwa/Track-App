// Phase 2 — preview Pexels results before downloading.
import { NextResponse } from 'next/server';
import { downloaderRoute } from '@/lib/downloader/errors';
import { PEXELS_ORIENTATIONS, PEXELS_SIZES, searchPexels } from '@/lib/downloader/pexels';
import { intInRange, oneOf, requireString } from '@/lib/downloader/validate';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request) => {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  return NextResponse.json(
    await searchPexels({
      query: requireString(q.query, 'query', { maxLength: 200 }),
      page: intInRange(q.page, 'page', { min: 1, max: 1000, fallback: 1 }),
      perPage: intInRange(q.perPage, 'perPage', { min: 1, max: 80, fallback: 30 }),
      orientation: oneOf(q.orientation, 'orientation', PEXELS_ORIENTATIONS),
      size: oneOf(q.size, 'size', PEXELS_SIZES),
      color: q.color ? requireString(q.color, 'color', { maxLength: 20 }) : undefined,
    })
  );
});
