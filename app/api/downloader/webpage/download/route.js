// Phase 3 — download a web page's images (all of them, or the chosen imageUrls) as a background job.
import { NextResponse } from 'next/server';
import { config } from '@/lib/downloader/config';
import { badRequest, downloaderRoute, readJson } from '@/lib/downloader/errors';
import { startJob } from '@/lib/downloader/jobs';
import { saveOptions } from '@/lib/downloader/savePath';
import { parseHttpUrl } from '@/lib/downloader/netguard';
import { intInRange, requireString } from '@/lib/downloader/validate';
import { runWebpageDownload } from '@/lib/downloader/webpage';

export const dynamic = 'force-dynamic';

export const POST = downloaderRoute(async (request) => {
  const body = (await readJson(request)) || {};
  const url = body.url ? parseHttpUrl(requireString(body.url, 'url')).href : null;

  let imageUrls = null;
  if (body.imageUrls !== undefined) {
    if (!Array.isArray(body.imageUrls) || !body.imageUrls.length) throw badRequest('"imageUrls" must be a non-empty array of URLs');
    if (body.imageUrls.length > config.maxWebpageImages) throw badRequest(`"imageUrls" can hold at most ${config.maxWebpageImages} URLs`);
    imageUrls = [...new Set(body.imageUrls.map((u, i) => parseHttpUrl(u, `imageUrls[${i}]`).href))];
  }
  if (!url && !imageUrls) throw badRequest('Provide "url" (download every image on the page) or "imageUrls" (download only these)');

  const limit = intInRange(body.limit, 'limit', { min: 1, max: config.maxWebpageImages, fallback: config.maxWebpageImages });
  const minBytes = intInRange(body.minBytes, 'minBytes', { min: 0, max: config.maxImageBytes, fallback: 0 });
  const albumLabel = body.albumName || new URL(url || imageUrls[0]).hostname.replace(/\./g, '_');

  const save = await saveOptions(body);
  const job = await startJob({
    ...save,
    type: 'webpage',
    params: { url, imageCount: imageUrls?.length ?? null, limit, minBytes },
    albumLabel,
    run: (ctx) => runWebpageDownload(ctx, { url, imageUrls, limit, minBytes }),
  });
  return NextResponse.json(job.summary(), { status: 202, headers: { Location: `/api/downloader/jobs/${job.id}` } });
});
