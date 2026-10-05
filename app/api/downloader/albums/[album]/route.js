// Phase 5 — one album's images (paginated), or delete the whole album.
import { NextResponse } from 'next/server';
import { downloaderRoute } from '@/lib/downloader/errors';
import { deleteAlbum, getAlbum } from '@/lib/downloader/gallery';
import { segment } from '@/lib/downloader/files';
import { intInRange, oneOf } from '@/lib/downloader/validate';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request, { params }) => {
  const q = new URL(request.url).searchParams;
  return NextResponse.json(
    await getAlbum(segment(params.album), {
      page: intInRange(q.get('page') || undefined, 'page', { min: 1, max: 100000, fallback: 1 }),
      limit: intInRange(q.get('limit') || undefined, 'limit', { min: 1, max: 500, fallback: 50 }),
      sort: oneOf(q.get('sort') || undefined, 'sort', ['name', 'newest', 'largest'], 'name'),
    })
  );
});

export const DELETE = downloaderRoute(async (request, { params }) => {
  await deleteAlbum(segment(params.album));
  return new Response(null, { status: 204 });
});
