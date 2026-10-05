// Phase 3 — download images straight from their own URLs (no page scan) as a background job.
// Body: { urls: string[] | "one per line", albumName?, minBytes?, saveTo?, subfolder? }
import { NextResponse } from 'next/server';
import { config } from '@/lib/downloader/config';
import { badRequest, downloaderRoute, readJson } from '@/lib/downloader/errors';
import { startJob } from '@/lib/downloader/jobs';
import { parseHttpUrl } from '@/lib/downloader/netguard';
import { saveOptions } from '@/lib/downloader/savePath';
import { intInRange } from '@/lib/downloader/validate';
import { runWebpageDownload } from '@/lib/downloader/webpage';

export const dynamic = 'force-dynamic';

export const POST = downloaderRoute(async (request) => {
  const body = (await readJson(request)) || {};
  const raw = typeof body.urls === 'string' ? body.urls.split(/\s+/) : body.urls;
  if (!Array.isArray(raw)) throw badRequest('"urls" must be a list of image URLs');
  const list = raw.map((u) => (typeof u === 'string' ? u.trim() : u)).filter(Boolean);
  if (!list.length) throw badRequest('Paste at least one image URL');
  if (list.length > config.maxWebpageImages) throw badRequest(`"urls" can hold at most ${config.maxWebpageImages} URLs`);
  const imageUrls = [...new Set(list.map((u, i) => parseHttpUrl(u, `urls[${i}]`).href))];

  const minBytes = intInRange(body.minBytes, 'minBytes', { min: 0, max: config.maxImageBytes, fallback: 0 });
  const albumLabel =
    (typeof body.albumName === 'string' && body.albumName.trim()) ||
    (imageUrls.length === 1 ? new URL(imageUrls[0]).hostname.replace(/\./g, '_') : 'image_urls');

  const save = await saveOptions(body);
  const job = await startJob({
    ...save,
    type: 'url',
    params: { imageCount: imageUrls.length, minBytes },
    albumLabel,
    run: (ctx) => runWebpageDownload(ctx, { url: null, imageUrls, limit: imageUrls.length, minBytes }),
  });
  return NextResponse.json(job.summary(), { status: 202, headers: { Location: `/api/downloader/jobs/${job.id}` } });
});
