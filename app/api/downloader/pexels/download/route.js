// Phase 3 — download `count` Pexels photos for a keyword as a background job.
import { NextResponse } from 'next/server';
import { config } from '@/lib/downloader/config';
import { downloaderRoute, readJson } from '@/lib/downloader/errors';
import { startJob } from '@/lib/downloader/jobs';
import { saveOptions } from '@/lib/downloader/savePath';
import { PEXELS_ORIENTATIONS, PEXELS_QUALITIES, PEXELS_SIZES, runPexelsDownload } from '@/lib/downloader/pexels';
import { intInRange, oneOf, requireString } from '@/lib/downloader/validate';

export const dynamic = 'force-dynamic';

export const POST = downloaderRoute(async (request) => {
  const body = (await readJson(request)) || {};
  const query = requireString(body.query, 'query', { maxLength: 200 });
  const params = {
    query,
    count: intInRange(body.count, 'count', { min: 1, max: config.maxPexelsCount }),
    quality: oneOf(body.quality, 'quality', Object.keys(PEXELS_QUALITIES), 'original'),
    orientation: oneOf(body.orientation, 'orientation', PEXELS_ORIENTATIONS),
    size: oneOf(body.size, 'size', PEXELS_SIZES),
    color: body.color ? requireString(body.color, 'color', { maxLength: 20 }) : undefined,
  };

  const save = await saveOptions(body);
  const job = await startJob({
    ...save,
    type: 'pexels',
    params,
    albumLabel: body.albumName || query,
    run: (ctx) => runPexelsDownload(ctx, params),
  });
  return NextResponse.json(job.summary(), { status: 202, headers: { Location: `/api/downloader/jobs/${job.id}` } });
});
