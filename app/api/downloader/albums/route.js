// Phase 5 — every album (one folder per download job), newest first.
import { NextResponse } from 'next/server';
import { downloaderRoute } from '@/lib/downloader/errors';
import { listAlbums } from '@/lib/downloader/gallery';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request) => {
  const includeEmpty = new URL(request.url).searchParams.get('includeEmpty') === 'true';
  return NextResponse.json({ albums: await listAlbums({ includeEmpty }) });
});
